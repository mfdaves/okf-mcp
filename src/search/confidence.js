"use strict";

// Abstention signals (docs/plan-1.0.md R-4; WP3c-2 abstention v2). Every response to a query
// carries `confidence: { coverage, topSimilarity, lowConfidence, reasons }`:
//
//   coverage       share of the query terms the top result matched (lexical evidence, also for
//                  a semantic neighbour), null when nothing was returned;
//   topSimilarity  the best cosine similarity between the query and any candidate's units when
//                  the semantic side ran, null otherwise;
//   lowConfidence  (mode is any and coverage < 0.5) or (topSimilarity < minSimilarity and
//                  coverage < 0.5);
//   reasons        which clauses fired: weak_lexical_match, low_similarity.
//
// Lexical-only responses have no similarity, so the rule reduces to the 0.10 one. minSimilarity
// depends on the embedding model; the default was tuned for text-embedding-3-small on the
// development split of both fixtures (the most no-answer queries flagged while at most 3% of
// answerable queries with a relevant top result are) and is configurable per deployment as
// `confidence.minSimilarity` (test/fixtures/retrieval/reports/hybrid-0.12-2026-10-25.md).

const LOW_CONFIDENCE_COVERAGE = 0.5;
// Dev choice: every value from 0 to 0.8 flags the same no-answer queries and the same answerable
// queries with a relevant top result on both development splits (no no-answer query there has a
// top coverage below 0.5 without already being an any-term fallback), so the pre-registered
// tie-break, the smallest, applies: the similarity clause only fires on a negative cosine unless
// a deployment sets its own threshold.
const DEFAULT_MIN_SIMILARITY = 0;
const CONFIDENCE_REASONS = Object.freeze(["weak_lexical_match", "low_similarity"]);

function minSimilarityOption(value) {
  if (value === undefined || value === null) return DEFAULT_MIN_SIMILARITY;
  const number = Number(value);
  if (typeof value === "boolean" || !Number.isFinite(number) || number < -1 || number > 1) {
    throw new TypeError("minSimilarity must be a number between -1 and 1.");
  }
  return number;
}

// signals: { mode, coverage (top result, or null), topSimilarity (or null) }.
function assessConfidence(signals, minSimilarity) {
  const source = signals || {};
  const coverage = typeof source.coverage === "number" ? source.coverage : null;
  const topSimilarity =
    typeof source.topSimilarity === "number" && Number.isFinite(source.topSimilarity)
      ? source.topSimilarity
      : null;
  const weak = coverage !== null && coverage < LOW_CONFIDENCE_COVERAGE;
  const reasons = [];
  if (weak && source.mode === "any") reasons.push("weak_lexical_match");
  if (weak && topSimilarity !== null && topSimilarity < minSimilarityOption(minSimilarity)) {
    reasons.push("low_similarity");
  }
  return { coverage, topSimilarity, lowConfidence: reasons.length > 0, reasons };
}

module.exports = {
  CONFIDENCE_REASONS,
  DEFAULT_MIN_SIMILARITY,
  LOW_CONFIDENCE_COVERAGE,
  assessConfidence,
  minSimilarityOption,
};
