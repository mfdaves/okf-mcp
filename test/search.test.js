"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildIndex, buildProjectIndex } = require("../src/indexer");
const {
  FRESHNESS_PRIOR,
  LOW_CONFIDENCE_COVERAGE,
  SEARCH_MODES,
  searchConcepts,
} = require("../src/search");
const {
  addDocuments,
  adoptSearchIndex,
  describeSearchIndex,
  removeDocuments,
} = require("../src/search/lexical");

const FIXTURES_ROOT = path.join(__dirname, "fixtures", "retrieval");

function writeConcept(root, relativePath, frontmatter, body) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const metadata = Object.entries(frontmatter).map(([key, value]) =>
    Array.isArray(value) ? `${key}: [${value.join(", ")}]` : `${key}: ${value}`,
  );
  fs.writeFileSync(target, ["---", ...metadata, "---", "", body || "", ""].join("\n"), "utf8");
}

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function searchFixture(t) {
  const root = tempRoot(t, "okf-search-");
  writeConcept(
    root,
    "title.md",
    { type: "Policy", title: "Payload Admission", tags: ["runtime"] },
    "# Payload Admission\n\nClassifies work before execution.",
  );
  writeConcept(
    root,
    "body.md",
    { type: "Concept", title: "Execution Details", tags: ["runtime"] },
    "# Execution Details\n\nThe payload passes through admission before execution.",
  );
  writeConcept(
    root,
    "partial.md",
    { type: "Concept", title: "Payload Details" },
    "# Payload Details\n\nContains only one requested term.",
  );
  writeConcept(
    root,
    "secret.md",
    { type: "Concept", title: "Unrelated Metadata", "x-private-marker": "hidden-token" },
    "# Unrelated Metadata",
  );
  return { root, index: buildIndex([{ id: "search", root }]) };
}

// Italian and English documents, an identifier, a custom id, and three
// equally scoring policies with different lifecycle signals.
function languageFixture(t) {
  const root = tempRoot(t, "okf-search-lang-");
  writeConcept(
    root,
    "cities.md",
    { type: "Concept", title: "Città metropolitana" },
    "# Città metropolitana\n\nLa città cresce.",
  );
  writeConcept(
    root,
    "products/trk-w-042.md",
    { type: "Product", title: "TRK-W-042 Dolomiti" },
    "# TRK-W-042 Dolomiti\n\nScarponi da trekking per la montagna.",
  );
  writeConcept(
    root,
    "mentions.md",
    { type: "Note", title: "Mentions" },
    "# Mentions\n\nThe trk 042 code appears in this note body only.",
  );
  writeConcept(
    root,
    "notes/trail.md",
    { type: "Note", title: "Trail", id: "okf://lang/runners" },
    "# Trail\n\nMountain paths.",
  );
  writeConcept(
    root,
    "a-old.md",
    { type: "Policy", title: "Shipping Policy", status: "deprecated" },
    "# Shipping Policy\n\nOld.",
  );
  writeConcept(
    root,
    "b-new.md",
    { type: "Policy", title: "Shipping Policy", status: "stable" },
    "# Shipping Policy\n\nCurrent.",
  );
  writeConcept(
    root,
    "c-stale.md",
    { type: "Policy", title: "Shipping Policy", stale_after: "2024-01-01" },
    "# Shipping Policy\n\nAgeing.",
  );
  return { root, index: buildIndex([{ id: "lang", root }]) };
}

const paths = (response) => response.results.map((entry) => entry.path);

test("the default mode requires every term, applies field boosts, and reports the match", (t) => {
  const { index } = searchFixture(t);
  const result = searchConcepts(index, { query: "ADMISSION, payload" });
  assert.equal(result.total, 2);
  assert.equal(result.mode, "all");
  assert.equal(result.allTermsTotal, 2);
  assert.equal(result.lowConfidence, false);
  assert.deepEqual(result.queryTerms, ["admission", "payload"]);
  assert.deepEqual(result.droppedTerms, []);
  assert.deepEqual(paths(result), ["title.md", "body.md"]);
  assert.equal(result.results[0].score > result.results[1].score, true);
  assert.match(result.results[0].snippet, /Payload Admission/);
  assert.deepEqual(result.results[0].matchedTerms, ["admission", "payload"]);
  assert.equal(result.results[0].coverage, 1);
  assert.equal(result.results[0].relevance, 1);
  assert.equal(result.results[1].coverage, 1);
  assert.ok(result.results[1].relevance > 0 && result.results[1].relevance < 1);
});

test("auto falls back to any-term matching and flags low coverage strictly below one half", (t) => {
  const { index } = searchFixture(t);
  assert.deepEqual(SEARCH_MODES, ["auto", "all", "any"]);
  assert.equal(LOW_CONFIDENCE_COVERAGE, 0.5);
  const fallback = searchConcepts(index, { query: "payload zzz yyy www" });
  assert.equal(fallback.mode, "any");
  assert.equal(fallback.total, 3);
  assert.equal(fallback.allTermsTotal, 0);
  assert.equal(fallback.results[0].coverage, 0.25);
  assert.deepEqual(fallback.results[0].matchedTerms, ["payload"]);
  assert.equal(fallback.lowConfidence, true);
  // Exactly one half is not flagged.
  const half = searchConcepts(index, { query: "payload admission zzz yyy" });
  assert.equal(half.mode, "any");
  assert.equal(half.results[0].coverage, 0.5);
  assert.equal(half.lowConfidence, false);
  // Explicit modes never fall back and never flag an all-term page.
  const strict = searchConcepts(index, { query: "payload zzz yyy www", mode: "all" });
  assert.deepEqual(
    [strict.total, strict.mode, strict.allTermsTotal, strict.lowConfidence],
    [0, "all", 0, false],
  );
  const any = searchConcepts(index, { query: "payload admission", mode: "any" });
  assert.equal(any.mode, "any");
  assert.equal(any.total, 3);
  assert.equal(any.allTermsTotal, 2);
  assert.equal(any.lowConfidence, false);
  assert.throws(
    () => searchConcepts(index, { query: "payload", mode: "fuzzy" }),
    /Search mode must be one of auto, all, any/,
  );
});

test("stop words and single letters are dropped and the term limit counts what is left", (t) => {
  const { index } = searchFixture(t);
  const dropped = searchConcepts(index, {
    query: "what is the payload admission?",
    languages: ["en"],
  });
  assert.deepEqual(dropped.queryTerms, ["payload", "admission"]);
  assert.deepEqual(dropped.droppedTerms, ["what", "is", "the"]);
  assert.equal(dropped.mode, "all");
  assert.equal(dropped.total, 2);
  const elided = searchConcepts(index, { query: "l'admission", languages: ["it", "en"] });
  assert.deepEqual([elided.queryTerms, elided.droppedTerms], [["admission"], ["l"]]);
  // A query made only of stop words is searched literally instead of silently emptied.
  const literal = searchConcepts(index, { query: "the is", languages: ["en"] });
  assert.deepEqual([literal.queryTerms, literal.droppedTerms], [["the", "is"], []]);
  const content = Array.from({ length: 16 }, (_, position) => `term${position}`);
  assert.doesNotThrow(() =>
    searchConcepts(index, { query: `${content.join(" ")} the a an of`, languages: ["en"] }),
  );
  assert.throws(
    () => searchConcepts(index, { query: content.concat(["term16"]).join(" "), languages: ["en"] }),
    /must not exceed 16 terms/,
  );
  // Without configured languages there is no stop list.
  const none = searchConcepts(index, { query: "the payload", languages: "none" });
  assert.deepEqual(none.queryTerms, ["the", "payload"]);
});

test("stems match morphological variants while the raw token stays indexed", (t) => {
  const { index } = searchFixture(t);
  const stemmed = searchConcepts(index, { query: "classify executions", languages: ["en"] });
  assert.equal(stemmed.mode, "all");
  assert.deepEqual(paths(stemmed), ["title.md"]);
  assert.match(stemmed.results[0].snippet, /Classifies work before execution/);
  const unstemmed = searchConcepts(index, { query: "classify executions", languages: "none" });
  assert.equal(unstemmed.total, 0);
  assert.equal(unstemmed.mode, "any");
  assert.equal(searchConcepts(index, { query: "Classifies", languages: ["en"] }).total, 1);
});

test("diacritics fold on both sides of the match", (t) => {
  const { index } = languageFixture(t);
  const plain = searchConcepts(index, { query: "citta" });
  assert.deepEqual(paths(plain), ["cities.md"]);
  assert.equal(plain.mode, "all");
  assert.match(plain.results[0].snippet, /Città/);
  const accented = searchConcepts(index, { query: "CITTÀ metropolitana" });
  assert.deepEqual(paths(accented), ["cities.md"]);
  assert.deepEqual(accented.queryTerms, ["città", "metropolitana"]);
});

test("the exact field keeps identifiers literal and is never stemmed", (t) => {
  const { index } = languageFixture(t);
  const sku = searchConcepts(index, { query: "TRK-W-042" });
  assert.deepEqual([sku.queryTerms, sku.droppedTerms], [["trk", "042"], ["w"]]);
  assert.equal(sku.mode, "all");
  assert.deepEqual(paths(sku), ["products/trk-w-042.md", "mentions.md"]);
  assert.ok(sku.results[0].relevance === 1 && sku.results[1].relevance < 0.5);
  // The custom id lands only in the exact field: the literal token matches, its stem does not.
  const plural = searchConcepts(index, { query: "runners", languages: ["en"] });
  assert.deepEqual(paths(plural), ["notes/trail.md"]);
  const singular = searchConcepts(index, { query: "runner", languages: ["en"], mode: "all" });
  assert.equal(singular.total, 0);
});

test("coverage and relevance floors filter results while allTermsTotal stays known", (t) => {
  const { index } = searchFixture(t);
  const floored = searchConcepts(index, { query: "payload admission zzz yyy", minCoverage: 0.5 });
  assert.equal(floored.mode, "any");
  assert.equal(floored.total, 2);
  assert.ok(floored.results.every((entry) => entry.coverage >= 0.5));
  const empty = searchConcepts(index, { query: "payload admission zzz yyy", minCoverage: 0.75 });
  assert.deepEqual(
    [empty.total, empty.results, empty.mode, empty.lowConfidence],
    [0, [], "any", false],
  );
  const relevance = searchConcepts(index, { query: "ADMISSION payload", minRelevance: 0.99 });
  assert.equal(relevance.total, 1);
  assert.equal(relevance.allTermsTotal, 2);
  assert.deepEqual(paths(relevance), ["title.md"]);
  assert.throws(
    () => searchConcepts(index, { query: "payload", minCoverage: 1.5 }),
    /minCoverage must be a number between 0 and 1/,
  );
  assert.throws(
    () => searchConcepts(index, { query: "payload", minRelevance: -1 }),
    /minRelevance must be a number between 0 and 1/,
  );
});

test("pagination under auto keeps totals, order and the confidence flag", (t) => {
  const { index } = searchFixture(t);
  const all = searchConcepts(index, { query: "payload zzz yyy www" });
  const pages = [0, 1, 2].map((offset) =>
    searchConcepts(index, { query: "payload zzz yyy www", limit: 1, offset }),
  );
  pages.forEach((page, position) => {
    assert.equal(page.total, 3);
    assert.equal(page.mode, "any");
    assert.equal(page.lowConfidence, true);
    assert.equal(page.results.length, 1);
    assert.equal(page.results[0].uri, all.results[position].uri);
  });
});

test("compact detail keeps coverage and relevance only; full detail adds matched terms, score and snippet", (t) => {
  const { index } = searchFixture(t);
  const compact = searchConcepts(index, { query: "payload admission", detail: "compact" });
  assert.deepEqual(Object.keys(compact.results[0]).sort(), [
    "coverage",
    "description",
    "relevance",
    "title",
    "type",
    "uri",
  ]);
  const full = searchConcepts(index, { query: "payload admission", detail: "full" }).results[0];
  ["matchedTerms", "score", "snippet", "coverage", "relevance", "signals"].forEach((key) => {
    assert.ok(key in full, key);
  });
  // Listings without a text query keep the 0.9.1 shape.
  const listing = searchConcepts(index, { detail: "compact" });
  assert.deepEqual(Object.keys(listing), ["total", "limit", "offset", "results"]);
  assert.deepEqual(Object.keys(listing.results[0]).sort(), ["description", "title", "type", "uri"]);
});

test("the freshness prior demotes deprecated, stale and draft concepts only when enabled", (t) => {
  const { index } = languageFixture(t);
  assert.deepEqual(FRESHNESS_PRIOR, { deprecated: 0.5, stale: 0.7, draft: 0.85 });
  const plain = searchConcepts(index, { query: "shipping policy", asOf: "2026-10-24" });
  assert.deepEqual(paths(plain), ["a-old.md", "b-new.md", "c-stale.md"]);
  assert.ok(plain.results.every((entry) => entry.relevance === 1));
  const prior = searchConcepts(index, {
    query: "shipping policy",
    asOf: "2026-10-24",
    freshnessPrior: true,
  });
  assert.deepEqual(paths(prior), ["b-new.md", "c-stale.md", "a-old.md"]);
  const close = (left, right) => Math.abs(left - right) < 1e-9;
  assert.ok(close(prior.results[0].relevance, 1));
  assert.ok(close(prior.results[1].relevance, 0.7));
  assert.ok(close(prior.results[2].relevance, 0.5));
});

test("auto detection picks each retrieval fixture's language set", () => {
  const alpinaria = buildProjectIndex(path.join(FIXTURES_ROOT, "alpinaria", "okf.project.yaml"));
  const first = describeSearchIndex(alpinaria);
  assert.equal(first.requested, "auto");
  assert.deepEqual(first.languages, ["it", "en"]);
  assert.equal(first.detection.documents, alpinaria.concepts.length);
  assert.ok(first.detection.counts.it > first.detection.counts.en);
  const atlas = buildProjectIndex(path.join(FIXTURES_ROOT, "atlas", "okf.project.yaml"));
  const second = describeSearchIndex(atlas);
  assert.deepEqual(second.languages, ["en", "it"]);
  assert.ok(second.detection.counts.en > second.detection.counts.it);
  assert.ok(second.detection.counts.it / second.detection.documents >= 0.05);
});

test("search languages come from the option, the index, the project config, then detection", (t) => {
  const { index } = languageFixture(t);
  assert.deepEqual(describeSearchIndex(index).languages, ["it", "en"]);
  assert.deepEqual(describeSearchIndex(index, { languages: "none" }).languages, []);
  assert.deepEqual(describeSearchIndex(index, { languages: "en" }).languages, ["en"]);
  index.project = { languages: ["en"] };
  assert.deepEqual(describeSearchIndex(index), {
    requested: ["en"],
    languages: ["en"],
    detection: null,
  });
  index.languages = "it";
  assert.deepEqual(describeSearchIndex(index).languages, ["it"]);
  assert.throws(
    () => searchConcepts(index, { query: "trail", languages: ["fr"] }),
    /Unsupported search language: fr/,
  );
});

test("addDocuments, removeDocuments and adoptSearchIndex keep the lexical index in step", (t) => {
  const { root, index } = searchFixture(t);
  assert.equal(addDocuments(index, []), false);
  assert.equal(searchConcepts(index, { query: "payload" }).total, 3);
  writeConcept(root, "late.md", { type: "Concept", title: "Late Payload" }, "# Late Payload");
  const lateDoc = buildIndex([{ id: "search", root }]).byUri.get("okf://search/late");
  index.concepts.push(lateDoc);
  assert.equal(addDocuments(index, [lateDoc]), true);
  assert.equal(searchConcepts(index, { query: "payload" }).total, 4);
  assert.equal(removeDocuments(index, [lateDoc.uri]), true);
  index.concepts.pop();
  assert.equal(searchConcepts(index, { query: "payload" }).total, 3);
  const next = Object.assign({}, index);
  assert.equal(adoptSearchIndex(index, next), true);
  assert.equal(adoptSearchIndex(index, next), false);
  assert.equal(addDocuments(index, [lateDoc]), false);
  assert.deepEqual(paths(searchConcepts(next, { query: "payload admission" })), [
    "title.md",
    "body.md",
  ]);
});

test("search preserves filters, exact totals, pagination, and federated identity", (t) => {
  const roots = ["a", "b"].map((id) => {
    const root = tempRoot(t, `okf-search-${id}-`);
    writeConcept(
      root,
      "shared.md",
      { type: "Concept", title: "Shared Search Marker", tags: [id] },
      "# Shared Search Marker",
    );
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
  const punctuation = searchConcepts(index, { query: "!!!" });
  assert.deepEqual([punctuation.total, punctuation.mode, punctuation.queryTerms], [0, "all", []]);
  assert.equal(searchConcepts(index, { query: "hidden token" }).total, 0);
  assert.throws(
    () => searchConcepts(index, { query: "a".repeat(513) }),
    /must not exceed 512 characters/,
  );
  assert.throws(
    () =>
      searchConcepts(index, {
        query: Array.from({ length: 17 }, (_, indexValue) => `term${indexValue}`).join(" "),
      }),
    /must not exceed 16 terms/,
  );
});

test("compact search bounds returned text while full detail remains lossless", (t) => {
  const root = tempRoot(t, "okf-search-compact-");
  const description = "x".repeat(50000);
  writeConcept(root, "large.md", { type: "Reference", title: "Large", description }, "# Large");
  const index = buildIndex([{ id: "compact", root }]);
  const compact = searchConcepts(index, { detail: "compact" }).results[0];
  const full = searchConcepts(index, { detail: "full" }).results[0];
  assert.equal(compact.description.length, 500);
  assert.equal(compact.description.endsWith("…"), true);
  assert.equal(full.description, description);
});

test("a rebuilt OKF index receives a fresh lexical index", (t) => {
  const root = tempRoot(t, "okf-search-rebuild-");
  writeConcept(root, "initial.md", { type: "Concept", title: "Initial" }, "# Initial");
  const initial = buildIndex([{ id: "rebuild", root }]);
  assert.equal(searchConcepts(initial, { query: "later addition" }).total, 0);

  writeConcept(root, "later.md", { type: "Concept", title: "Later Addition" }, "# Later Addition");
  const rebuilt = buildIndex([{ id: "rebuild", root }]);
  assert.equal(searchConcepts(rebuilt, { query: "later addition" }).total, 1);
  assert.equal(searchConcepts(rebuilt, { query: "later addition" }).results[0].path, "later.md");
});
