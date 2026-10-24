"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { conceptSections, headingSlug, sectionUnits } = require("../src/context/sections");
const { buildProjectIndex } = require("../src/indexer");
const { parseMarkdownText } = require("../src/parser");
const fixtureSlug = require("./fixtures/retrieval/lib/slug");

const FIXTURES_ROOT = path.join(__dirname, "fixtures", "retrieval");
const BUNDLE = { id: "demo", root: path.join(__dirname, "fixtures", "demo-bundle") };

function concept(body, frontmatter) {
  const head = Object.assign(
    { type: "Note", title: "Demo title", description: "Demo lead." },
    frontmatter,
  );
  const yaml = Object.entries(head)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return parseMarkdownText(BUNDLE, "notes/demo.md", `---\n${yaml}\n---\n${body}`);
}

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

test("heading slugs follow GitHub's rule and agree with the fixture labels", () => {
  assert.equal(headingSlug("Target cluster"), "target-cluster");
  assert.equal(headingSlug("  Consentito / Allowed "), "consentito--allowed");
  assert.equal(headingSlug("Città & Natura!"), "città--natura");
  assert.equal(headingSlug("C++ 2.0 (beta)"), "c-20-beta");
  assert.equal(headingSlug("Proprietà e runtime"), "proprietà-e-runtime");
  // github-slugger keeps underscores and combining marks.
  assert.equal(headingSlug("snake_case stays-hyphen"), "snake_case-stays-hyphen");
  assert.equal(headingSlug("Cafe\u0301 my_var"), "cafe\u0301-my_var");
  assert.equal(headingSlug("Ре́жим работы"), "ре́жим-работы");
  // Whitespace runs are one space before the rule applies.
  assert.equal(headingSlug("Target  cluster"), "target-cluster");
  assert.equal(headingSlug("Target\tcluster\n"), "target-cluster");
  assert.equal(headingSlug("!!!"), "");
  let labels = 0;
  ["alpinaria", "atlas"].forEach((name) => {
    const sidecar = JSON.parse(fs.readFileSync(path.join(FIXTURES_ROOT, name, "queries.json")));
    sidecar.queries
      .filter((query) => query.sectionAnchor)
      .forEach((query) => {
        labels += 1;
        const { heading, slug } = query.sectionAnchor;
        assert.equal(headingSlug(heading), slug, `${name} ${query.id}`);
        assert.equal(headingSlug(heading), fixtureSlug.headingSlug(heading), `${name} ${query.id}`);
      });
  });
  assert.ok(labels >= 100);
});

test("sections start with the preamble and take uri#slug anchors in document order", () => {
  const doc = concept(
    [
      "Lead paragraph before any heading.",
      "",
      "# Demo title",
      "",
      "Intro under the H1.",
      "",
      "## Alpha",
      "",
      "Alpha body.",
      "",
      "### Nested",
      "",
      "Nested body.",
      "",
      "## Alpha",
      "",
      "Second alpha.",
      "",
      "## Alpha-1",
      "",
      "## Alpha",
      "",
      "### !!!",
      "",
      "Punctuation-only heading.",
      "",
    ].join("\n"),
  );
  const sections = conceptSections(doc);
  assert.deepEqual(
    sections.map((section) => section.anchor),
    [
      "okf://demo/notes/demo",
      "okf://demo/notes/demo#demo-title",
      "okf://demo/notes/demo#alpha",
      "okf://demo/notes/demo#nested",
      "okf://demo/notes/demo#alpha-1",
      "okf://demo/notes/demo#alpha-1-1",
      "okf://demo/notes/demo#alpha-2",
      "okf://demo/notes/demo#section",
    ],
  );
  const [preamble, h1, alpha, nested] = sections;
  assert.deepEqual(
    [preamble.heading, preamble.level, preamble.slug, preamble.uri],
    [null, 0, null, "okf://demo/notes/demo"],
  );
  assert.equal(preamble.text, "Demo title\nDemo lead.\nLead paragraph before any heading.");
  assert.deepEqual(
    [h1.heading, h1.level, h1.text],
    ["Demo title", 1, "Demo title\nIntro under the H1."],
  );
  // Flat units: a section ends at the next heading of any level.
  assert.equal(alpha.text, "Alpha\nAlpha body.");
  assert.deepEqual([nested.level, nested.text], [3, "Nested\nNested body."]);
  sections.forEach((section) => {
    assert.equal(section.charCount, section.text.length);
    assert.equal(section.hash, sha256(section.text));
    assert.equal(section.uri, doc.uri);
    assert.ok(Object.isFrozen(section));
  });
  assert.equal(conceptSections(doc), sections, "sections are memoised per document");
});

test("a concept without headings is one preamble section", () => {
  const doc = concept("Just a paragraph.\n\nAnd another.\n");
  const sections = conceptSections(doc);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].anchor, doc.uri);
  assert.equal(sections[0].text, "Demo title\nDemo lead.\nJust a paragraph.\nAnd another.");
  const bare = concept("", { description: "" });
  assert.deepEqual(
    conceptSections(bare).map((section) => section.text),
    ["Demo title"],
  );
});

test("anchors and hashes survive whitespace-only edits and edits to other sections", () => {
  const body =
    "# Demo title\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body here.\n\n## Gamma\n\nGamma body.\n";
  const original = conceptSections(concept(body));
  const reformatted = conceptSections(
    concept(
      "# Demo title   \n\n\n\n##   Alpha\n\n\nAlpha     body.\n\n\n## Beta  \n\nBeta\nbody here.\n\n## Gamma\n\nGamma body.\n\n\n",
    ),
  );
  assert.deepEqual(
    reformatted.map((section) => [section.anchor, section.hash]),
    original.map((section) => [section.anchor, section.hash]),
  );
  const edited = conceptSections(concept(body.replace("Beta body here.", "Beta body changed.")));
  assert.deepEqual(
    edited.map((section) => section.anchor),
    original.map((section) => section.anchor),
  );
  original.forEach((section, position) => {
    if (section.slug === "beta") {
      assert.notEqual(edited[position].hash, section.hash);
    } else {
      assert.equal(edited[position].hash, section.hash, section.anchor);
    }
  });
  // Heading-internal whitespace runs and setext line breaks do not move an anchor.
  const widened = conceptSections(concept(body.replace("## Beta", "## Beta  two")));
  assert.equal(widened[3].slug, "beta-two");
  assert.equal(widened[3].heading, "Beta two");
  const setext = conceptSections(concept(body.replace("## Beta", "Beta\ntwo\n---")));
  assert.equal(setext[3].slug, "beta-two");
  assert.equal(setext[3].heading, "Beta two");
  const target = conceptSections(
    concept("## Target  cluster\n\nx\n\nTarget\ncluster\n------\n\ny\n"),
  );
  assert.deepEqual(
    target.slice(1).map((section) => section.slug),
    ["target-cluster", "target-cluster-1"],
  );
});

test("a table delimiter row is dropped from tables only; fenced code keeps its lines", () => {
  const yaml = (value) =>
    conceptSections(concept(`## Snippet\n\n\`\`\`yaml\n---\nkey: ${value}\n---\n\`\`\`\n`))[1];
  const first = yaml("one");
  const second = yaml("two");
  assert.notEqual(first.hash, second.hash);
  assert.equal(first.text, "Snippet\n---\nkey: one\n---");
  const rule = conceptSections(concept("## Rule\n\n```\n|---|\n```\n"))[1];
  assert.equal(rule.text, "Rule\n|---|");
  const table = conceptSections(concept("## Table\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n"))[1];
  assert.equal(table.text, "Table\n| a | b |\n| 1 | 2 |");
});

test("only document-level headings open sections; quoted and fenced headings are text", () => {
  const doc = concept(
    [
      "# Demo title",
      "",
      "> ## Quoted heading",
      "> quoted body",
      "",
      "```md",
      "## Fenced heading",
      "```",
      "",
      "- item one with a [link](../other.md) and `code`",
      "- item two",
      "",
      "| col a | col b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      '<div class="x">raw <b>html</b> block</div>',
      "",
      "Inline <span>html</span> stays text ![alt text](img.png).",
      "",
      "## Real",
      "",
      "Real body.",
    ].join("\n"),
  );
  const sections = conceptSections(doc);
  assert.deepEqual(
    sections.map((section) => section.slug),
    [null, "demo-title", "real"],
  );
  assert.equal(
    sections[1].text,
    [
      "Demo title",
      "Quoted heading",
      "quoted body",
      "## Fenced heading",
      "item one with a link and code",
      "item two",
      "| col a | col b |",
      "| 1 | 2 |",
      "raw html block",
      "Inline html stays text alt text.",
    ].join("\n"),
  );
});

test("sectionUnits yields the embedding unit shape for every section of both fixtures", () => {
  ["alpinaria", "atlas"].forEach((name) => {
    const index = buildProjectIndex(path.join(FIXTURES_ROOT, name, "okf.project.yaml"));
    const units = sectionUnits(index);
    assert.ok(units.length > index.concepts.length);
    assert.equal(new Set(units.map((unit) => unit.id)).size, units.length, `${name} ids unique`);
    units.forEach((unit) => {
      assert.deepEqual(Object.keys(unit), ["id", "text", "hash"]);
      assert.match(unit.hash, /^[a-f0-9]{64}$/);
      assert.equal(unit.hash, sha256(unit.text));
      assert.ok(unit.text.length > 0);
    });
    const ids = new Set(units.map((unit) => unit.id));
    const sidecar = JSON.parse(fs.readFileSync(path.join(FIXTURES_ROOT, name, "queries.json")));
    sidecar.queries
      .filter((query) => query.sectionAnchor)
      .forEach((query) => {
        const { uri, slug } = query.sectionAnchor;
        assert.ok(ids.has(`${uri}#${slug}`), `${name} ${query.id}: label is not a section anchor`);
      });
    // The preamble of every concept carries its URI as the anchor.
    index.concepts.forEach((doc) => {
      assert.ok(ids.has(doc.uri), doc.uri);
    });
  });
  assert.deepEqual(sectionUnits({}), []);
});
