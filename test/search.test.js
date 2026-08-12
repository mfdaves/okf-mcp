"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildIndex } = require("../src/indexer");
const { searchConcepts } = require("../src/search");

function writeConcept(root, relativePath, frontmatter, body) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const metadata = Object.entries(frontmatter).map(([key, value]) => (
    Array.isArray(value) ? `${key}: [${value.join(", ")}]` : `${key}: ${value}`
  ));
  fs.writeFileSync(target, [
    "---",
    ...metadata,
    "---",
    "",
    body || "",
    "",
  ].join("\n"), "utf8");
}

function searchFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-search-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeConcept(root, "title.md", {
    type: "Policy",
    title: "Payload Admission",
    tags: ["runtime"],
  }, "# Payload Admission\n\nClassifies work before execution.");
  writeConcept(root, "body.md", {
    type: "Concept",
    title: "Execution Details",
    tags: ["runtime"],
  }, "# Execution Details\n\nThe payload passes through admission before execution.");
  writeConcept(root, "partial.md", {
    type: "Concept",
    title: "Payload Details",
  }, "# Payload Details\n\nContains only one requested term.");
  writeConcept(root, "secret.md", {
    type: "Concept",
    title: "Unrelated Metadata",
    "x-private-marker": "hidden-token",
  }, "# Unrelated Metadata");
  return { root, index: buildIndex([{ id: "search", root }]) };
}

test("BM25+ search tokenizes queries, requires every term, and applies field boosts", (t) => {
  const { index } = searchFixture(t);
  const result = searchConcepts(index, { query: "ADMISSION, payload" });
  assert.equal(result.total, 2);
  assert.deepEqual(result.results.map((entry) => entry.path), ["title.md", "body.md"]);
  assert.equal(result.results[0].score > result.results[1].score, true);
  assert.match(result.results[0].snippet, /Payload Admission/);
  assert.equal(result.results.some((entry) => entry.path === "partial.md"), false);
});

test("search preserves filters, exact totals, pagination, and federated identity", (t) => {
  const roots = ["a", "b"].map((id) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `okf-search-${id}-`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    writeConcept(root, "shared.md", {
      type: "Concept",
      title: "Shared Search Marker",
      tags: [id],
    }, "# Shared Search Marker");
    return { id, root };
  });
  const index = buildIndex(roots);
  const first = searchConcepts(index, { query: "marker shared", limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].uri, "okf://a/shared");
  const second = searchConcepts(index, { query: "marker shared", limit: 1, offset: 1 });
  assert.equal(second.total, 2);
  assert.equal(second.results[0].uri, "okf://b/shared");
  const filtered = searchConcepts(index, { query: "marker shared", bundle: "b", tagsAll: ["b"] });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.results[0].uri, "okf://b/shared");
});

test("search bounds queries and ignores punctuation-only and arbitrary frontmatter text", (t) => {
  const { index } = searchFixture(t);
  assert.equal(searchConcepts(index, { query: "!!!" }).total, 0);
  assert.equal(searchConcepts(index, { query: "hidden token" }).total, 0);
  assert.throws(
    () => searchConcepts(index, { query: "a".repeat(513) }),
    /must not exceed 512 characters/,
  );
  assert.throws(
    () => searchConcepts(index, {
      query: Array.from({ length: 17 }, (_, indexValue) => `term${indexValue}`).join(" "),
    }),
    /must not exceed 16 terms/,
  );
});

test("a rebuilt OKF index receives a fresh lexical index", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-search-rebuild-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeConcept(root, "initial.md", { type: "Concept", title: "Initial" }, "# Initial");
  const initial = buildIndex([{ id: "rebuild", root }]);
  assert.equal(searchConcepts(initial, { query: "later addition" }).total, 0);

  writeConcept(root, "later.md", { type: "Concept", title: "Later Addition" }, "# Later Addition");
  const rebuilt = buildIndex([{ id: "rebuild", root }]);
  assert.equal(searchConcepts(rebuilt, { query: "later addition" }).total, 1);
  assert.equal(searchConcepts(rebuilt, { query: "later addition" }).results[0].path, "later.md");
});
