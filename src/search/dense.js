"use strict";

// Dense scoring for hybrid retrieval (docs/plan-1.0.md R-9, R-10): brute-force
// cosine similarity between a query vector and the cached vectors of the
// retrieval units that belong to the candidate concepts. No ANN (R-12): at
// 20k vectors of 512 floats a full scan is a few milliseconds.
//
// Units are { id, text, hash } (src/embed/units.js). The cache keys rows by
// content hash only, so the unit -> row mapping is recomputed from the index
// (R-9) and memoised per index object and unit function; a cache mutation
// (new rows, pruning, a new generation) remaps on the next query. A unit id
// is a concept URI or `uri#anchor` for a section; a concept scores with its
// best unit, which is reported so section-level callers can cite it.

const { EmbedderError } = require("../embed/interface");
const { conceptUnits } = require("../embed/units");

// `embedUnits` names: concept units today; section units come from WP3a's
// src/context/sections.js (same { id, text, hash } shape) once it lands.
const EMBED_UNITS = Object.freeze(["concepts", "sections"]);
const DEFAULT_EMBED_UNITS = "concepts";

// index -> Map(units function -> memo)
const UNIT_MEMOS = new WeakMap();

function conceptUriOf(index, unitId) {
  if (index.byUri?.has(unitId)) return unitId;
  const anchor = unitId.indexOf("#");
  return anchor === -1 ? unitId : unitId.slice(0, anchor);
}

function validUnit(unit) {
  return (
    unit &&
    typeof unit.id === "string" &&
    unit.id &&
    typeof unit.text === "string" &&
    typeof unit.hash === "string" &&
    /^[a-f0-9]{64}$/.test(unit.hash)
  );
}

// The units of an index with their concept grouping; computed once per index
// object and units function (hashing every unit text is the expensive part).
function unitMemo(index, unitsOf) {
  const fn = typeof unitsOf === "function" ? unitsOf : conceptUnits;
  let perIndex = UNIT_MEMOS.get(index);
  if (!perIndex) {
    perIndex = new Map();
    UNIT_MEMOS.set(index, perIndex);
  }
  let memo = perIndex.get(fn);
  if (!memo) {
    const raw = fn(index);
    if (!Array.isArray(raw) || !raw.every(validUnit)) {
      throw new EmbedderError(
        "The units function must return { id, text, hash } entries.",
        "invalid_units",
      );
    }
    const units = raw.map((unit) => ({ id: unit.id, text: unit.text, hash: unit.hash }));
    const byConcept = new Map();
    units.forEach((unit, position) => {
      const uri = conceptUriOf(index, unit.id);
      if (!byConcept.has(uri)) byConcept.set(uri, []);
      byConcept.get(uri).push(position);
    });
    memo = { units, byConcept, hashes: new Set(units.map((unit) => unit.hash)), rows: null };
    perIndex.set(fn, memo);
  }
  return memo;
}

// Row offsets and norms for the memo's units in the given cache, recomputed
// whenever the cache's backing store, size or generation changed.
function rowMapping(memo, cache) {
  const key = memo.rows;
  if (
    key &&
    key.cache === cache &&
    key.data === cache.data &&
    key.size === cache.size &&
    key.generation === cache.generation
  ) {
    return key;
  }
  const dimension = cache.dimension;
  const offsets = new Int32Array(memo.units.length).fill(-1);
  const norms = new Float32Array(memo.units.length);
  const data = cache.data;
  let present = 0;
  memo.units.forEach((unit, position) => {
    const view = cache.get(unit.hash);
    if (!view) return;
    // The view is a subarray of cache.data: its offset is the row's offset.
    const offset = view.byteOffset / Float32Array.BYTES_PER_ELEMENT - data.byteOffset / 4;
    offsets[position] = offset;
    let sum = 0;
    for (let index = 0; index < dimension; index += 1) sum += view[index] * view[index];
    norms[position] = Math.sqrt(sum);
    present += 1;
  });
  memo.rows = {
    cache,
    data,
    size: cache.size,
    generation: cache.generation,
    offsets,
    norms,
    present,
  };
  return memo.rows;
}

// How many of the index's units have a vector in the cache.
function denseCoverage(index, cache, units) {
  const memo = unitMemo(index, units);
  if (!cache?.size) return { units: memo.units.length, present: 0 };
  return { units: memo.units.length, present: rowMapping(memo, cache).present };
}

// Resolves an `embedUnits` name (or a units function) to a units function.
function resolveUnits(value) {
  if (typeof value === "function") return value;
  const name = value === undefined || value === null ? DEFAULT_EMBED_UNITS : value;
  if (!EMBED_UNITS.includes(name)) {
    throw new EmbedderError(
      `embedUnits must be one of ${EMBED_UNITS.join(", ")}.`,
      "invalid_embed_units",
    );
  }
  if (name === "concepts") return conceptUnits;
  let sections = null;
  try {
    sections = require("../context/sections").sectionUnits;
  } catch {
    sections = null;
  }
  if (typeof sections !== "function") {
    throw new EmbedderError(
      "Section units are not available in this build; use embedUnits: concepts.",
      "embed_units_unavailable",
    );
  }
  return sections;
}

function vectorNorm(vector) {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) sum += vector[index] * vector[index];
  return Math.sqrt(sum);
}

// options:
//   queryVector  Float32Array (or number[]) of the cache's dimension
//   cache        an open vector cache (src/cache/store.js)
//   units        units function (default conceptUnits); sections later
//   candidates   concept documents to score (default: applyFilters(index, filters))
//   filters      search filters (types, tagsAny, bundle, ...), used without candidates
//   limit        keep the best `limit` concepts (default: all)
// Returns [{ id, score, unit }] sorted by cosine descending, ties by URI.
function denseSearch(index, options) {
  const config = options || {};
  const cache = config.cache;
  const query = config.queryVector;
  if (!cache || typeof cache.get !== "function" || !Number.isSafeInteger(cache.dimension)) {
    throw new EmbedderError("Dense search requires an open vector cache.", "invalid_cache");
  }
  if (!query || typeof query.length !== "number" || query.length !== cache.dimension) {
    throw new EmbedderError(
      "The query vector does not match the cache dimension.",
      "embedder_dimension_mismatch",
      { expected: cache.dimension, received: query ? query.length : null },
    );
  }
  if (!cache.size) return [];
  const memo = unitMemo(index, config.units);
  const mapping = rowMapping(memo, cache);
  if (!mapping.present) return [];
  const queryNorm = vectorNorm(query);
  if (!(queryNorm > 0)) return [];
  const candidates = Array.isArray(config.candidates)
    ? config.candidates
    : // Required lazily: query.js requires this module for hybrid ranking.
      require("./query").applyFilters(index, config.filters || {});
  const { data } = mapping;
  const dimension = cache.dimension;
  const results = [];
  for (const doc of candidates) {
    const positions = memo.byConcept.get(doc.uri);
    if (!positions) continue;
    let best = -Infinity;
    let bestUnit = -1;
    for (const position of positions) {
      const offset = mapping.offsets[position];
      const norm = mapping.norms[position];
      if (offset < 0 || !(norm > 0)) continue;
      let dot = 0;
      for (let index = 0; index < dimension; index += 1) dot += query[index] * data[offset + index];
      const score = dot / (queryNorm * norm);
      if (score > best) {
        best = score;
        bestUnit = position;
      }
    }
    if (bestUnit !== -1) results.push({ id: doc.uri, score: best, unit: memo.units[bestUnit].id });
  }
  results.sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1));
  const limit = Number.isSafeInteger(config.limit) && config.limit > 0 ? config.limit : null;
  if (limit !== null && results.length > limit) results.length = limit;
  return results;
}

module.exports = {
  DEFAULT_EMBED_UNITS,
  EMBED_UNITS,
  denseCoverage,
  denseSearch,
  resolveUnits,
  unitMemo,
};
