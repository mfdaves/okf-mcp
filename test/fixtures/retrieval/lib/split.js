"use strict";

// Seeded, stratified development / held-out split for a retrieval query set.
//
// Strata are category x language. Inside each stratum the queries are ordered by id, shuffled
// with a seeded generator derived from the global seed and the stratum key, and the first
// round(ratio * n) go to "dev" (never fewer than one when the stratum is non-empty). The result
// depends only on the ids, categories, languages, seed and ratio, so adding a query to one
// stratum never moves queries in another stratum, and the committed split can be re-derived
// and asserted by a test (test/retrieval-fixtures.test.js).

const DEFAULT_SEED = 20261024;
const DEFAULT_DEV_RATIO = 0.7;

function mulberry32(seed) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over the stratum key, folded with the seed, so each stratum has its own stream.
function stratumSeed(seed, key) {
  let hash = 0x811C9DC5;
  for (const char of String(key)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash ^ (seed | 0)) | 0;
}

function shuffle(items, random) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = copy[index];
    copy[index] = copy[swap];
    copy[swap] = held;
  }
  return copy;
}

function stratumKey(query) {
  return `${query.category}/${query.lang}`;
}

// Returns a Map from query id to "dev" | "heldout".
function assignSplit(queries, options) {
  const config = options || {};
  const seed = Number.isInteger(config.seed) ? config.seed : DEFAULT_SEED;
  const ratio = typeof config.devRatio === "number" ? config.devRatio : DEFAULT_DEV_RATIO;
  const strata = new Map();
  queries.forEach((query) => {
    const key = stratumKey(query);
    if (!strata.has(key)) {
      strata.set(key, []);
    }
    strata.get(key).push(query.id);
  });
  const assignment = new Map();
  Array.from(strata.keys()).sort().forEach((key) => {
    const ids = strata.get(key).slice().sort();
    const shuffled = shuffle(ids, mulberry32(stratumSeed(seed, key)));
    const devCount = Math.max(1, Math.round(ids.length * ratio));
    shuffled.forEach((id, position) => {
      assignment.set(id, position < devCount ? "dev" : "heldout");
    });
  });
  return assignment;
}

function splitCounts(queries) {
  const counts = { dev: 0, heldout: 0 };
  queries.forEach((query) => {
    if (query.split === "dev" || query.split === "heldout") {
      counts[query.split] += 1;
    }
  });
  return counts;
}

module.exports = {
  DEFAULT_DEV_RATIO,
  DEFAULT_SEED,
  assignSplit,
  splitCounts,
  stratumKey,
};
