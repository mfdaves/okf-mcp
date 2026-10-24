"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CONTEXT_TOKEN_ESTIMATOR,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_PREAMBLE_WEIGHT,
  assembleContext,
  estimateContextTokens,
} = require("../src/context/assemble");
const { conceptSections } = require("../src/context/sections");
const { buildIndex, buildProjectIndex, updateIndex } = require("../src/indexer");

const FIXTURES_ROOT = path.join(__dirname, "fixtures", "retrieval");
const ALPINARIA = path.join(FIXTURES_ROOT, "alpinaria", "okf.project.yaml");
const SEED = 20261024;

function mulberry32(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fixtureQueries(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_ROOT, name, "queries.json"), "utf8"));
}

function tempBundle(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  Object.entries(files).forEach(([relativePath, content]) => {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  });
  return buildIndex([`demo=${root}`]);
}

function note(title, body, extra) {
  return `---\ntype: Note\ntitle: "${title}"\ndescription: "About ${title}."\n${extra || ""}---\n\n# ${title}\n\n${body}\n`;
}

const checkBudget = (result, budget, limit) => {
  assert.ok(result.usedTokens <= budget, `used ${result.usedTokens} > budget ${budget}`);
  assert.equal(
    result.usedTokens,
    result.sections.reduce((sum, section) => sum + section.tokens, 0),
  );
  result.sections.forEach((section) => {
    assert.equal(section.tokens, Math.ceil(section.text.length / 4));
    assert.equal(section.tokens, estimateContextTokens(section.text));
  });
  assert.ok(result.sections.length <= limit);
};

test("the budget is never exceeded across random budgets, limits and queries", () => {
  const index = buildProjectIndex(ALPINARIA);
  const sidecar = fixtureQueries("alpinaria");
  const random = mulberry32(SEED);
  for (let round = 0; round < 80; round += 1) {
    const query = sidecar.queries[Math.floor(random() * sidecar.queries.length)];
    const budgetTokens = 1 + Math.floor(random() * 2500);
    const limit = 1 + Math.floor(random() * 30);
    const result = assembleContext(index, {
      query: query.query,
      budgetTokens,
      limit,
      asOf: sidecar.as_of,
    });
    checkBudget(result, budgetTokens, limit);
    assert.equal(result.budgetTokens, budgetTokens);
    assert.equal(result.estimator, "chars/4");
    assert.equal(
      new Set(result.sections.map((section) => section.anchor)).size,
      result.sections.length,
    );
    if (result.truncated) {
      assert.equal(result.sections.length, 1);
      assert.equal(result.sections[0].truncated, true);
    } else {
      assert.ok(result.sections.every((section) => section.truncated === false));
    }
  }
  assert.equal(CONTEXT_TOKEN_ESTIMATOR, "chars/4");
  assert.equal(DEFAULT_CONTEXT_BUDGET_TOKENS, 1200);
});

test("assembly is deterministic and ordered by score, candidate rank and document order", () => {
  const index = buildProjectIndex(ALPINARIA);
  const options = { query: "scarponi da trekking donna", budgetTokens: 1200, asOf: "2026-10-24" };
  const first = assembleContext(index, options);
  const second = assembleContext(index, options);
  assert.deepEqual(second, first);
  const rebuilt = assembleContext(buildProjectIndex(ALPINARIA), options);
  assert.deepEqual(rebuilt, first);
  assert.ok(first.sections.length > 3);
  const rankOf = new Map(first.concepts.map((concept) => [concept.uri, concept.rank]));
  for (let position = 1; position < first.sections.length; position += 1) {
    const previous = first.sections[position - 1];
    const current = first.sections[position];
    assert.ok(previous.score >= current.score, "scores descend");
    if (previous.score === current.score) {
      const previousRank = rankOf.get(previous.uri);
      const currentRank = rankOf.get(current.uri);
      assert.ok(previousRank <= currentRank, "ties fall back to candidate rank");
      if (previousRank === currentRank) {
        const anchors = conceptSections(index.byUri.get(current.uri)).map((s) => s.anchor);
        assert.ok(anchors.indexOf(previous.anchor) < anchors.indexOf(current.anchor));
      }
    }
  }
  assert.equal(first.sections[0].relevance, 1);
  first.sections.forEach((section) => {
    assert.ok(rankOf.has(section.uri), "every section belongs to a candidate concept");
    assert.ok(section.coverage > 0 && section.coverage <= 1);
    assert.ok(section.matchedTerms.length >= 1);
  });
  // Both anchor forms occur: the concept URI for a preamble, uri#slug for a heading.
  assert.ok(first.sections.some((section) => !section.anchor.includes("#")));
  assert.ok(first.sections.some((section) => section.anchor.includes("#")));
  assert.deepEqual(Object.keys(first), [
    "query",
    "budgetTokens",
    "estimator",
    "usedTokens",
    "mode",
    "lowConfidence",
    "queryTerms",
    "droppedTerms",
    "concepts",
    "sections",
    "totalSections",
    "omittedSections",
    "truncated",
  ]);
});

test("identical sections are packed once and the first in rank order wins", (t) => {
  const shared = "## Notes\n\nShared boilerplate about the kestrel widget.\n";
  const index = tempBundle(t, {
    "a.md": note("Alpha kestrel", `Alpha body about the kestrel.\n\n${shared}`),
    "b.md": note("Beta kestrel", `Beta body about the kestrel.\n\n${shared}`),
    "c.md": note("Gamma", "Nothing relevant here.\n"),
  });
  const result = assembleContext(index, { query: "kestrel widget", budgetTokens: 1000 });
  const notes = result.sections.filter((section) => section.anchor.endsWith("#notes"));
  assert.equal(notes.length, 1, "one copy of the shared section");
  assert.equal(notes[0].text, "Notes\nShared boilerplate about the kestrel widget.");
  const hashes = new Set();
  result.sections.forEach((section) => {
    const match = conceptSections(index.byUri.get(section.uri)).find(
      (candidate) => candidate.anchor === section.anchor,
    );
    assert.ok(match);
    assert.equal(hashes.has(match.hash), false);
    hashes.add(match.hash);
  });
  assert.ok(result.sections.every((section) => section.uri !== "okf://demo/c"));
});

test("a best section larger than the budget is returned alone, cut at a sentence boundary", (t) => {
  const sentences = [];
  for (let n = 1; n <= 40; n += 1) {
    sentences.push(`Sentence ${n} about the heron migration pattern and its timing.`);
  }
  const index = tempBundle(t, {
    "long.md": note("Heron study", `## Findings\n\n${sentences.join(" ")}\n`),
    "short.md": note("Heron note", "## Aside\n\nA short heron aside.\n"),
  });
  const full = assembleContext(index, { query: "heron migration timing", budgetTokens: 5000 });
  const findings = full.sections.find((section) => section.anchor.endsWith("#findings"));
  assert.ok(findings && !findings.truncated && findings.tokens > 100);
  assert.equal(full.sections[0].anchor, findings.anchor, "the long section ranks first");
  const budget = 60;
  const cut = assembleContext(index, { query: "heron migration timing", budgetTokens: budget });
  assert.equal(cut.truncated, true);
  assert.equal(cut.sections.length, 1);
  assert.equal(cut.omittedSections, full.totalSections - 1);
  const [section] = cut.sections;
  assert.equal(section.anchor, findings.anchor);
  assert.equal(section.truncated, true);
  assert.ok(section.tokens <= budget);
  assert.equal(cut.usedTokens, section.tokens);
  assert.ok(findings.text.startsWith(section.text));
  assert.match(section.text, /timing\.$/, "ends at a sentence boundary");
  assert.ok(section.text.length > budget * 4 * 0.5);
  // A budget below any sentence falls back to a word boundary, still within budget.
  const tiny = assembleContext(index, { query: "heron migration timing", budgetTokens: 6 });
  assert.equal(tiny.sections.length, 1);
  assert.ok(tiny.sections[0].tokens <= 6);
  assert.ok(findings.text.startsWith(tiny.sections[0].text));
  assert.doesNotMatch(tiny.sections[0].text, /\s$/);
});

test("filters, mode and asOf are honoured and the preamble carries the lead fields", () => {
  const index = buildProjectIndex(ALPINARIA);
  const landing = assembleContext(index, {
    query: "scarponi donna",
    types: ["Landing Page"],
    budgetTokens: 2000,
  });
  assert.ok(landing.sections.length > 0);
  landing.sections.forEach((section) => {
    assert.equal(index.byUri.get(section.uri).type, "Landing Page");
  });
  landing.concepts.forEach((concept) => {
    assert.equal(index.byUri.get(concept.uri).type, "Landing Page");
  });
  const prefixed = assembleContext(index, {
    query: "scarponi donna",
    pathPrefix: "decisions/",
    budgetTokens: 2000,
  });
  prefixed.sections.forEach((section) => {
    assert.ok(index.byUri.get(section.uri).path.startsWith("decisions/"));
  });
  const none = assembleContext(index, { query: "scarponi donna", bundle: "missing" });
  assert.deepEqual([none.sections, none.concepts, none.usedTokens], [[], [], 0]);
  const all = assembleContext(index, { query: "scarponi trekking donna", mode: "all" });
  assert.equal(all.mode, "all");
  const any = assembleContext(index, { query: "scarponi trekking donna", mode: "any" });
  assert.equal(any.mode, "any");
  assert.ok(any.concepts.length >= all.concepts.length);
  const preamble = all.sections.find((section) => !section.anchor.includes("#"));
  assert.ok(preamble);
  const doc = index.byUri.get(preamble.uri);
  assert.ok(preamble.text.startsWith(`${doc.title}\n`));
  assert.equal(preamble.heading, null);
  assert.equal(preamble.title, doc.title);
  // asOf changes freshness in the provenance the same way it does in search.
  const stale = index.concepts.find((candidate) => candidate.signals.staleAfter);
  if (stale) {
    const later = assembleContext(index, {
      query: `"${stale.conceptId}"`,
      asOf: "2099-01-01",
      budgetTokens: 400,
    });
    const hit = later.sections.find((section) => section.uri === stale.uri);
    assert.ok(hit);
    assert.equal(hit.provenance.freshness, "stale");
  }
});

test("a no-answer query is flagged lowConfidence and yields weak sections; nonsense yields none", () => {
  const index = buildProjectIndex(ALPINARIA);
  const sidecar = fixtureQueries("alpinaria");
  const flagged = sidecar.queries
    .filter((query) => query.category === "no-answer")
    .map((query) => assembleContext(index, { query: query.query, asOf: sidecar.as_of }))
    .filter((result) => result.lowConfidence);
  assert.ok(flagged.length >= 5, `flagged ${flagged.length} no-answer queries`);
  flagged.forEach((result) => {
    assert.equal(result.mode, "any");
    result.sections.forEach((section) => {
      assert.ok(section.coverage < 0.5, "every packed section matched under half of the terms");
    });
  });
  const nonsense = assembleContext(index, { query: "zxqv wmbk plork" });
  assert.deepEqual([nonsense.sections, nonsense.concepts, nonsense.totalSections], [[], [], 0]);
  assert.equal(nonsense.lowConfidence, false);
  assert.equal(nonsense.truncated, false);
});

test("provenance comes from the concept's v0.2 signals and can be left out", () => {
  const index = buildProjectIndex(ALPINARIA);
  const result = assembleContext(index, { query: "scarponi donna", budgetTokens: 600 });
  assert.ok(result.sections.length > 0);
  result.sections.forEach((section) => {
    const doc = index.byUri.get(section.uri);
    assert.deepEqual(Object.keys(section.provenance), [
      "status",
      "staleAfter",
      "freshness",
      "trustTier",
      "verified",
      "generated",
      "sources",
    ]);
    assert.equal(section.provenance.status, doc.signals.status);
    assert.equal(section.provenance.trustTier, doc.signals.trustTier);
    assert.equal(section.provenance.sources.length, doc.signals.sources.length);
    section.provenance.sources.forEach((source) => {
      assert.ok(Object.keys(source).every((key) => ["id", "resource", "author"].includes(key)));
    });
    if (doc.signals.generated) {
      assert.deepEqual(section.provenance.generated, {
        by: doc.signals.generated.by,
        at: doc.signals.generated.at,
      });
    }
  });
  const bare = assembleContext(index, {
    query: "scarponi donna",
    budgetTokens: 600,
    includeProvenance: false,
  });
  bare.sections.forEach((section) => {
    assert.equal("provenance" in section, false);
  });
  assert.deepEqual(
    bare.sections.map((section) => section.anchor),
    result.sections.map((section) => section.anchor),
  );
});

test("invalid options are rejected with TypeErrors", () => {
  const index = buildProjectIndex(ALPINARIA);
  assert.throws(() => assembleContext(index, {}), /requires a query/);
  assert.throws(() => assembleContext(index, { query: "   " }), /requires a query/);
  ["0", 0, 1.5, "abc", -3, 100001].forEach((budgetTokens) => {
    assert.throws(
      () => assembleContext(index, { query: "scarponi", budgetTokens }),
      /budgetTokens must be an integer from 1 through 100000/,
    );
  });
  assert.throws(
    () => assembleContext(index, { query: "scarponi", limit: 0 }),
    /limit must be an integer from 1 through 250/,
  );
  assert.throws(
    () => assembleContext(index, { query: "scarponi", conceptLimit: 51 }),
    /conceptLimit must be an integer from 1 through 50/,
  );
  assert.throws(
    () => assembleContext(index, { query: "scarponi", mode: "bogus" }),
    /Search mode must be one of auto, all, any/,
  );
  assert.throws(
    () => assembleContext(index, { query: "scarponi", minRelevance: 2 }),
    /minRelevance must be a number between 0 and 1/,
  );
});

test("the preamble weight scales only preamble scores and is validated", (t) => {
  const index = tempBundle(t, {
    "a.md": note(
      "Osprey nesting",
      "Lead about the osprey.\n\n## Nesting sites\n\nOsprey nesting on poles.\n",
    ),
  });
  const run = (preambleWeight) =>
    assembleContext(index, { query: "osprey nesting", budgetTokens: 1000, preambleWeight });
  const byAnchor = (result) => new Map(result.sections.map((section) => [section.anchor, section]));
  const full = byAnchor(run(1));
  const half = byAnchor(run(0.5));
  assert.equal(half.get("okf://demo/a").score, full.get("okf://demo/a").score * 0.5);
  assert.equal(
    half.get("okf://demo/a#nesting-sites").score,
    full.get("okf://demo/a#nesting-sites").score,
  );
  assert.equal(DEFAULT_PREAMBLE_WEIGHT, 0.5);
  assert.deepEqual(
    byAnchor(assembleContext(index, { query: "osprey nesting", budgetTokens: 1000 })),
    half,
  );
  [0, -1, 1.5, "x"].forEach((preambleWeight) => {
    assert.throws(() => run(preambleWeight), /preambleWeight must be a number greater than 0/);
  });
});

test("sections are computed per document, so an index update re-reads only changed concepts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-context-update-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "a.md"), note("Plover", "## Range\n\nPlover coastal range.\n"));
  fs.writeFileSync(
    path.join(root, "b.md"),
    note("Plover eggs", "## Clutch\n\nPlover clutch size.\n"),
  );
  const index = buildIndex([`demo=${root}`]);
  const before = assembleContext(index, { query: "plover", budgetTokens: 1000 });
  assert.ok(before.sections.some((section) => section.anchor === "okf://demo/a#range"));
  fs.writeFileSync(path.join(root, "a.md"), note("Plover", "## Habitat\n\nPlover dunes.\n"));
  const next = updateIndex(
    index,
    { upserts: [{ bundleId: "demo", relativePath: "a.md" }] },
    { maxChangeRatio: 1 },
  );
  assert.equal(next.byUri.get("okf://demo/b"), index.byUri.get("okf://demo/b"));
  assert.equal(
    conceptSections(next.byUri.get("okf://demo/b")),
    conceptSections(index.byUri.get("okf://demo/b")),
    "the unchanged concept keeps its memoised sections",
  );
  const anchors = assembleContext(next, { query: "plover", budgetTokens: 1000 }).sections.map(
    (section) => section.anchor,
  );
  assert.ok(anchors.includes("okf://demo/a#habitat"));
  assert.equal(anchors.includes("okf://demo/a#range"), false);
});

test("a section is found through its concept's type, tags and path", (t) => {
  const index = tempBundle(t, {
    "runbooks/rotate-keys.md": note(
      "Rotate keys",
      "## Steps\n\nGenerate the new key and deploy it.\n",
      "tags: [security]\n",
    ),
  });
  const result = assembleContext(index, {
    query: "rotate keys security steps",
    budgetTokens: 1000,
  });
  const steps = result.sections.find((section) => section.anchor.endsWith("#steps"));
  assert.ok(steps);
  assert.deepEqual(steps.matchedTerms.slice().sort(), ["keys", "rotate", "security", "steps"]);
});
