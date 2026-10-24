"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { openVectorCache } = require("../src/cache/store");
const { EmbedderError } = require("../src/embed/interface");
const { prepareEmbeddings } = require("../src/embed/prepare");
const { denseSearch } = require("../src/search/dense");
const { openEmbeddingRuntime } = require("../src/search/hybrid");
const { searchConcepts } = require("../src/search/query");
const {
  hybridWorld,
  tempDir,
  topicEmbedder,
  topicVector,
  writeConcept,
} = require("./helpers/hybrid-world");

async function preparedWorld(t) {
  const world = hybridWorld(t);
  const { embedder, state } = topicEmbedder();
  const cache = openVectorCache(path.join(tempDir(t, "okf-hybrid-cache-"), "cache"), {
    embedderId: embedder.id,
    dimension: embedder.dimension,
    root: world.root,
  });
  await prepareEmbeddings(world.index, embedder, cache);
  return { ...world, embedder, state, cache };
}

function hybridOptions(cache, query, extra) {
  return Object.assign(
    { query, hybrid: true, queryVector: topicVector(query), vectorCache: cache, detail: "full" },
    extra || {},
  );
}

const uris = (response) => response.results.map((entry) => entry.uri);

test("hybrid search finds a concept that shares no word with the query", async (t) => {
  const { index, cache } = await preparedWorld(t);
  const lexical = searchConcepts(index, { query: "spedizione" });
  assert.equal(lexical.total, 0, "no lexical match for the Italian synonym");
  const hybrid = searchConcepts(index, hybridOptions(cache, "spedizione"));
  assert.equal(hybrid.hybrid, true);
  assert.equal(hybrid.alpha, 0.5);
  assert.equal(hybrid.normalization, "lexical-tmm");
  assert.equal(hybrid.results[0].uri, "okf://shop/delivery");
  const top = hybrid.results[0];
  assert.equal(top.lexicalScore, null);
  assert.ok(top.denseScore > 0.9);
  assert.equal(top.fusedScore, top.score);
  assert.equal(top.relevance, 1);
  assert.equal(top.coverage, 0);
  assert.deepEqual(top.matchedTerms, []);
  // mode keeps its lexical meaning; lowConfidence reads the displayed top result,
  // which matched none of the terms.
  assert.equal(hybrid.mode, lexical.mode);
  assert.equal(hybrid.mode, "any");
  assert.equal(hybrid.lowConfidence, true);
  assert.equal(hybrid.allTermsTotal, lexical.allTermsTotal);
});

test("alpha 0 reproduces the lexical response and alpha 1 the dense ranking", async (t) => {
  const { index, cache } = await preparedWorld(t);
  for (const query of ["winter boots", "delivery cost", "refund policy footwear"]) {
    const lexical = searchConcepts(index, { query, detail: "full" });
    const zero = searchConcepts(index, hybridOptions(cache, query, { alpha: 0 }));
    assert.deepEqual(uris(zero), uris(lexical), query);
    assert.equal(zero.total, lexical.total);
    assert.deepEqual(
      zero.results.map((entry) => entry.coverage),
      lexical.results.map((entry) => entry.coverage),
    );
    const one = searchConcepts(index, hybridOptions(cache, query, { alpha: 1 }));
    const dense = denseSearch(index, { queryVector: topicVector(query), cache });
    assert.deepEqual(
      uris(one),
      dense.map((entry) => entry.id),
      query,
    );
  }
});

test("hybrid ranking is deterministic and respects filters, mode all and floors", async (t) => {
  const { index, cache } = await preparedWorld(t);
  const first = searchConcepts(index, hybridOptions(cache, "winter footwear"));
  const second = searchConcepts(index, hybridOptions(cache, "winter footwear"));
  assert.deepEqual(first, second);

  const policies = searchConcepts(
    index,
    hybridOptions(cache, "winter footwear", { types: ["Policy"] }),
  );
  assert.ok(policies.results.every((entry) => entry.type === "Policy"));

  // Explicit mode all: every term required, dense scores only re-rank.
  const all = searchConcepts(index, hybridOptions(cache, "ski boots", { mode: "all" }));
  const lexicalAll = searchConcepts(index, { query: "ski boots", mode: "all" });
  assert.deepEqual(uris(all).sort(), uris(lexicalAll).sort());

  // Floors read the lexical values: dense-only neighbours drop out.
  const floored = searchConcepts(
    index,
    hybridOptions(cache, "winter footwear", { minCoverage: 0.5 }),
  );
  assert.ok(floored.results.length > 0);
  assert.ok(floored.results.every((entry) => entry.coverage >= 0.5));

  const compact = searchConcepts(
    index,
    hybridOptions(cache, "winter footwear", { detail: "compact" }),
  );
  assert.deepEqual(Object.keys(compact.results[0]).sort(), [
    "coverage",
    "denseScore",
    "description",
    "fusedScore",
    "lexicalScore",
    "relevance",
    "title",
    "type",
    "uri",
  ]);
});

test("without a query vector the response is the lexical one, unchanged", async (t) => {
  const { index, cache } = await preparedWorld(t);
  const lexical = searchConcepts(index, { query: "winter boots" });
  const requested = searchConcepts(index, {
    query: "winter boots",
    hybrid: true,
    vectorCache: cache,
  });
  assert.deepEqual(requested, lexical);
  assert.equal("hybrid" in lexical, false);
});

async function runtimeWorld(t, options) {
  const world = hybridWorld(t);
  const topic = topicEmbedder();
  const cacheDir = path.join(tempDir(t, "okf-hybrid-runtime-"), "cache");
  const runtime = await openEmbeddingRuntime(
    Object.assign({ embedder: topic.embedder, cacheDir, embedUnits: "concepts" }, options || {}),
    { root: world.root },
  );
  return { ...world, ...topic, runtime, cacheDir };
}

test("the runtime degrades to lexical while the cache is empty, then fuses", async (t) => {
  const { index, runtime, state } = await runtimeWorld(t);
  const cold = await runtime.search(index, { query: "spedizione" });
  assert.equal(cold.hybrid, false);
  assert.deepEqual(cold.embedder, {
    id: "memory:topics:7",
    remote: false,
    dimension: 7,
    degraded: true,
    code: "cache_empty",
  });
  assert.equal(cold.total, 0);
  await runtime.idle();
  assert.equal(runtime.status().startup.embedded, 6);
  assert.equal(runtime.status().cache.dir, undefined, "no local path without --write");

  const warm = await runtime.search(index, { query: "spedizione", detail: "full" });
  assert.equal(warm.hybrid, true);
  assert.equal(warm.embedder.degraded, false);
  assert.equal(warm.results[0].uri, "okf://shop/delivery");
  assert.deepEqual(warm.cache, { rows: 6 });
  assert.equal(warm.usage.requests, 1);
  assert.ok(warm.timings.queryEncodingMs >= 0 && warm.timings.searchMs >= 0);

  // The query vector LRU: the same query costs no further request.
  const calls = state.calls;
  const again = await runtime.search(index, { query: "spedizione" });
  assert.equal(state.calls, calls);
  assert.equal(again.usage.requests, 0);
  // hybrid: false skips the embedder entirely.
  const off = await runtime.search(index, { query: "courier", hybrid: false });
  assert.equal(off.hybrid, false);
  assert.equal(off.embedder.degraded, false);
  assert.equal(state.calls, calls);
  // Callers cannot hand the runtime their own vectors or cache.
  const forged = await runtime.search(index, {
    query: "courier",
    hybrid: false,
    queryVector: topicVector("bike"),
    vectorCache: {},
  });
  assert.equal(forged.hybrid, false);
});

test("an embedder failure falls back to lexical with a fixed code and cools down", async (t) => {
  const { index, runtime, state } = await runtimeWorld(t);
  await runtime.search(index, { query: "warm up" });
  await runtime.idle();
  const failure = new EmbedderError(
    "Embeddings request failed with HTTP 429.",
    "embedder_http_error",
    {
      status: 429,
      serverCode: "rate_limited",
      server: { message: "secret server text" },
    },
  );
  state.fail = failure;
  const lexical = searchConcepts(index, { query: "delivery times" });
  const degraded = await runtime.search(index, { query: "delivery times" });
  assert.equal(degraded.hybrid, false);
  assert.deepEqual(degraded.embedder, {
    id: "memory:topics:7",
    remote: false,
    dimension: 7,
    degraded: true,
    code: "embedder_http_error",
    serverCode: "rate_limited",
  });
  assert.ok(!JSON.stringify(degraded).includes("secret server text"));
  assert.deepEqual(uris(degraded), uris(lexical));
  const calls = state.calls;
  const cooling = await runtime.search(index, { query: "price list" });
  assert.equal(state.calls, calls, "no request during the cooldown");
  assert.equal(cooling.embedder.cooldown, true);
  assert.equal(cooling.embedder.serverCode, "rate_limited");
});

test("a runtime that cannot open stays lexical and never throws", async (t) => {
  const world = hybridWorld(t);
  const { embedder } = topicEmbedder();
  // A cache directory inside the bundle root would dirty the worktree.
  const runtime = await openEmbeddingRuntime(
    { embedder, cacheDir: path.join(world.root, ".cache") },
    { root: world.root },
  );
  const response = await runtime.search(world.index, { query: "delivery" });
  assert.equal(response.hybrid, false);
  assert.equal(response.embedder.degraded, true);
  assert.equal(response.embedder.code, "cache_inside_root");
  assert.equal(runtime.status().available, false);
  assert.equal(fs.existsSync(path.join(world.root, ".cache")), false);
  const missingKey = await openEmbeddingRuntime(
    {
      embedder: { baseUrl: "https://api.example.com", model: "m", apiKeyEnv: "OKF_NO_SUCH_KEY" },
    },
    { root: world.root, env: {} },
  );
  assert.equal(missingKey.status().embedder.code, "embedder_key_missing");
});

test("a write batch embeds only its changed units in one request", async (t) => {
  const { index, runtime, state, root, reindex } = await runtimeWorld(t);
  await runtime.search(index, { query: "warm up" });
  await runtime.idle();
  const before = state.calls;
  writeConcept(root, "returns.md", { type: "Policy", title: "Returns desk" }, "Reso in store.");
  writeConcept(root, "pricing.md", { type: "Policy", title: "Price list" }, "New tariff table.");
  const next = reindex();
  const receipt = await runtime.embedChanged(index, next);
  assert.equal(state.calls - before, 1, "one request for the batch");
  assert.equal(receipt.units, 2);
  assert.equal(receipt.embedded, 2);
  assert.equal(receipt.embedder.degraded, false);
  assert.equal(receipt.cache.rows, 8);
  const found = await runtime.search(next, { query: "rimborso", detail: "full" });
  assert.equal(found.hybrid, true);
  assert.ok(uris(found).slice(0, 2).includes("okf://shop/returns"));
  // The background sync for the new index embeds nothing and prunes the
  // superseded pricing row.
  await runtime.idle();
  assert.equal(state.calls - before, 2, "only the query was encoded");
  assert.equal(runtime.status().sync.last.pruned, 1);
  assert.equal(runtime.status().cache.rows, 7);
});

test("remote bundles stay lexical-only: their text is never embedded (R-9)", async (t) => {
  const { runtime, state, reindex } = await runtimeWorld(t);
  const index = reindex();
  index.bundles.forEach((bundle) => {
    bundle.remote = true;
  });
  const receipt = await runtime.sync(index);
  assert.equal(receipt.units, 0);
  assert.equal(state.inputs, 0, "no text left for the embedder");
  const response = await runtime.search(index, { query: "delivery" });
  assert.equal(response.hybrid, false);
  assert.equal(response.embedder.code, "cache_empty");
  assert.ok(response.results.length > 0, "lexical results remain");
});
