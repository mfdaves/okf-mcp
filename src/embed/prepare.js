"use strict";

// Incremental preparation of a bundle's vectors: compute the retrieval units,
// embed only the hashes the cache does not hold, store them as each chunk
// arrives so an interrupted run keeps its progress, and drop rows whose text
// no longer exists. The receipt says what left the machine (O-2) and what it
// cost, never what the text was. A unit the provider rejects even after the
// embedder's own recovery (skipRejected, src/embed/interface.js) is listed
// under `skipped` and the run continues: one bad document never costs the
// rest of the catalog its vectors. It is retried by the next preparation.

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

  // Each embed() call carries at most maxBatch units (the interface's limit
  // per call); up to `concurrency` calls run at once, and every batch is
  // persisted as it completes so an interrupted run keeps its progress.
  const parallel =
    Number.isSafeInteger(embedder.concurrency) && embedder.concurrency > 0
      ? embedder.concurrency
      : 1;
  const queue = Array.from(pending.values());
  const batches = [];
  for (let offset = 0; offset < queue.length; offset += embedder.maxBatch) {
    batches.push(queue.slice(offset, offset + embedder.maxBatch));
  }
  const usageBefore = usageSnapshot(embedder);
  let embedded = 0;
  let calls = 0;
  const skipped = [];
  let next = 0;
  let failure = null;
  const worker = async () => {
    while (next < batches.length && failure === null) {
      const batch = batches[next];
      next += 1;
      try {
        calls += 1;
        // One request bound for the whole run: this pool is the parallelism,
        // so each call runs its own requests one at a time.
        const vectors = await embedder.embed(
          batch.map((unit) => unit.text),
          { concurrency: 1, skipRejected: true },
        );
        if (!Array.isArray(vectors) || vectors.length !== batch.length) {
          throw new EmbedderError(
            "The embedder returned a different number of vectors than inputs.",
            "embedder_bad_output",
          );
        }
        const rows = [];
        batch.forEach((unit, position) => {
          if (vectors[position] === null) {
            skipped.push({ id: unit.id, reason: "input_rejected" });
          } else {
            rows.push({ id: unit.id, hash: unit.hash, vector: vectors[position] });
          }
        });
        if (rows.length) await cache.putMany(rows);
        embedded += rows.length;
        if (typeof config.onProgress === "function") {
          config.onProgress({ embedded, total: queue.length, units: units.length });
        }
      } catch (error) {
        if (failure === null) failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, batches.length) }, worker));
  if (failure !== null) throw failure;
  const pruned = await cache.prune(keep);
  const usage = usageDelta(usageBefore, usageSnapshot(embedder));

  return {
    units: units.length,
    embedded,
    reused,
    deduplicated: units.length - reused - embedded - skipped.length,
    skipped: skipped.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
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
