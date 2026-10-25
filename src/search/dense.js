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
const { conceptUnits, contextualConceptUnits } = require("../embed/units");

// `embedUnits` names: whole concepts (default, chosen on the dev split) or sections
// (src/context/sections.js, one unit per section anchored `uri#slug`, the lead as `uri`;
// better on synonym queries, worse on keyword ones in the WP3c measurement).
// WP3c-2 adds the contextual variants: sections and concepts after a bounded prefix naming the
// concept's title, type and path (src/embed/units.js `contextPrefix`), each with its own hashes.
const EMBED_UNITS = Object.freeze([
  "concepts",
  "sections",
  "contextual-sections",
  "contextual-concepts",
]);
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
  if (name === "contextual-concepts") return contextualConceptUnits;
  let sections = null;
  try {
    const module = require("../context/sections");
    sections = name === "contextual-sections" ? module.contextualSectionUnits : module.sectionUnits;
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

// Dot product of the query with one cached row; four accumulators let the
// engine overlap the multiplications (about 20% faster at 512 dimensions).
function dot(query, data, offset, dimension) {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let index = 0;
  const end = dimension - (dimension % 4);
  for (; index < end; index += 4) {
    a += query[index] * data[offset + index];
    b += query[index + 1] * data[offset + index + 1];
    c += query[index + 2] * data[offset + index + 2];
    d += query[index + 3] * data[offset + index + 3];
  }
  for (; index < dimension; index += 1) a += query[index] * data[offset + index];
  return a + b + c + d;
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
  const { data, offsets, norms } = mapping;
  const dimension = cache.dimension;
  // Per-candidate best score and unit go to scratch arrays kept on the memo,
  // so a query allocates only its result objects (for the kept candidates).
  if (!memo.scratch || memo.scratch.scores.length < candidates.length) {
    memo.scratch = {
      scores: new Float64Array(candidates.length),
      units: new Int32Array(candidates.length),
    };
  }
  const { scores, units } = memo.scratch;
  let scored = 0;
  for (let position = 0; position < candidates.length; position += 1) {
    const unitPositions = memo.byConcept.get(candidates[position].uri);
    let best = -Infinity;
    let bestUnit = -1;
    if (unitPositions) {
      for (let next = 0; next < unitPositions.length; next += 1) {
        const unit = unitPositions[next];
        const offset = offsets[unit];
        const norm = norms[unit];
        if (offset < 0 || !(norm > 0)) continue;
        const score = dot(query, data, offset, dimension) / (queryNorm * norm);
        if (score > best) {
          best = score;
          bestUnit = unit;
        }
      }
    }
    scores[position] = best;
    units[position] = bestUnit;
    if (bestUnit !== -1) scored += 1;
  }
  const limit = Number.isSafeInteger(config.limit) && config.limit > 0 ? config.limit : scored;
  const kept = selectTop(candidates, scores, units, Math.min(limit, scored));
  return kept.map((position) => ({
    id: candidates[position].uri,
    score: scores[position],
    unit: memo.units[units[position]].id,
  }));
}

// Positions of the best `count` scored candidates, best first (ties by URI),
// through a bounded min-heap: O(n log count) instead of sorting all n.
function selectTop(candidates, scores, units, count) {
  if (count <= 0) return [];
  // a precedes b in the final order when its score is higher, or equal with a smaller URI.
  const before = (a, b) =>
    scores[a] > scores[b] || (scores[a] === scores[b] && candidates[a].uri < candidates[b].uri);
  const heap = [];
  const sift = (start) => {
    let node = start;
    for (;;) {
      const left = node * 2 + 1;
      const right = left + 1;
      let worst = node;
      if (left < heap.length && before(heap[worst], heap[left])) worst = left;
      if (right < heap.length && before(heap[worst], heap[right])) worst = right;
      if (worst === node) return;
      [heap[node], heap[worst]] = [heap[worst], heap[node]];
      node = worst;
    }
  };
  for (let position = 0; position < candidates.length; position += 1) {
    if (units[position] === -1) continue;
    if (heap.length < count) {
      heap.push(position);
      let node = heap.length - 1;
      while (node > 0) {
        const parent = (node - 1) >> 1;
        if (!before(heap[parent], heap[node])) break;
        [heap[node], heap[parent]] = [heap[parent], heap[node]];
        node = parent;
      }
    } else if (before(position, heap[0])) {
      heap[0] = position;
      sift(0);
    }
  }
  return heap.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
}

module.exports = {
  DEFAULT_EMBED_UNITS,
  EMBED_UNITS,
  denseCoverage,
  denseSearch,
  resolveUnits,
  unitMemo,
};
