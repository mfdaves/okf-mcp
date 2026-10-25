"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildProjectIndex } = require("../src/indexer");
const { LOW_CONFIDENCE_COVERAGE, searchConcepts } = require("../src/search");
const { runEvaluation } = require("../scripts/eval-search");
const thresholds = require("./fixtures/retrieval/thresholds.json");

const FIXTURES_ROOT = path.join(__dirname, "fixtures", "retrieval");
const FIXTURES = ["alpinaria", "atlas"];

// WP1 acceptance (docs/plan-1.0.md WP1, R-4), pre-registered in
// test/fixtures/retrieval/thresholds.json before the search changed: point
// estimates on both full query sets with the shipped default `languages: auto`.

// Runs every query of a fixture through the shipped search and counts the
// `lowConfidence` it returns (not a reconstruction from mode and coverage),
// checking each returned flag against the independent rule on the way.
function shippedFlagStatistics(name) {
  const root = path.join(FIXTURES_ROOT, name);
  const index = buildProjectIndex(path.join(root, "okf.project.yaml"));
  const sidecar = JSON.parse(fs.readFileSync(path.join(root, "queries.json"), "utf8"));
  const stats = { noAnswer: 0, flaggedNoAnswer: 0, answerable: 0, flaggedAnswerableTop1Hits: 0 };
  sidecar.queries.forEach((query) => {
    const response = searchConcepts(index, { query: query.query, limit: 10, asOf: sidecar.as_of });
    const top = response.results[0];
    const expectedFlag =
      response.mode === "any" && Boolean(top) && top.coverage < LOW_CONFIDENCE_COVERAGE;
    assert.equal(typeof response.lowConfidence, "boolean", `${name} ${query.id}: flag missing`);
    assert.equal(
      response.lowConfidence,
      expectedFlag,
      `${name} ${query.id}: the shipped flag disagrees with the rule`,
    );
    const relevant = new Set(
      (query.expected || [])
        .filter((entry) => entry.grade >= 1)
        .map((entry) => `okf://${entry.bundle}/${entry.id}`),
    );
    if (query.category === "no-answer" || !relevant.size) {
      stats.noAnswer += 1;
      if (response.lowConfidence) stats.flaggedNoAnswer += 1;
      return;
    }
    stats.answerable += 1;
    if (response.lowConfidence && top && relevant.has(top.uri)) {
      stats.flaggedAnswerableTop1Hits += 1;
    }
  });
  stats.recall = stats.flaggedNoAnswer / stats.noAnswer;
  stats.top1HitShare = stats.flaggedAnswerableTop1Hits / stats.answerable;
  return stats;
}

test("the 0.10 lexical search meets the pre-registered WP1 targets on both full sets", () => {
  const report = runEvaluation({ fixtures: FIXTURES, split: "all", bootstrap: 0 });
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
  const atlas = report.fixtures.atlas;
  assert.ok(
    atlas.overall.recallAt5 >= thresholds.atlas.target.recallAt5,
    `atlas Recall@5 ${atlas.overall.recallAt5.toFixed(4)} < ${thresholds.atlas.target.recallAt5}`,
  );

  // The flag gate counts what searchConcepts returns; the harness's reconstruction must agree.
  const shipped = shippedFlagStatistics("alpinaria");
  assert.equal(shipped.noAnswer, alpinaria.queries.noAnswer);
  assert.equal(shipped.answerable, alpinaria.queries.answerable);
  assert.equal(alpinaria.noAnswer.lowConfidence.available, true);
  assert.equal(shipped.flaggedNoAnswer, alpinaria.noAnswer.lowConfidence.flaggedNoAnswer);
  assert.equal(
    shipped.flaggedAnswerableTop1Hits,
    alpinaria.noAnswer.lowConfidence.flaggedAnswerableTop1Hits,
  );
  assert.ok(
    shipped.recall >= target.lowConfidenceNoAnswerRecall,
    `alpinaria lowConfidence recall ${shipped.recall} < ${target.lowConfidenceNoAnswerRecall}`,
  );
  assert.ok(
    shipped.top1HitShare <= target.lowConfidenceAnswerableTop1HitShareMax,
    `alpinaria flagged ${shipped.flaggedAnswerableTop1Hits} answerable queries with a relevant top-1 (${(shipped.top1HitShare * 100).toFixed(1)}%, max ${target.lowConfidenceAnswerableTop1HitShareMax * 100}%)`,
  );
  const atlasShipped = shippedFlagStatistics("atlas");
  assert.equal(atlas.noAnswer.lowConfidence.available, true);
  assert.equal(atlasShipped.flaggedNoAnswer, atlas.noAnswer.lowConfidence.flaggedNoAnswer);
  FIXTURES.forEach((name) => {
    assert.ok(
      report.fixtures[name].perQuery.every((entry) => ["all", "any", "auto"].includes(entry.mode)),
    );
  });
});
