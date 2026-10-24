"use strict";

// Seeded, stratified development / held-out split for a retrieval query set.
//
// Strata are category x language with a dev target of round(ratio * n) queries each (never fewer
// than one). The unit of assignment is a paraphrase family (queries sharing a `family` value:
// the same primary grade-2 target, see the fixture descriptions) or a single query without one;
// a family always lands in one split so that tuning on a development query never sees a held-out
// paraphrase of it. Families are placed first, in a seeded order, each on the side whose summed
// stratum deficit over its members is larger; single queries then fill the remaining quota of
// their own stratum in a seeded order. The result depends only on ids, families, categories,
// languages, seed and ratio, so the committed split can be re-derived and asserted by a test
// (test/retrieval-fixtures.test.js).

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

// FNV-1a over a key, folded with the seed, so each stratum (and the family pass) has its own stream.
function derivedSeed(seed, key) {
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

function unitKey(query) {
  return query.family ? `family:${query.family}` : `query:${query.id}`;
}

// Returns a Map from query id to "dev" | "heldout".
function assignSplit(queries, options) {
  const config = options || {};
  const seed = Number.isInteger(config.seed) ? config.seed : DEFAULT_SEED;
  const ratio = typeof config.devRatio === "number" ? config.devRatio : DEFAULT_DEV_RATIO;
  const sorted = queries.slice().sort((left, right) => String(left.id).localeCompare(String(right.id)));

  const targets = new Map();
  sorted.forEach((query) => {
    const key = stratumKey(query);
    if (!targets.has(key)) {
      targets.set(key, { total: 0, dev: 0, heldout: 0, assignedDev: 0, assignedHeldout: 0 });
    }
    targets.get(key).total += 1;
  });
  targets.forEach((entry) => {
    entry.dev = Math.max(1, Math.round(entry.total * ratio));
    entry.heldout = entry.total - entry.dev;
  });

  const families = new Map();
  const singles = new Map();
  sorted.forEach((query) => {
    if (query.family) {
      if (!families.has(query.family)) {
        families.set(query.family, []);
      }
      families.get(query.family).push(query);
    } else {
      const key = stratumKey(query);
      if (!singles.has(key)) {
        singles.set(key, []);
      }
      singles.get(key).push(query);
    }
  });

  const assignment = new Map();
  const place = (query, split) => {
    assignment.set(query.id, split);
    const entry = targets.get(stratumKey(query));
    if (split === "dev") {
      entry.assignedDev += 1;
    } else {
      entry.assignedHeldout += 1;
    }
  };

  const familyKeys = Array.from(families.keys()).sort();
  shuffle(familyKeys, mulberry32(derivedSeed(seed, "families"))).forEach((family) => {
    const members = families.get(family);
    let devDeficit = 0;
    let heldoutDeficit = 0;
    members.forEach((query) => {
      const entry = targets.get(stratumKey(query));
      devDeficit += entry.dev - entry.assignedDev;
      heldoutDeficit += entry.heldout - entry.assignedHeldout;
    });
    const split = devDeficit >= heldoutDeficit ? "dev" : "heldout";
    members.forEach((query) => place(query, split));
  });

  Array.from(singles.keys()).sort().forEach((key) => {
    const entry = targets.get(key);
    shuffle(singles.get(key), mulberry32(derivedSeed(seed, key))).forEach((query) => {
      place(query, entry.assignedDev < entry.dev ? "dev" : "heldout");
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
  unitKey,
};
