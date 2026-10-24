"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { runEvaluation } = require("../scripts/eval-search");
const thresholds = require("./fixtures/retrieval/thresholds.json");

// WP1 acceptance (docs/plan-1.0.md WP1, R-4), pre-registered before the search
// changed: point estimates on both full query sets with the shipped default
// `languages: auto`. Revision 5 of the plan relaxed the flag criterion from
// "zero answerable flags" to at most 3% of answerable queries with a relevant
// top-1 flagged; thresholds.json still carries the earlier zero.
const FLAGGED_ANSWERABLE_TOP1_MAX_SHARE = 0.03;

test("the 0.10 lexical search meets the pre-registered WP1 targets on both full sets", () => {
  const report = runEvaluation({ fixtures: ["alpinaria", "atlas"], split: "all", bootstrap: 0 });
  const alpinaria = report.fixtures.alpinaria;
  const target = thresholds.alpinaria.target;
  assert.ok(
    alpinaria.overall.recallAt5 >= target.recallAt5,
    `alpinaria Recall@5 ${alpinaria.overall.recallAt5.toFixed(4)} < ${target.recallAt5}`,
  );
  assert.ok(
    alpinaria.overall.ndcgAt10 >= target.ndcgAt10,
    `alpinaria nDCG@10 ${alpinaria.overall.ndcgAt10.toFixed(4)} < ${target.ndcgAt10}`,
  );
  assert.ok(
    alpinaria.overall.zeroResultRate <= target.zeroResultRateMax,
    `alpinaria zero-result rate ${alpinaria.overall.zeroResultRate}`,
  );
  const flag = alpinaria.noAnswer.lowConfidence;
  assert.equal(flag.available, true, "every response must carry mode and per-result coverage");
  assert.ok(
    flag.recall >= target.lowConfidenceNoAnswerRecall,
    `alpinaria lowConfidence recall ${flag.recall} < ${target.lowConfidenceNoAnswerRecall}`,
  );
  const flaggedShare = flag.flaggedAnswerableTop1Hits / alpinaria.queries.answerable;
  assert.ok(
    flaggedShare <= FLAGGED_ANSWERABLE_TOP1_MAX_SHARE,
    `alpinaria flagged ${flag.flaggedAnswerableTop1Hits} answerable queries with a relevant top-1 (${(flaggedShare * 100).toFixed(1)}%)`,
  );

  const atlas = report.fixtures.atlas;
  assert.ok(
    atlas.overall.recallAt5 >= thresholds.atlas.target.recallAt5,
    `atlas Recall@5 ${atlas.overall.recallAt5.toFixed(4)} < ${thresholds.atlas.target.recallAt5}`,
  );
  assert.equal(atlas.noAnswer.lowConfidence.available, true);
  [alpinaria, atlas].forEach((fixture) => {
    assert.ok(fixture.perQuery.every((entry) => entry.mode === "all" || entry.mode === "any"));
  });
});
