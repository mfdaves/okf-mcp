"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { ConceptAuthoringService } = require("../src/authoring");
const { buildIndex, resolveLinkPath } = require("../src/indexer");
const { FileConceptStore } = require("../src/store");

function concept(title, body) {
  return [
    "---",
    "type: Concept",
    `title: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
    body || "",
    "",
  ].join("\n");
}

function nestedIndex() {
  return [
    "# Nested",
    "",
    "- [Topic](topic.md)",
    "",
  ].join("\n");
}

test("direct indexed documents take precedence over directory fallback", () => {
  const byUri = new Map([
    ["okf://remote/nested", {
      uri: "okf://remote/direct-target",
      pathUri: "okf://remote/nested",
    }],
    ["okf://remote/nested/index.md", {
      uri: "okf://remote/nested/index.md",
      pathUri: "okf://remote/nested/index.md",
    }],
  ]);

  const resolved = resolveLinkPath(
    { id: "remote", remote: true },
    "reader.md",
    "nested/#overview",
    byUri,
  );

  assert.equal(resolved.path, "nested");
  assert.equal(resolved.uri, "okf://remote/direct-target");
});

test("custom concept ids cannot steal directory links from nested indexes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-directory-collision-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "nested", "index.md"), nestedIndex(), "utf8");
  fs.writeFileSync(path.join(root, "nested", "topic.md"), concept("Topic"), "utf8");
  fs.writeFileSync(path.join(root, "reader.md"), concept("Reader", "Read [Nested](nested/)."), "utf8");
  fs.writeFileSync(path.join(root, "shadow.md"), [
    "---",
    "id: okf://demo/nested",
    "type: Concept",
    "title: Shadow",
    "---",
    "",
    "# Shadow",
    "",
  ].join("\n"), "utf8");

  const index = buildIndex([`demo=${root}`]);
  const edge = index.edges.find((entry) => entry.href === "nested/");

  assert.equal(edge.broken, false);
  assert.equal(edge.target, "okf://demo/nested/index.md");
});

test("local directory links resolve to the nested reserved index document", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-directory-local-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.md"), "# Root\n\n- [Nested](nested/)\n", "utf8");
  fs.writeFileSync(path.join(root, "nested", "index.md"), nestedIndex(), "utf8");
  fs.writeFileSync(
    path.join(root, "nested", "topic.md"),
    concept("Topic", "See the [nested index](.) and [root index](../)."),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "reader.md"), concept("Reader", "Read [Nested](nested)."), "utf8");

  const index = buildIndex([`local=${root}`]);
  const directoryEdges = index.edges.filter((edge) => (
    edge.href === "nested/"
    || edge.href === "nested"
    || edge.href === "."
    || edge.href === "../"
  ));

  assert.equal(directoryEdges.length, 4);
  assert.equal(directoryEdges.every((edge) => !edge.broken), true);
  assert.equal(
    directoryEdges.some((edge) => edge.href === "nested/" && edge.target === "okf://local/nested/index.md"),
    true,
  );
  assert.equal(
    directoryEdges.some((edge) => edge.href === "nested" && edge.target === "okf://local/nested/index.md"),
    true,
  );
  assert.equal(
    directoryEdges.some((edge) => edge.href === "../" && edge.target === "okf://local/index.md"),
    true,
  );
  assert.equal(
    index.warnings.some((warning) => warning.code === "broken_link"),
    false,
  );
});

test("remote directory links resolve through the in-memory document map", () => {
  const index = buildIndex([{
    id: "remote",
    remote: true,
    documents: [
      { path: "index.md", text: "# Remote\n\n- [Nested](nested/)\n" },
      { path: "nested/index.md", text: nestedIndex() },
      { path: "nested/topic.md", text: concept("Topic", "Return to the [root index](../).") },
      { path: "reader.md", text: concept("Reader", "Read [Nested](nested).") },
    ],
  }]);
  const directoryEdges = index.edges.filter((edge) => (
    edge.href === "nested/"
    || edge.href === "nested"
    || edge.href === "../"
  ));

  assert.equal(directoryEdges.length, 3);
  assert.equal(directoryEdges.every((edge) => !edge.broken), true);
  assert.equal(
    directoryEdges.some((edge) => edge.href === "nested/" && edge.target === "okf://remote/nested/index.md"),
    true,
  );
  assert.equal(
    directoryEdges.some((edge) => edge.href === "nested" && edge.target === "okf://remote/nested/index.md"),
    true,
  );
  assert.equal(
    directoryEdges.some((edge) => edge.href === "../" && edge.target === "okf://remote/index.md"),
    true,
  );
  assert.equal(
    index.warnings.some((warning) => warning.code === "broken_link"),
    false,
  );
});

test("directory fallback preserves remote escape and broken-link diagnostics", () => {
  const index = buildIndex([{
    id: "remote",
    remote: true,
    documents: [{
      path: "reader.md",
      text: concept("Reader", "See [Outside](../outside/) and [Missing](missing/)."),
    }],
  }]);

  assert.equal(
    index.warnings.some((warning) => (
      warning.code === "link_outside_root"
      && warning.href === "../outside/"
    )),
    true,
  );
  assert.equal(
    index.edges.some((edge) => edge.href === "../outside/"),
    false,
  );
  assert.equal(
    index.warnings.some((warning) => (
      warning.code === "broken_link"
      && warning.href === "missing/"
      && warning.target === "missing"
    )),
    true,
  );
  assert.equal(
    index.edges.some((edge) => edge.href === "missing/" && edge.broken),
    true,
  );
});

test("authoring candidate validation uses nested index fallback", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-directory-authoring-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, "bundle");
  fs.mkdirSync(path.join(bundle, "nested"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "nested", "index.md"), nestedIndex(), "utf8");
  fs.writeFileSync(path.join(bundle, "nested", "topic.md"), concept("Topic"), "utf8");
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: Directory authoring",
    "bundles:",
    "  - id: app",
    "    root: bundle",
    "",
  ].join("\n"), "utf8");
  const store = FileConceptStore.fromProject(path.join(root, "okf.project.yaml"), {
    proposalRoot: path.join(root, ".okf-proposals"),
  });
  const service = new ConceptAuthoringService(store);

  const validation = service.validateConcept({
    bundle: "app",
    path: "candidate.md",
    frontmatter: { type: "Concept", title: "Candidate" },
    body: "# Candidate\n\nRead [Nested](nested/) or [Nested without slash](nested).",
  });

  assert.equal(validation.valid, true);
  assert.equal(
    validation.warnings.some((warning) => warning.code === "broken_link"),
    false,
  );
});
