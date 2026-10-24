"use strict";

// Incremental preparation of a bundle's vectors: compute the retrieval units,
// embed only the hashes the cache does not hold, store them as each chunk
// arrives so an interrupted run keeps its progress, and drop rows whose text
// no longer exists. The receipt says what left the machine (O-2) and what it
// cost, never what the text was.

const { performance } = require("node:perf_hooks");

const { EmbedderError, describeEmbedder, validateEmbedder } = require("./interface");
const { UNIT_HASH_PATTERN, conceptUnits } = require("./units");

const USAGE_FIELDS = ["requests", "retries", "promptTokens", "totalTokens"];

function normalizeUnits(units) {
  if (!Array.isArray(units)) {
    throw new EmbedderError("The units function must return an array.", "invalid_units");
  }
  return units.map((unit, position) => {
    if (
      !unit ||
      typeof unit.id !== "string" ||
      !unit.id ||
      typeof unit.text !== "string" ||
      typeof unit.hash !== "string" ||
      !UNIT_HASH_PATTERN.test(unit.hash)
    ) {
      throw new EmbedderError(
        `Unit ${position} must carry an id, a text and a sha256 hash.`,
        "invalid_units",
        { position },
      );
    }
    return { id: unit.id, text: unit.text, hash: unit.hash };
  });
}

function usageSnapshot(embedder) {
  if (typeof embedder.usage !== "function") return null;
  const usage = embedder.usage();
  if (!usage || typeof usage !== "object") return null;
  return Object.fromEntries(
    USAGE_FIELDS.map((field) => [field, Number.isFinite(usage[field]) ? usage[field] : 0]),
  );
}

function usageDelta(before, after) {
  if (!before || !after) return null;
  return Object.fromEntries(
    USAGE_FIELDS.map((field) => [field, Math.max(0, after[field] - before[field])]),
  );
}

function assertCacheMatches(cache, embedder) {
  if (
    !cache ||
    typeof cache.has !== "function" ||
    typeof cache.putMany !== "function" ||
    typeof cache.prune !== "function"
  ) {
    throw new EmbedderError("prepareEmbeddings requires an open vector cache.", "invalid_cache");
  }
  if (cache.embedderId !== embedder.id || cache.dimension !== embedder.dimension) {
    throw new EmbedderError(
      "The vector cache was opened for a different embedder or dimension.",
      "cache_mismatch",
      {
        cache: { embedderId: cache.embedderId, dimension: cache.dimension },
        embedder: { id: embedder.id, dimension: embedder.dimension },
      },
    );
  }
}

// options.units replaces the unit function (sections instead of concepts);
// options.onProgress receives { embedded, total, units } after each chunk.
async function prepareEmbeddings(index, embedder, cache, options) {
  const config = options || {};
  validateEmbedder(embedder);
  assertCacheMatches(cache, embedder);
  const unitsOf = typeof config.units === "function" ? config.units : conceptUnits;
  const started = performance.now();
  const units = normalizeUnits(unitsOf(index));

  const keep = new Set();
  const pending = new Map();
  let reused = 0;
  for (const unit of units) {
    keep.add(unit.hash);
    if (cache.has(unit.hash)) {
      reused += 1;
    } else if (!pending.has(unit.hash)) {
      pending.set(unit.hash, unit);
    }
  }

  // Chunks are sized so one embed() call can use the implementation's full
  // concurrency, and each chunk is persisted before the next is requested.
  const parallel =
    Number.isSafeInteger(embedder.concurrency) && embedder.concurrency > 0
      ? embedder.concurrency
      : 1;
  const chunkSize = embedder.maxBatch * parallel;
  const queue = Array.from(pending.values());
  const usageBefore = usageSnapshot(embedder);
  let embedded = 0;
  let calls = 0;
  for (let offset = 0; offset < queue.length; offset += chunkSize) {
    const chunk = queue.slice(offset, offset + chunkSize);
    const vectors = await embedder.embed(chunk.map((unit) => unit.text));
    calls += 1;
    if (!Array.isArray(vectors) || vectors.length !== chunk.length) {
      throw new EmbedderError(
        "The embedder returned a different number of vectors than inputs.",
        "embedder_bad_output",
      );
    }
    cache.putMany(
      chunk.map((unit, position) => ({ id: unit.id, hash: unit.hash, vector: vectors[position] })),
    );
    embedded += chunk.length;
    if (typeof config.onProgress === "function") {
      config.onProgress({ embedded, total: queue.length, units: units.length });
    }
  }
  const pruned = cache.prune(keep);
  const usage = usageDelta(usageBefore, usageSnapshot(embedder));

  return {
    units: units.length,
    embedded,
    reused,
    deduplicated: units.length - reused - embedded,
    pruned,
    requests: usage ? usage.requests : calls,
    usage,
    embedder: describeEmbedder(embedder),
    cache: {
      dir: cache.dir,
      rows: cache.size,
      rebuilt: cache.opened ? cache.opened.rebuilt === true : false,
      reason: cache.opened ? cache.opened.reason : null,
    },
    durationMs: Math.round((performance.now() - started) * 1000) / 1000,
  };
}

module.exports = {
  prepareEmbeddings,
};
