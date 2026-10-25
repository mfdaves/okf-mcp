"use strict";

// Hybrid fusion by convex combination of min-max normalised scores
// (docs/plan-1.0.md R-10; Bruch, Gai and Ingber, "An Analysis of Fusion
// Functions for Hybrid Retrieval", arXiv:2210.11934):
//
//   fused = alpha * norm(dense) + (1 - alpha) * norm(lexical)
//
// Each side is normalised over its own ranked list to [0, 1] with its
// observed maximum as the upper bound; the lower bound is the observed
// minimum ("minmax") or the scoring function's theoretical minimum ("tmm":
// 0 for the BM25-style lexical score, -1 for cosine; Bruch et al. section 4),
// or the theoretical minimum on the lexical side only ("lexical-tmm"). Under
// plain min-max the weakest lexical hit maps to 0, the same as a candidate the
// lexical side never returned, which matters when the all-term set is small.
// A candidate missing from one list contributes 0 from that side. alpha 0 returns the
// lexical list and alpha 1 the dense list exactly (the other side is not
// merged in), so both ends reduce to a single retriever. Ties are broken by
// the dominant side's rank, then the other side's, then id, so the order is deterministic.

// Chosen with the default concept units on the development split of both fixtures with
// text-embedding-3-small at 512 dimensions: the pre-registered rule over alpha 0..1 under
// minmax, tmm and lexical-tmm (best mean dev Recall@5, ties within 0.005 by mean nDCG@10,
// then the smaller alpha) (test/fixtures/retrieval/reports/hybrid-0.11-2026-10-24.md).
const DEFAULT_FUSION_ALPHA = 0.4;
const FUSION_NORMALIZATIONS = Object.freeze(["minmax", "tmm", "lexical-tmm"]);
const DEFAULT_FUSION_NORMALIZATION = "tmm";
// Theoretical lower bounds per side, used by "tmm" and "lexical-tmm".
const THEORETICAL_MIN = Object.freeze({ lexical: 0, dense: -1 });

// Adaptive weight (WP3c-2): `fusion.alpha: "adaptive"` decides the weight once per query from
// signals the lexical pass has already computed, so every page of a query uses the same one:
//
//   literal terms (quoted or identifier-like) matched by the all-term pass -> low (the literal
//     guard keeps the all-term hits ahead as before);
//   at least `autoFill` all-term hits and a best lexical coverage of 1     -> mid;
//   no all-term hit and a best lexical coverage below 0.5                  -> high;
//   otherwise linear in the best lexical coverage, from high at 0.5 to mid at 1.
//
// With high >= mid the weight never grows with the lexical coverage. The weights are tuned on
// the development split (test/fixtures/retrieval/reports/hybrid-0.12-2026-10-25.md).
const ADAPTIVE_ALPHA = "adaptive";
// Dev-split choice over low {0.1, 0.2, 0.3} x mid {0.3, 0.4, 0.5} x high {0.6, 0.75, 0.9}
// (best mean Recall@5, ties within 0.005 by mean nDCG@10, then the smallest sum). The fixed
// 0.4 stays the default: the adaptive weight did not meet its pre-registered conditions.
const DEFAULT_ADAPTIVE_WEIGHTS = Object.freeze({ low: 0.1, mid: 0.5, high: 0.9 });
const ADAPTIVE_WEAK_COVERAGE = 0.5;
// The fusion weight used when none is configured: a number, or ADAPTIVE_ALPHA.
const DEFAULT_ALPHA_SETTING = DEFAULT_FUSION_ALPHA;
const ALPHA_REASONS = Object.freeze([
  "fixed",
  "literal_terms",
  "all_terms",
  "weak_lexical",
  "interpolated",
]);

function fusionNormalization(value) {
  if (value === undefined || value === null) return DEFAULT_FUSION_NORMALIZATION;
  if (!FUSION_NORMALIZATIONS.includes(value)) {
    throw new TypeError(`fusion normalization must be one of ${FUSION_NORMALIZATIONS.join(", ")}.`);
  }
  return value;
}

function fusionAlpha(value) {
  if (value === undefined || value === null) return DEFAULT_FUSION_ALPHA;
  const alpha = Number(value);
  if (typeof value === "boolean" || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new TypeError("fusion alpha must be a number between 0 and 1.");
  }
  return alpha;
}

// A configured weight: ADAPTIVE_ALPHA or a number in [0, 1] (DEFAULT_ALPHA_SETTING when unset).
function fusionAlphaSetting(value) {
  if (value === undefined || value === null) return DEFAULT_ALPHA_SETTING;
  if (value === ADAPTIVE_ALPHA) return ADAPTIVE_ALPHA;
  try {
    return fusionAlpha(value);
  } catch {
    throw new TypeError(`fusion alpha must be "${ADAPTIVE_ALPHA}" or a number between 0 and 1.`);
  }
}

// { low, mid, high } over the defaults; every weight in [0, 1] and high >= mid.
function adaptiveWeights(value) {
  if (value === undefined || value === null) return DEFAULT_ADAPTIVE_WEIGHTS;
  const unknown =
    typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).filter((key) => !Object.hasOwn(DEFAULT_ADAPTIVE_WEIGHTS, key))
      : ["value"];
  if (unknown.length) {
    throw new TypeError("fusion adaptive weights must be an object of low, mid and high.");
  }
  const weights = {};
  Object.keys(DEFAULT_ADAPTIVE_WEIGHTS).forEach((key) => {
    weights[key] =
      value[key] === undefined ? DEFAULT_ADAPTIVE_WEIGHTS[key] : fusionAlpha(value[key]);
  });
  if (weights.high < weights.mid) {
    throw new TypeError("fusion adaptive weights need high >= mid.");
  }
  return Object.freeze(weights);
}

const roundWeight = (value) => Math.round(value * 1e6) / 1e6;

// signals: { literal, allTermsTotal, autoFill, topCoverage } -> { alpha, reason }.
function adaptiveAlpha(signals, weights) {
  const config = adaptiveWeights(weights);
  const source = signals || {};
  const coverage = Math.min(1, Math.max(0, Number(source.topCoverage) || 0));
  const allTerms = Number(source.allTermsTotal) || 0;
  const autoFill = Number(source.autoFill) || 0;
  if (source.literal) return { alpha: config.low, reason: "literal_terms" };
  if (allTerms > 0 && allTerms >= autoFill && coverage >= 1) {
    return { alpha: config.mid, reason: "all_terms" };
  }
  if (allTerms === 0 && coverage < ADAPTIVE_WEAK_COVERAGE) {
    return { alpha: config.high, reason: "weak_lexical" };
  }
  const share = Math.min(
    1,
    Math.max(0, (coverage - ADAPTIVE_WEAK_COVERAGE) / (1 - ADAPTIVE_WEAK_COVERAGE)),
  );
  return {
    alpha: roundWeight(config.high + (config.mid - config.high) * share),
    reason: "interpolated",
  };
}

// The weight of one query: a fixed setting as configured, or the adaptive rule's choice.
function resolveAlpha(setting, signals, weights) {
  const value = fusionAlphaSetting(setting);
  if (value === ADAPTIVE_ALPHA) return adaptiveAlpha(signals, weights);
  return { alpha: value, reason: "fixed" };
}

// [{ id, score }] in rank order -> Map(id -> { rank, score, norm }). With
// `floor` null the observed minimum is the lower bound; a list whose scores
// are all equal then normalises to 1 (every entry is the best).
function normalise(list, floor) {
  const entries = new Map();
  if (!Array.isArray(list) || !list.length) return entries;
  let min = Infinity;
  let max = -Infinity;
  list.forEach((entry) => {
    if (entry.score < min) min = entry.score;
    if (entry.score > max) max = entry.score;
  });
  if (floor !== null && floor !== undefined) min = Math.min(floor, min);
  const span = max - min;
  list.forEach((entry, rank) => {
    if (entries.has(entry.id)) return;
    entries.set(entry.id, {
      rank,
      score: entry.score,
      norm: span > 0 ? (entry.score - min) / span : 1,
    });
  });
  return entries;
}

function assertList(list, name) {
  if (list === undefined || list === null) return [];
  if (
    !Array.isArray(list) ||
    list.some((entry) => !entry || typeof entry.id !== "string" || !Number.isFinite(entry.score))
  ) {
    throw new TypeError(`${name} must be an array of { id, score } entries.`);
  }
  return list;
}

// lexical, dense: [{ id, score }] each in its own rank order (best first).
// Returns [{ id, lexicalScore, denseScore, lexicalNorm, denseNorm, fusedScore }]
// sorted by fusedScore; a score is null when the candidate is absent from
// that list.
function fuseRankings(options) {
  const config = options || {};
  const alpha = fusionAlpha(config.alpha);
  const normalization = fusionNormalization(config.normalization);
  const lexical = normalise(
    assertList(config.lexical, "lexical"),
    normalization === "minmax" ? null : THEORETICAL_MIN.lexical,
  );
  const dense = normalise(
    assertList(config.dense, "dense"),
    normalization === "tmm" ? THEORETICAL_MIN.dense : null,
  );
  const ids = [];
  const seen = new Set();
  const take = (map) => {
    map.forEach((_value, id) => {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });
  };
  if (alpha < 1) take(lexical);
  if (alpha > 0) take(dense);
  const fused = ids.map((id) => {
    const left = lexical.get(id);
    const right = dense.get(id);
    const lexicalNorm = left ? left.norm : 0;
    const denseNorm = right ? right.norm : 0;
    return {
      id,
      lexicalScore: left ? left.score : null,
      denseScore: right ? right.score : null,
      lexicalNorm,
      denseNorm,
      fusedScore: alpha * denseNorm + (1 - alpha) * lexicalNorm,
      lexicalRank: left ? left.rank : Infinity,
      denseRank: right ? right.rank : Infinity,
    };
  });
  // Ties follow the dominant side's order first (dense when alpha > 0.5), so
  // alpha 1 keeps dense ties in dense order and alpha 0 lexical ties in
  // lexical order. Infinity - Infinity is NaN, which falls through.
  const [first, second] = alpha > 0.5 ? ["denseRank", "lexicalRank"] : ["lexicalRank", "denseRank"];
  fused.sort(
    (a, b) =>
      b.fusedScore - a.fusedScore ||
      a[first] - b[first] ||
      a[second] - b[second] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return fused.map(({ lexicalRank, denseRank, ...entry }) => entry);
}

module.exports = {
  ADAPTIVE_ALPHA,
  ALPHA_REASONS,
  DEFAULT_ADAPTIVE_WEIGHTS,
  DEFAULT_ALPHA_SETTING,
  DEFAULT_FUSION_ALPHA,
  DEFAULT_FUSION_NORMALIZATION,
  FUSION_NORMALIZATIONS,
  adaptiveAlpha,
  adaptiveWeights,
  fuseRankings,
  fusionAlpha,
  fusionAlphaSetting,
  fusionNormalization,
  resolveAlpha,
};
