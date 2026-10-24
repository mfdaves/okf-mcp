"use strict";

// Search module for scripts/index-benchmark.js that times hybrid search (lexical + dense
// cosine + fusion) without an embedder: prepare() fills an in-memory stand-in for the vector
// cache with seeded random unit vectors and every query gets a seeded random query vector, so
// the measured latency excludes query encoding by construction (docs/plan-1.0.md section 4.6,
// "hybrid search p95, 20k vectors").
//
//   node --expose-gc scripts/index-benchmark.js --sizes 5000,20000 --rounds 5 \
//     --search-module scripts/hybrid-bench-module.js \
//     --search-options '{"dimension":512,"unitsPerConcept":4,"alpha":0.4}'
//
// unitsPerConcept > 1 stands in for section units (`uri#s<n>`): 5,000 concepts x 4 units is
// 20,000 vectors. The stand-in implements only what dense scoring reads from a cache
// (dimension, size, data, generation, get, has).

const crypto = require("node:crypto");

const { hashUnitText } = require("../src/embed/units");
const { DEFAULT_FUSION_ALPHA } = require("../src/search/fusion");
const { searchConcepts } = require("../src/search/query");

const STATE = new WeakMap();

function seeded(text) {
  let state = crypto.createHash("sha256").update(String(text)).digest().readUInt32LE(0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

function fillUnit(target, offset, dimension, random) {
  let norm = 0;
  for (let index = 0; index < dimension; index += 1) {
    const value = random();
    target[offset + index] = value;
    norm += value * value;
  }
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < dimension; index += 1) target[offset + index] /= norm;
}

function settings(options) {
  const config = options || {};
  return {
    dimension: Number.isSafeInteger(config.dimension) ? config.dimension : 512,
    unitsPerConcept: Number.isSafeInteger(config.unitsPerConcept) ? config.unitsPerConcept : 1,
    alpha: typeof config.alpha === "number" ? config.alpha : DEFAULT_FUSION_ALPHA,
  };
}

function prepare(index, context) {
  const { dimension, unitsPerConcept } = settings(context?.options);
  // Synthetic units: hashes only need to be distinct, texts are never embedded.
  const units = index.concepts.flatMap((doc) =>
    Array.from({ length: unitsPerConcept }, (_value, position) => {
      const id = unitsPerConcept === 1 ? doc.uri : `${doc.uri}#s${position}`;
      return { id, text: id, hash: hashUnitText(id) };
    }),
  );
  const data = new Float32Array(units.length * dimension);
  const rows = new Map();
  const random = seeded("okf-hybrid-bench");
  units.forEach((unit, row) => {
    fillUnit(data, row * dimension, dimension, random);
    rows.set(unit.hash, row);
  });
  const cache = {
    dimension,
    size: units.length,
    data,
    generation: "synthetic",
    has: (hash) => rows.has(hash),
    get(hash) {
      const row = rows.get(hash);
      return row === undefined ? null : data.subarray(row * dimension, (row + 1) * dimension);
    },
  };
  const unitsOf = () => units;
  STATE.set(index, { cache, unitsOf, vectors: new Map() });
  // Build the lexical index and the dense unit mapping here, as the server does at startup.
  searchConcepts(index, {
    query: "warm up",
    hybrid: true,
    queryVector: queryVector(index, "warm up", dimension),
    vectorCache: cache,
    embedUnits: unitsOf,
  });
  return { units: units.length, dimension };
}

function queryVector(index, query, dimension) {
  const state = STATE.get(index);
  let vector = state.vectors.get(query);
  if (!vector) {
    vector = new Float32Array(dimension);
    fillUnit(vector, 0, dimension, seeded(query));
    state.vectors.set(query, vector);
  }
  return vector;
}

function search(index, options) {
  const state = STATE.get(index);
  const { dimension, alpha } = settings(options);
  return searchConcepts(index, {
    query: options.query,
    limit: options.limit,
    hybrid: true,
    queryVector: queryVector(index, options.query, dimension),
    vectorCache: state.cache,
    embedUnits: state.unitsOf,
    alpha,
  });
}

module.exports = { name: "hybrid-bench (synthetic vectors)", prepare, search };
