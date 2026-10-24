"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { openVectorCache } = require("../src/cache/store");
const { prepareEmbeddings } = require("../src/embed/prepare");
const { buildProjectIndex } = require("../src/indexer");
const { unitMemo } = require("../src/search/dense");
const { openEmbeddingRuntime } = require("../src/search/hybrid");
const { searchConcepts } = require("../src/search/query");
const { vectorFor } = require("./fake-embeddings-server");
const {
  hybridWorld,
  tempDir,
  topicEmbedder,
  topicVector,
  writeConcept,
} = require("./helpers/hybrid-world");

// Review fixes for WP3c: dense-stage failures, queue ordering between
// preparation and write batches, stable pagination, lexical evidence for dense
// candidates, the literal guard, and the probe order.

const uris = (response) => response.results.map((entry) => entry.uri);

async function runtimeWorld(t, embedder, context) {
  const world = hybridWorld(t);
  const cacheDir = path.join(tempDir(t, "okf-hybrid-review-"), "cache");
  const runtime = await openEmbeddingRuntime(
    { embedder, cacheDir },
    Object.assign({ root: world.root }, context || {}),
  );
  return { ...world, runtime };
}

test("a query vector of the wrong dimension degrades to lexical and is never cached", async (t) => {
  const topic = topicEmbedder();
  let broken = false;
  const embedder = Object.assign({}, topic.embedder, {
    async embed(texts) {
      const vectors = await topic.embedder.embed(texts);
      return broken ? vectors.map(() => new Float32Array(3)) : vectors;
    },
  });
  let clock = 1000;
  const { index, runtime } = await runtimeWorld(t, embedder, { now: () => clock });
  await runtime.sync(index);
  broken = true;
  const lexical = searchConcepts(index, { query: "delivery times" });
  const degraded = await runtime.search(index, { query: "delivery times" });
  assert.equal(degraded.hybrid, false);
  assert.equal(degraded.embedder.degraded, true);
  assert.equal(degraded.embedder.code, "embedder_invalid_vector");
  assert.deepEqual(uris(degraded), uris(lexical));
  assert.equal(runtime.queryVectors.has("delivery times"), false, "rejected vector not cached");
  broken = false;
  clock += 60000;
  const healed = await runtime.search(index, { query: "delivery times" });
  assert.equal(healed.hybrid, true);
});

test("any failure inside the dense stage returns lexical results with an enum code", async (t) => {
  const { embedder } = topicEmbedder();
  const { index, runtime } = await runtimeWorld(t, embedder);
  await runtime.sync(index);
  const warm = await runtime.search(index, { query: "winter boots" });
  assert.equal(warm.hybrid, true);
  // The cached query vector no longer matches the cache: dense scoring throws.
  const dimension = runtime.cache.dimension;
  runtime.cache.dimension = dimension + 1;
  t.after(() => {
    runtime.cache.dimension = dimension;
  });
  const response = await runtime.search(index, { query: "winter boots" });
  assert.equal(response.hybrid, false);
  assert.equal(response.embedder.degraded, true);
  assert.equal(response.embedder.code, "embedder_dimension_mismatch");
  assert.deepEqual(uris(response), uris(searchConcepts(index, { query: "winter boots" })));
  // The caller's own bad options still throw.
  await assert.rejects(() => runtime.search(index, { query: "x", mode: "most" }), TypeError);
});

test("a slow preparation over the old index never prunes rows a write batch added", async (t) => {
  const topic = topicEmbedder();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let first = true;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const embedder = Object.assign({}, topic.embedder, {
    async embed(texts) {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return topic.embedder.embed(texts);
    },
  });
  const { index, runtime, root, reindex } = await runtimeWorld(t, embedder);
  const startup = runtime.sync(index);
  // The preparation is inside its first request when the batch arrives.
  await started;
  writeConcept(root, "returns.md", { type: "Policy", title: "Returns desk" }, "Reso in store.");
  const next = reindex();
  const applied = runtime.embedChanged(index, next);
  release();
  const [startupReceipt, batch] = await Promise.all([startup, applied]);
  assert.equal(startupReceipt.embedded, 6);
  assert.equal(batch.embedded, 1);
  await runtime.idle();
  const added = unitMemo(next, runtime.units).units.find(
    (unit) => unit.id === "okf://shop/returns",
  );
  assert.ok(runtime.cache.has(added.hash), "the batch's row survives the startup prune");
  assert.equal(runtime.cache.size, 7);
  const found = await runtime.search(next, { query: "rimborso" });
  assert.equal(found.hybrid, true);
  assert.ok(uris(found).includes("okf://shop/returns"));
});

test("pages of one hybrid query concatenate to the single large page", async (t) => {
  const project = path.join(__dirname, "fixtures", "retrieval", "alpinaria", "okf.project.yaml");
  const index = buildProjectIndex(project);
  const memory = {
    id: "memory:hash:16",
    dimension: 16,
    languages: [],
    remote: false,
    maxBatch: 512,
    maxInputChars: 32000,
    async embed(texts) {
      return texts.map((text) => vectorFor(text, 16));
    },
  };
  const cache = openVectorCache(path.join(tempDir(t, "okf-hybrid-pages-"), "cache"), {
    embedderId: memory.id,
    dimension: 16,
  });
  await prepareEmbeddings(index, memory, cache);
  const { queries } = JSON.parse(
    fs.readFileSync(path.join(path.dirname(project), "queries.json"), "utf8"),
  );
  for (const { query } of queries.slice(0, 12)) {
    const options = (limit, offset) => ({
      query,
      limit,
      offset,
      hybrid: true,
      queryVector: vectorFor(query, 16),
      vectorCache: cache,
    });
    const whole = searchConcepts(index, options(250, 0));
    const pages = [];
    for (let offset = 0; offset < whole.total; offset += 10) {
      const page = searchConcepts(index, options(10, offset));
      assert.equal(page.total, whole.total, query);
      pages.push(...uris(page));
    }
    assert.deepEqual(pages, uris(whole), query);
  }
});

test("dense candidates carry their lexical evidence; floors and lowConfidence read it", async (t) => {
  const world = hybridWorld(t);
  writeConcept(
    world.root,
    "winter-delivery.md",
    { type: "Policy", title: "Winter delivery" },
    "Courier delivery in the snow season.",
  );
  const index = world.reindex();
  const { embedder } = topicEmbedder();
  const cache = openVectorCache(path.join(tempDir(t, "okf-hybrid-evidence-"), "cache"), {
    embedderId: embedder.id,
    dimension: embedder.dimension,
  });
  await prepareEmbeddings(index, embedder, cache);
  const query = "winter courier delivery";
  const base = { query, hybrid: true, queryVector: topicVector(query), vectorCache: cache };
  const lexical = searchConcepts(index, { query });
  assert.equal(lexical.mode, "all");
  assert.deepEqual(uris(lexical), ["okf://shop/winter-delivery"]);
  const hybrid = searchConcepts(index, Object.assign({ detail: "full" }, base));
  const partial = hybrid.results.find((entry) => entry.uri === "okf://shop/delivery");
  assert.ok(partial, "the partial match joins through dense retrieval");
  assert.ok(Math.abs(partial.coverage - 2 / 3) < 1e-9, "actual coverage, not 0");
  assert.deepEqual(partial.matchedTerms.slice().sort(), ["courier", "delivery"]);
  assert.equal(typeof partial.lexicalScore, "number");
  const kept = searchConcepts(index, Object.assign({ minCoverage: 0.5 }, base));
  assert.ok(uris(kept).includes("okf://shop/delivery"), "a 0.5 floor keeps a 2/3 match");
  const strict = searchConcepts(index, Object.assign({ minCoverage: 0.9 }, base));
  assert.deepEqual(uris(strict), ["okf://shop/winter-delivery"]);
  // Under the any-term fallback lowConfidence reads the displayed top result.
  const fallback = "spedizione refund";
  const shown = searchConcepts(index, {
    query: fallback,
    hybrid: true,
    queryVector: topicVector(fallback),
    vectorCache: cache,
    alpha: 1,
  });
  assert.equal(shown.mode, "any");
  assert.equal(shown.lowConfidence, shown.results[0].coverage < 0.5);
});

test("with literal terms, all-term hits keep precedence over semantic neighbours", async (t) => {
  const world = hybridWorld(t);
  writeConcept(
    world.root,
    "footwear-refunds.md",
    { type: "Policy", title: "Footwear refund rule" },
    "Ticket REF-42 covers a refund or return for footwear bought online.",
  );
  const index = world.reindex();
  const { embedder } = topicEmbedder();
  const cache = openVectorCache(path.join(tempDir(t, "okf-hybrid-guard-"), "cache"), {
    embedderId: embedder.id,
    dimension: embedder.dimension,
  });
  await prepareEmbeddings(index, embedder, cache);
  const run = (query) =>
    searchConcepts(index, {
      query,
      hybrid: true,
      queryVector: topicVector("footwear boots shoe"),
      vectorCache: cache,
      alpha: 0.9,
    });
  // Without a literal term the dense side may lead at alpha 0.9.
  const plain = run("refund footwear");
  assert.equal(plain.mode, "all");
  assert.notEqual(plain.results[0].uri, "okf://shop/footwear-refunds");
  // With the identifier REF-42 the all-term hit comes first.
  const literal = run("REF-42 footwear");
  assert.equal(literal.mode, "all");
  assert.equal(literal.results[0].uri, "okf://shop/footwear-refunds");
  // alpha 1 still reproduces the dense ranking exactly.
  const dense = searchConcepts(index, {
    query: "REF-42 footwear",
    hybrid: true,
    queryVector: topicVector("footwear boots shoe"),
    vectorCache: cache,
    alpha: 1,
  });
  assert.notEqual(dense.results[0].uri, "okf://shop/footwear-refunds");
});

test("the runtime probes before the first embed, as the interface requires", async (t) => {
  const calls = [];
  const topic = topicEmbedder();
  let dimension = null;
  const embedder = Object.assign({}, topic.embedder, {
    async probe() {
      calls.push("probe");
      dimension = 7;
      return { id: topic.embedder.id, dimension };
    },
    async embed(texts) {
      if (dimension === null) throw new Error("embed before probe");
      calls.push("embed");
      return topic.embedder.embed(texts);
    },
  });
  delete embedder.dimension;
  Object.defineProperty(embedder, "dimension", { get: () => dimension, enumerable: true });
  const { index, runtime } = await runtimeWorld(t, embedder);
  assert.equal(runtime.ready, true);
  assert.equal(calls[0], "probe");
  await runtime.sync(index);
  assert.deepEqual(calls.slice(0, 2), ["probe", "embed"]);
});
