"use strict";

// WP3c-2 step 1: the adaptive fusion weight. Unit tests of the rule (boundaries, monotonicity,
// validation), the byte-for-byte reproduction of 0.11.0-rc.2 at a fixed alpha 0.4, one weight
// per query across pages, the weight the fixture queries receive checked against the rule
// recomputed from the lexical response, and the configuration plumbing through the runtime and
// the MCP server against the fake embeddings server.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildProjectIndex } = require("../src/indexer");
const { normalizeEmbeddingConfig } = require("../src/search/embedding-config");
const {
  ADAPTIVE_ALPHA,
  ALPHA_REASONS,
  DEFAULT_ADAPTIVE_WEIGHTS,
  adaptiveAlpha,
  adaptiveWeights,
  fusionAlphaSetting,
  resolveAlpha,
} = require("../src/search/fusion");
const { openEmbeddingRuntime } = require("../src/search/hybrid");
const { analyzeQuery, searchLanguages } = require("../src/search/lexical");
const { searchConcepts } = require("../src/search/query");
const { callTool, createStateAsync } = require("../src/mcp/server");
const { startFakeEmbeddingsServer } = require("./fake-embeddings-server");
const { bagOfWordsEmbedder, hybridDigests } = require("./helpers/hybrid-golden");

const RETRIEVAL = path.join(__dirname, "fixtures", "retrieval");
const WEIGHTS = { low: 0.2, mid: 0.4, high: 0.75 };

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("the adaptive rule: literal terms low, all-term hits mid, weak lexical high, linear between", () => {
  const rule = (signals) => adaptiveAlpha(Object.assign({ autoFill: 3 }, signals), WEIGHTS);
  // Literal terms matched by the all-term pass win over every other signal.
  assert.deepEqual(rule({ literal: true, allTermsTotal: 9, topCoverage: 1 }), {
    alpha: 0.2,
    reason: "literal_terms",
  });
  assert.deepEqual(rule({ literal: true, allTermsTotal: 0, topCoverage: 0 }), {
    alpha: 0.2,
    reason: "literal_terms",
  });
  // At least autoFill all-term hits: mid. Exactly autoFill counts.
  assert.deepEqual(rule({ allTermsTotal: 3, topCoverage: 1 }), { alpha: 0.4, reason: "all_terms" });
  assert.deepEqual(rule({ allTermsTotal: 40, topCoverage: 1 }), {
    alpha: 0.4,
    reason: "all_terms",
  });
  // Fewer all-term hits than autoFill: coverage 1 sits at the mid end of the line.
  assert.deepEqual(rule({ allTermsTotal: 2, topCoverage: 1 }), {
    alpha: 0.4,
    reason: "interpolated",
  });
  // No all-term hit and coverage strictly below 0.5: high.
  assert.deepEqual(rule({ allTermsTotal: 0, topCoverage: 0 }), {
    alpha: 0.75,
    reason: "weak_lexical",
  });
  assert.deepEqual(rule({ allTermsTotal: 0, topCoverage: 0.499 }), {
    alpha: 0.75,
    reason: "weak_lexical",
  });
  // Coverage 0.5 starts the line at high, so the rule is continuous at the boundary.
  assert.deepEqual(rule({ allTermsTotal: 0, topCoverage: 0.5 }), {
    alpha: 0.75,
    reason: "interpolated",
  });
  assert.deepEqual(rule({ allTermsTotal: 0, topCoverage: 0.75 }), {
    alpha: 0.575,
    reason: "interpolated",
  });
  // autoFill 0 (the 0.10 rule): any all-term hit is enough for mid.
  assert.equal(
    adaptiveAlpha({ allTermsTotal: 1, autoFill: 0, topCoverage: 1 }, WEIGHTS).alpha,
    0.4,
  );
  // Out-of-range signals are clamped, missing ones read as zero.
  assert.equal(rule({ allTermsTotal: 0, topCoverage: -3 }).alpha, 0.75);
  assert.equal(adaptiveAlpha({}, WEIGHTS).reason, "weak_lexical");
  assert.equal(adaptiveAlpha(undefined, undefined).alpha, DEFAULT_ADAPTIVE_WEIGHTS.high);
  ["fixed", "literal_terms", "all_terms", "weak_lexical", "interpolated"].forEach((reason) => {
    assert.ok(ALPHA_REASONS.includes(reason));
  });
});

test("the adaptive weight never grows with the lexical coverage, for every weight grid", () => {
  const grid = [0, 0.2, 0.4, 0.6, 0.8, 1];
  grid.forEach((mid) => {
    grid
      .filter((high) => high >= mid)
      .forEach((high) => {
        const weights = { low: 0.1, mid, high };
        [0, 1, 2, 3, 7].forEach((allTermsTotal) => {
          let previous = Infinity;
          for (let step = 0; step <= 100; step += 1) {
            const topCoverage = step / 100;
            // All-term hits imply coverage 1; below it only the no-all-term case is possible.
            if (allTermsTotal > 0 && topCoverage < 1) continue;
            const { alpha } = adaptiveAlpha({ allTermsTotal, autoFill: 3, topCoverage }, weights);
            assert.ok(alpha >= mid - 1e-12 && alpha <= high + 1e-12, `${alpha} in [mid, high]`);
            assert.ok(alpha <= previous + 1e-12, `non-increasing at coverage ${topCoverage}`);
            previous = alpha;
          }
        });
      });
  });
});

test("fixed weights pass through and settings and weights are validated", () => {
  assert.deepEqual(resolveAlpha(0.3, { literal: true }, WEIGHTS), { alpha: 0.3, reason: "fixed" });
  assert.deepEqual(resolveAlpha("0.6", {}, WEIGHTS), { alpha: 0.6, reason: "fixed" });
  assert.equal(resolveAlpha(ADAPTIVE_ALPHA, { literal: true }, WEIGHTS).reason, "literal_terms");
  assert.equal(fusionAlphaSetting("adaptive"), ADAPTIVE_ALPHA);
  assert.equal(fusionAlphaSetting(0), 0);
  for (const bad of ["Adaptive", "auto", 1.5, -0.1, true, "x"]) {
    assert.throws(() => fusionAlphaSetting(bad), TypeError, String(bad));
  }
  assert.equal(adaptiveWeights(undefined), DEFAULT_ADAPTIVE_WEIGHTS);
  assert.deepEqual(
    adaptiveWeights({ high: 0.9 }),
    Object.assign({}, DEFAULT_ADAPTIVE_WEIGHTS, { high: 0.9 }),
  );
  for (const bad of [
    { mid: 0.8, high: 0.5 },
    { low: 2 },
    { highest: 1 },
    [0.1, 0.4, 0.7],
    "adaptive",
  ]) {
    assert.throws(() => adaptiveWeights(bad), TypeError, JSON.stringify(bad));
  }
});

test("a fixed alpha 0.4 ranks byte for byte as 0.11.0-rc.2 did on both fixtures", async () => {
  const record = JSON.parse(
    fs.readFileSync(path.join(RETRIEVAL, "rc2-hybrid-golden.json"), "utf8"),
  );
  const current = await hybridDigests(path.join(__dirname, "..", "src"));
  Object.entries(record.digests).forEach(([set, fixtures]) => {
    Object.entries(fixtures).forEach(([fixture, queries]) => {
      const mismatched = Object.keys(queries).filter(
        (id) => current[set][fixture][id] !== queries[id],
      );
      assert.deepEqual(mismatched, [], `option set ${set}, ${fixture}`);
      assert.equal(Object.keys(current[set][fixture]).length, Object.keys(queries).length);
    });
  });
  assert.equal(Object.keys(record.digests[0].alpinaria).length, 203);
  assert.equal(Object.keys(record.digests[0].atlas).length, 99);
});

// The alpinaria fixture with bag-of-words vectors, for the adaptive tests below.
async function adaptiveWorld(t) {
  const root = path.join(RETRIEVAL, "alpinaria");
  const runtime = await openEmbeddingRuntime(
    {
      embedder: bagOfWordsEmbedder(),
      cacheDir: tempDir(t, "okf-adaptive-cache-"),
      fusion: { alpha: ADAPTIVE_ALPHA, adaptive: WEIGHTS },
    },
    { root },
  );
  const index = buildProjectIndex(path.join(root, "okf.project.yaml"));
  await runtime.sync(index);
  const { queries } = JSON.parse(fs.readFileSync(path.join(root, "queries.json"), "utf8"));
  return { runtime, index, queries };
}

test("the adaptive weight is decided once per query: every page uses it", async (t) => {
  const { runtime, index, queries } = await adaptiveWorld(t);
  const uris = (response) => response.results.map((entry) => entry.uri);
  const reasons = new Set();
  for (const { query } of queries.filter((_entry, position) => position % 9 === 0)) {
    const { vector } = await runtime.encodeQuery(query);
    const options = (limit, offset) => ({
      query,
      limit,
      offset,
      hybrid: true,
      queryVector: vector,
      vectorCache: runtime.cache,
      embedUnits: runtime.units,
      alpha: ADAPTIVE_ALPHA,
      adaptiveAlpha: WEIGHTS,
    });
    const whole = searchConcepts(index, options(250, 0));
    reasons.add(whole.alphaReason);
    const pages = [];
    for (let offset = 0; offset < whole.total; offset += 7) {
      const page = searchConcepts(index, options(7, offset));
      assert.equal(page.alphaUsed, whole.alphaUsed, query);
      assert.equal(page.alphaReason, whole.alphaReason, query);
      assert.equal(page.total, whole.total, query);
      pages.push(...uris(page));
    }
    assert.deepEqual(pages, uris(whole), query);
  }
  assert.ok(reasons.size >= 2, `several reasons seen: ${Array.from(reasons)}`);
});

test("every alpinaria query gets the weight the rule gives its lexical signals", async (t) => {
  const { runtime, index, queries } = await adaptiveWorld(t);
  const seen = new Map();
  for (const entry of queries) {
    const response = await runtime.search(index, { query: entry.query, limit: 10 });
    assert.equal(response.hybrid, true, entry.id);
    const lexical = searchConcepts(index, { query: entry.query, limit: 250 });
    const analysis = analyzeQuery(entry.query, { languages: searchLanguages(index, {}) });
    const literal =
      lexical.mode !== "any" &&
      lexical.allTermsTotal > 0 &&
      analysis.tokens.some((token) => token.kind !== "plain");
    const expected = adaptiveAlpha(
      {
        literal,
        allTermsTotal: lexical.allTermsTotal,
        autoFill: 3,
        topCoverage: lexical.results.reduce((best, hit) => Math.max(best, hit.coverage), 0),
      },
      WEIGHTS,
    );
    assert.equal(response.alphaUsed, expected.alpha, entry.id);
    assert.equal(response.alphaReason, expected.reason, entry.id);
    assert.equal(response.alpha, response.alphaUsed, `${entry.id}: alpha is the weight used`);
    seen.set(expected.reason, (seen.get(expected.reason) || 0) + 1);
  }
  // The fixture exercises every branch of the rule.
  ["literal_terms", "all_terms", "weak_lexical", "interpolated"].forEach((reason) => {
    assert.ok(seen.get(reason) > 0, `${reason}: ${JSON.stringify(Object.fromEntries(seen))}`);
  });
  assert.equal(runtime.status().alpha, ADAPTIVE_ALPHA);
  assert.deepEqual(runtime.status().adaptive, WEIGHTS);
});

test("project config and the MCP server carry the adaptive weight; tool arguments cannot", async (t) => {
  const settings = normalizeEmbeddingConfig(
    {
      embedder: { type: "openai", baseUrl: "http://127.0.0.1:9", model: "m" },
      fusion: { alpha: "adaptive", adaptive: { low: 0.1, high: 0.8 } },
    },
    [],
  );
  assert.deepEqual(settings.fusion, {
    alpha: "adaptive",
    normalization: "tmm",
    adaptive: { low: 0.1, mid: 0.5, high: 0.8 },
  });
  const errors = [];
  normalizeEmbeddingConfig(
    {
      embedder: { type: "openai", baseUrl: "http://127.0.0.1:9", model: "m" },
      fusion: { alpha: "adaptive", adaptive: { mid: 0.9, high: 0.5 } },
    },
    errors,
  );
  assert.deepEqual(
    errors.map((entry) => [entry.code, entry.field]),
    [["invalid_fusion", "fusion"]],
  );

  const server = await startFakeEmbeddingsServer({ dimension: 16 });
  t.after(() => server.close());
  const root = tempDir(t, "okf-adaptive-mcp-");
  ["Alpine boots", "Alpine tents", "Alpine maps", "Desert boots"].forEach((title, position) => {
    fs.writeFileSync(
      path.join(root, `note-${position}.md`),
      `---\ntype: Reference\ntitle: ${title}\n---\n\n# ${title}\n\nNotes about ${title.toLowerCase()}.\n`,
    );
  });
  const state = await createStateAsync([], {
    rootPath: root,
    embedding: {
      embedder: { type: "openai", baseUrl: server.baseUrl, model: "fake", dimensions: 16 },
      cacheDir: path.join(tempDir(t, "okf-adaptive-mcp-cache-"), "vectors"),
      fusion: { alpha: "adaptive", adaptive: { low: 0.1, mid: 0.3, high: 0.9 } },
    },
  });
  await state.embeddings.idle();
  const call = async (args) =>
    JSON.parse((await callTool(state, "search_concepts", args)).content[0].text);
  const all = await call({ query: "alpine notes" });
  assert.equal(all.hybrid, true);
  assert.deepEqual([all.alphaUsed, all.alphaReason], [0.3, "all_terms"]);
  const weak = await call({ query: "glacier crampons boots rope" });
  assert.deepEqual([weak.alphaUsed, weak.alphaReason], [0.9, "weak_lexical"]);
  const status = JSON.parse((await callTool(state, "embedding_status", {})).content[0].text);
  assert.equal(status.alpha, "adaptive");
  assert.deepEqual(status.adaptive, { low: 0.1, mid: 0.3, high: 0.9 });
  // The weight is trusted configuration: a tool argument never changes it.
  const smuggled = await callTool(state, "search_concepts", {
    query: "alpine notes",
    alpha: 1,
    adaptiveAlpha: { low: 1, mid: 1, high: 1 },
  });
  const parsed = smuggled.isError ? null : JSON.parse(smuggled.content[0].text);
  assert.ok(smuggled.isError || parsed.alphaUsed === 0.3, "alpha arguments are refused or ignored");
});
