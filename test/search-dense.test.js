"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { openVectorCache } = require("../src/cache/store");
const { prepareEmbeddings } = require("../src/embed/prepare");
const { hashUnitText } = require("../src/embed/units");
const { denseCoverage, denseSearch, unitMemo } = require("../src/search/dense");
const { hybridWorld, tempDir, topicEmbedder, topicVector } = require("./helpers/hybrid-world");

async function preparedWorld(t, options) {
  const world = hybridWorld(t);
  const { embedder, state } = topicEmbedder();
  const cacheDir = path.join(tempDir(t, "okf-dense-cache-"), "cache");
  const cache = openVectorCache(cacheDir, {
    embedderId: embedder.id,
    dimension: embedder.dimension,
    root: world.root,
  });
  await prepareEmbeddings(world.index, embedder, cache, options);
  return { ...world, embedder, state, cache, cacheDir };
}

function cosine(left, right) {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    a += left[index] * left[index];
    b += right[index] * right[index];
  }
  return dot / Math.sqrt(a * b);
}

test("denseSearch ranks concepts by cosine over the cached unit vectors", async (t) => {
  const { index, cache } = await preparedWorld(t);
  const queryVector = topicVector("winter footwear");
  const results = denseSearch(index, { queryVector, cache });
  assert.equal(results.length, index.concepts.length);
  assert.equal(results[0].id, "okf://shop/ski-boots");
  for (let position = 1; position < results.length; position += 1) {
    assert.ok(results[position - 1].score >= results[position].score, "sorted by score");
  }
  // Scores are the cosine of the query with the unit text's vector.
  const doc = index.byUri.get("okf://shop/ski-boots");
  const expected = cosine(
    queryVector,
    topicVector([doc.title, doc.description, doc.body].join("\n")),
  );
  assert.ok(Math.abs(results[0].score - expected) < 1e-6);
  assert.equal(results[0].unit, "okf://shop/ski-boots");
  assert.equal(denseSearch(index, { queryVector, cache, limit: 2 }).length, 2);
});

test("denseSearch scores only the filtered candidates", async (t) => {
  const { index, cache } = await preparedWorld(t);
  const queryVector = topicVector("winter footwear");
  const policies = denseSearch(index, { queryVector, cache, filters: { types: ["Policy"] } });
  assert.deepEqual(policies.map((entry) => entry.id).sort(), [
    "okf://shop/delivery",
    "okf://shop/pricing",
    "okf://shop/refunds",
  ]);
  const candidates = [index.byUri.get("okf://shop/bikes")];
  assert.deepEqual(
    denseSearch(index, { queryVector, cache, candidates }).map((entry) => entry.id),
    ["okf://shop/bikes"],
  );
});

test("denseSearch memoises the unit mapping per index and remaps after cache changes", async (t) => {
  const { index, cache, embedder } = await preparedWorld(t);
  const memo = unitMemo(index);
  assert.equal(unitMemo(index), memo, "same memo for the same index and units function");
  denseSearch(index, { queryVector: topicVector("ski"), cache });
  const mapping = memo.rows;
  denseSearch(index, { queryVector: topicVector("bike"), cache });
  assert.equal(memo.rows, mapping, "no remapping while the cache is unchanged");
  assert.deepEqual(denseCoverage(index, cache), { units: 6, present: 6 });

  // Dropping a row (prune) remaps; the concept without a vector is skipped.
  const bikes = memo.units.find((unit) => unit.id === "okf://shop/bikes");
  await cache.prune(new Set(memo.units.filter((unit) => unit !== bikes).map((unit) => unit.hash)));
  const after = denseSearch(index, { queryVector: topicVector("bike"), cache });
  assert.notEqual(memo.rows, mapping);
  assert.equal(after.length, 5);
  assert.ok(!after.some((entry) => entry.id === "okf://shop/bikes"));
  assert.deepEqual(denseCoverage(index, cache), { units: 6, present: 5 });

  // Re-adding it remaps again and finds it first.
  const [vector] = await embedder.embed([bikes.text]);
  await cache.putMany([{ id: bikes.id, hash: bikes.hash, vector }]);
  assert.equal(
    denseSearch(index, { queryVector: topicVector("bike"), cache })[0].id,
    "okf://shop/bikes",
  );
});

test("denseSearch accepts any units function and scores a concept by its best unit", async (t) => {
  // Two "sections" per concept: the title and the body, anchored like WP3a's units.
  const sections = (index) =>
    index.concepts.flatMap((doc) =>
      [
        ["title", doc.title],
        ["body", doc.body],
      ].map(([anchor, text]) => ({ id: `${doc.uri}#${anchor}`, text, hash: hashUnitText(text) })),
    );
  const { index, cache } = await preparedWorld(t, { units: sections });
  const results = denseSearch(index, {
    queryVector: topicVector("snow winter"),
    cache,
    units: sections,
  });
  assert.equal(results.length, index.concepts.length, "one result per concept, not per unit");
  assert.equal(results[0].id, "okf://shop/ski-boots");
  assert.equal(results[0].unit, "okf://shop/ski-boots#body");
});

test("denseSearch refuses a mismatched query vector and returns nothing on an empty cache", async (t) => {
  const { index, cache, cacheDir, embedder } = await preparedWorld(t);
  assert.throws(
    () => denseSearch(index, { queryVector: new Float32Array(3), cache }),
    (error) => error.code === "embedder_dimension_mismatch",
  );
  assert.throws(
    () => denseSearch(index, { queryVector: topicVector("ski") }),
    (error) => error.code === "invalid_cache",
  );
  const empty = openVectorCache(`${cacheDir}-empty`, {
    embedderId: embedder.id,
    dimension: embedder.dimension,
  });
  assert.deepEqual(denseSearch(index, { queryVector: topicVector("ski"), cache: empty }), []);
  assert.deepEqual(denseSearch(index, { queryVector: new Float32Array(7), cache }), []);
});

test("embedUnits resolves concepts by default and refuses unknown names", () => {
  const { conceptUnits } = require("../src/embed/units");
  const { resolveUnits } = require("../src/search/dense");
  assert.equal(resolveUnits(), conceptUnits);
  assert.equal(resolveUnits("concepts"), conceptUnits);
  const custom = () => [];
  assert.equal(resolveUnits(custom), custom);
  assert.throws(
    () => resolveUnits("paragraphs"),
    (error) => error.code === "invalid_embed_units",
  );
});

test("the bounded top-k selection equals the head of the full ranking, ties by URI", async (t) => {
  const { index, cache } = await preparedWorld(t);
  // The constant component alone: every concept without a topic word ties.
  for (const query of ["winter footwear", "nothing in common", "cost refund"]) {
    const queryVector = topicVector(query);
    const full = denseSearch(index, { queryVector, cache });
    for (let limit = 1; limit <= full.length; limit += 1) {
      assert.deepEqual(denseSearch(index, { queryVector, cache, limit }), full.slice(0, limit));
    }
    for (let position = 1; position < full.length; position += 1) {
      const [left, right] = [full[position - 1], full[position]];
      assert.ok(left.score > right.score || (left.score === right.score && left.id < right.id));
    }
  }
});
