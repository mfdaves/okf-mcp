"use strict";

// WP3c-2 step 3: abstention v2. The rule in isolation, the confidence block on lexical and
// hybrid search responses (topSimilarity is the best raw cosine over the filtered candidates),
// the runtime and project configuration of minSimilarity, and get_context's confidence block
// and opt-in abstainOnLowConfidence, in the library and over MCP.

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { openVectorCache } = require("../src/cache/store");
const { assembleContext } = require("../src/context/assemble");
const { prepareEmbeddings } = require("../src/embed/prepare");
const { callTool, createStateAsync } = require("../src/mcp/server");
const {
  CONFIDENCE_REASONS,
  DEFAULT_MIN_SIMILARITY,
  assessConfidence,
  minSimilarityOption,
} = require("../src/search/confidence");
const { denseSearch } = require("../src/search/dense");
const { normalizeEmbeddingConfig } = require("../src/search/embedding-config");
const { openEmbeddingRuntime } = require("../src/search/hybrid");
const { searchConcepts } = require("../src/search/query");
const { hybridWorld, tempDir, topicEmbedder, topicVector } = require("./helpers/hybrid-world");

test("the rule: weak lexical match under any, or low similarity, both below half coverage", () => {
  const rule = (signals, minSimilarity) => assessConfidence(signals, minSimilarity);
  assert.deepEqual(rule({ mode: "any", coverage: 0.25, topSimilarity: null }), {
    coverage: 0.25,
    topSimilarity: null,
    lowConfidence: true,
    reasons: ["weak_lexical_match"],
  });
  // Exactly half is not weak (R-4 pins the strict comparison).
  assert.equal(rule({ mode: "any", coverage: 0.5, topSimilarity: 0.1 }, 0.3).lowConfidence, false);
  // The similarity clause needs the low coverage too, under any mode.
  assert.deepEqual(rule({ mode: "auto", coverage: 0.4, topSimilarity: 0.2 }, 0.3).reasons, [
    "low_similarity",
  ]);
  assert.deepEqual(rule({ mode: "all", coverage: 0.4, topSimilarity: 0.35 }, 0.3).reasons, []);
  assert.deepEqual(rule({ mode: "auto", coverage: 0.9, topSimilarity: 0.01 }, 0.3).reasons, []);
  assert.deepEqual(rule({ mode: "any", coverage: 0, topSimilarity: 0.1 }, 0.3).reasons, [
    "weak_lexical_match",
    "low_similarity",
  ]);
  // Lexical-only responses (no similarity) keep the 0.10 rule whatever the threshold.
  assert.equal(
    rule({ mode: "auto", coverage: 0.2, topSimilarity: null }, 0.9).lowConfidence,
    false,
  );
  // Nothing returned: nothing to flag.
  assert.deepEqual(rule({ mode: "any", coverage: null, topSimilarity: 0.1 }, 0.9), {
    coverage: null,
    topSimilarity: 0.1,
    lowConfidence: false,
    reasons: [],
  });
  assert.equal(
    rule({ mode: "auto", coverage: 0.2, topSimilarity: -0.05 }).reasons[0],
    "low_similarity",
  );
  assert.deepEqual(CONFIDENCE_REASONS, ["weak_lexical_match", "low_similarity"]);
  assert.equal(minSimilarityOption(undefined), DEFAULT_MIN_SIMILARITY);
  assert.equal(minSimilarityOption("0.25"), 0.25);
  for (const bad of [1.5, -1.5, true, "x", Number.NaN]) {
    assert.throws(() => minSimilarityOption(bad), TypeError, String(bad));
  }
});

async function preparedWorld(t) {
  const world = hybridWorld(t);
  const { embedder } = topicEmbedder();
  const cache = openVectorCache(path.join(tempDir(t, "okf-confidence-cache-"), "cache"), {
    embedderId: embedder.id,
    dimension: embedder.dimension,
    root: world.root,
  });
  await prepareEmbeddings(world.index, embedder, cache);
  return { ...world, embedder, cache };
}

const hybridOptions = (cache, query, extra) =>
  Object.assign(
    { query, hybrid: true, queryVector: topicVector(query), vectorCache: cache },
    extra || {},
  );

test("search responses carry the confidence block; topSimilarity is the best raw cosine", async (t) => {
  const { index, cache } = await preparedWorld(t);
  const lexical = searchConcepts(index, { query: "refund policy" });
  assert.deepEqual(lexical.confidence, {
    coverage: 1,
    topSimilarity: null,
    lowConfidence: false,
    reasons: [],
  });
  const weak = searchConcepts(index, { query: "refund glacier crampons rope" });
  assert.equal(weak.mode, "any");
  assert.equal(weak.confidence.lowConfidence, true);
  assert.equal(weak.lowConfidence, weak.confidence.lowConfidence);
  assert.deepEqual(weak.confidence.reasons, ["weak_lexical_match"]);

  const synonym = searchConcepts(index, hybridOptions(cache, "spedizione"));
  const nearest = denseSearch(index, { queryVector: topicVector("spedizione"), cache, limit: 1 });
  assert.equal(synonym.confidence.topSimilarity, nearest[0].score);
  assert.equal(synonym.confidence.coverage, synonym.results[0].coverage);
  assert.deepEqual(synonym.confidence.reasons, ["weak_lexical_match"]);
  // A threshold above every similarity adds the second reason; filters bound the candidates.
  const strict = searchConcepts(index, hybridOptions(cache, "spedizione", { minSimilarity: 1 }));
  assert.deepEqual(strict.confidence.reasons, ["weak_lexical_match", "low_similarity"]);
  const filtered = searchConcepts(
    index,
    hybridOptions(cache, "spedizione", { types: ["Product"], minSimilarity: 0.5 }),
  );
  const productNearest = denseSearch(index, {
    queryVector: topicVector("spedizione"),
    cache,
    filters: { types: ["Product"] },
    limit: 1,
  });
  assert.equal(filtered.confidence.topSimilarity, productNearest[0].score);
  assert.ok(filtered.confidence.topSimilarity < 0.5);
  assert.ok(filtered.confidence.reasons.includes("low_similarity"));
  // A strong lexical match is never flagged, however low the similarity threshold is set.
  const strong = searchConcepts(index, hybridOptions(cache, "refund policy", { minSimilarity: 1 }));
  assert.equal(strong.confidence.coverage, 1);
  assert.equal(strong.lowConfidence, false);
  // The block is identical on every page.
  const page = searchConcepts(index, hybridOptions(cache, "spedizione", { offset: 3, limit: 2 }));
  assert.deepEqual(page.confidence, synonym.confidence);
  assert.throws(
    () => searchConcepts(index, hybridOptions(cache, "spedizione", { minSimilarity: 3 })),
    TypeError,
  );
});

test("the runtime and project config carry minSimilarity; tool arguments cannot", async (t) => {
  const world = hybridWorld(t);
  const { embedder } = topicEmbedder();
  const runtime = await openEmbeddingRuntime(
    {
      embedder,
      cacheDir: tempDir(t, "okf-confidence-runtime-"),
      confidence: { minSimilarity: 1 },
    },
    { root: world.root },
  );
  await runtime.sync(world.index);
  assert.equal(runtime.status().minSimilarity, 1);
  const response = await runtime.search(world.index, { query: "spedizione" });
  assert.equal(response.hybrid, true);
  assert.deepEqual(response.confidence.reasons, ["weak_lexical_match", "low_similarity"]);

  const errors = [];
  const settings = normalizeEmbeddingConfig(
    {
      embedder: { type: "openai", baseUrl: "http://127.0.0.1:9", model: "m" },
      confidence: { minSimilarity: 0.35 },
    },
    errors,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(settings.confidence, { minSimilarity: 0.35 });
  const bad = [];
  normalizeEmbeddingConfig(
    {
      embedder: { type: "openai", baseUrl: "http://127.0.0.1:9", model: "m" },
      confidence: { minSimilarity: 2, extra: true },
    },
    bad,
  );
  assert.deepEqual(
    bad.map((entry) => [entry.code, entry.field]),
    [["invalid_confidence", "confidence"]],
  );
  const state = await createStateAsync([], {
    rootPath: world.root,
    embedding: { embedder, cacheDir: tempDir(t, "okf-confidence-mcp-") },
  });
  await state.embeddings.idle();
  const call = await callTool(state, "search_concepts", {
    query: "spedizione",
    minSimilarity: 1,
  });
  const parsed = call.isError ? null : JSON.parse(call.content[0].text);
  assert.ok(call.isError || !parsed.confidence.reasons.includes("low_similarity"));
});

test("get_context carries the confidence block and abstains on request", async (t) => {
  const world = hybridWorld(t);
  const weakQuery = "refund glacier crampons rope";
  const plain = assembleContext(world.index, { query: weakQuery });
  assert.equal(plain.lowConfidence, true);
  assert.deepEqual(plain.confidence, searchConcepts(world.index, { query: weakQuery }).confidence);
  assert.ok(plain.sections.length > 0, "without the option weak sections are still packed");
  assert.equal("abstained" in plain, false);
  const abstained = assembleContext(world.index, {
    query: weakQuery,
    abstainOnLowConfidence: true,
  });
  assert.deepEqual(abstained.sections, []);
  assert.equal(abstained.abstained, true);
  assert.equal(abstained.totalSections, 0);
  assert.equal(abstained.confidence.lowConfidence, true);
  assert.ok(abstained.concepts.length > 0, "the candidate concepts are still listed");
  assert.ok(abstained.usedTokens <= abstained.budgetTokens);
  const confident = assembleContext(world.index, {
    query: "refund policy",
    abstainOnLowConfidence: true,
  });
  assert.equal(confident.abstained, false);
  assert.ok(confident.sections.length > 0);
  assert.throws(
    () => assembleContext(world.index, { query: weakQuery, abstainOnLowConfidence: "yes" }),
    TypeError,
  );
  // Library callers can pass hybrid options: the block then carries the similarity.
  const { cache } = await preparedWorld(t);
  const hybrid = assembleContext(
    world.index,
    Object.assign(hybridOptions(cache, "spedizione"), { abstainOnLowConfidence: true }),
  );
  assert.equal(typeof hybrid.confidence.topSimilarity, "number");

  const state = await createStateAsync([], { rootPath: world.root });
  const call = async (args) =>
    JSON.parse((await callTool(state, "get_context", args)).content[0].text);
  const over = await call({ query: weakQuery, abstainOnLowConfidence: true });
  assert.deepEqual([over.abstained, over.sections.length], [true, 0]);
  assert.equal(over.confidence.lowConfidence, true);
  const kept = await call({ query: weakQuery });
  assert.ok(kept.sections.length > 0);
  assert.equal(kept.confidence.reasons[0], "weak_lexical_match");
});
