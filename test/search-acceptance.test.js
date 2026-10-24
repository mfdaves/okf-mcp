"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { runEvaluation } = require("../scripts/eval-search");
const thresholds = require("./fixtures/retrieval/thresholds.json");

// WP1 acceptance (docs/plan-1.0.md WP1, R-4), pre-registered in
// test/fixtures/retrieval/thresholds.json before the search changed: point
// estimates on both full query sets with the shipped default `languages: auto`.

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
  // Plan revision 5: at most this share of answerable queries with a relevant top-1 is flagged.
  const flaggedShare = flag.flaggedAnswerableTop1Hits / alpinaria.queries.answerable;
  assert.ok(
    flaggedShare <= target.lowConfidenceAnswerableTop1HitShareMax,
    `alpinaria flagged ${flag.flaggedAnswerableTop1Hits} answerable queries with a relevant top-1 (${(flaggedShare * 100).toFixed(1)}%, max ${target.lowConfidenceAnswerableTop1HitShareMax * 100}%)`,
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
