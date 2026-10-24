"use strict";

// Hybrid fusion by convex combination of min-max normalised scores
// (docs/plan-1.0.md R-10; Bruch, Gai and Ingber, "An Analysis of Fusion
// Functions for Hybrid Retrieval", arXiv:2210.11934):
//
//   fused = alpha * norm(dense) + (1 - alpha) * norm(lexical)
//
// Each side is normalised over its own ranked list to [0, 1]; a candidate
// missing from one list contributes 0 from that side. alpha 0 returns the
// lexical list and alpha 1 the dense list exactly (the other side is not
// merged in), so both ends reduce to a single retriever. Ties are broken by
// lexical rank, then dense rank, then id, so the order is deterministic.

// Chosen on the development split of both fixtures (WP3c report,
// test/fixtures/retrieval/reports/hybrid-0.11-2026-10-24.md).
const DEFAULT_FUSION_ALPHA = 0.5;

function fusionAlpha(value) {
  if (value === undefined || value === null) return DEFAULT_FUSION_ALPHA;
  const alpha = Number(value);
  if (typeof value === "boolean" || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new TypeError("fusion alpha must be a number between 0 and 1.");
  }
  return alpha;
}

// [{ id, score }] in rank order -> Map(id -> { rank, score, norm }). A list
// whose scores are all equal normalises to 1 (every entry is the best).
function normalise(list) {
  const entries = new Map();
  if (!Array.isArray(list) || !list.length) return entries;
  let min = Infinity;
  let max = -Infinity;
  list.forEach((entry) => {
    if (entry.score < min) min = entry.score;
    if (entry.score > max) max = entry.score;
  });
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
  const lexical = normalise(assertList(config.lexical, "lexical"));
  const dense = normalise(assertList(config.dense, "dense"));
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
  fused.sort(
    (a, b) =>
      b.fusedScore - a.fusedScore ||
      a.lexicalRank - b.lexicalRank ||
      a.denseRank - b.denseRank ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return fused.map(({ lexicalRank, denseRank, ...entry }) => entry);
}

module.exports = {
  DEFAULT_FUSION_ALPHA,
  fuseRankings,
  fusionAlpha,
};
