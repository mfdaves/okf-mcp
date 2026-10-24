"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { LOW_CONFIDENCE_COVERAGE, runEvaluation } = require("../scripts/eval-search");
const thresholds = require("./fixtures/retrieval/thresholds.json");

const FIXTURES = ["alpinaria", "atlas"];
// Floors are the measured baseline minus its bootstrap half-width (thresholds.json `baseline`).
const FLOOR_METRICS = ["recallAt5", "mustRecallAt5", "ndcgAt10", "mrrAt10", "p1"];

test("the shipped search meets the pre-registered baseline floors on both fixtures (--split all)", () => {
  const report = runEvaluation({ fixtures: FIXTURES, split: "all", bootstrap: 1000 });
  FIXTURES.forEach((name) => {
    const result = report.fixtures[name];
    const baseline = thresholds[name].baseline;
    assert.equal(result.corpus.validForProject, true, `${name} index is not valid for project`);
    assert.equal(result.queries.expectedMissingFromIndex.length, 0, `${name} references concepts missing from the index`);
    FLOOR_METRICS.forEach((metric) => {
      assert.ok(result.overall[metric] >= baseline[metric], `${name} ${metric} ${result.overall[metric].toFixed(4)} is below the baseline floor ${baseline[metric]}`);
    });
    assert.ok(result.overall.zeroResultRate <= baseline.zeroResultRateMax, `${name} zero-result rate ${result.overall.zeroResultRate.toFixed(4)} is above ${baseline.zeroResultRateMax}`);
    // The report carries what the plan's gates read: CIs, breakdowns, no-answer handling, latency, RSS.
    assert.ok(result.overall.ci.recallAt5.halfWidth > 0 && result.overall.ci.ndcgAt10.halfWidth > 0);
    assert.ok(Object.keys(result.byCategory).length >= 5 && Object.keys(result.byLang).length >= 2);
    assert.ok(result.bySplit.dev && result.bySplit.heldout);
    assert.ok(result.noAnswer.queries >= 8);
    assert.ok(typeof result.noAnswer.lowConfidence.available === "boolean");
    assert.ok(result.latency.p95Ms >= 0 && result.build.okfIndexMs > 0 && result.build.rssEndMb > 0);
  });
  // Targets are recorded for later work packages and must stay pre-registered, never tuned here.
  assert.equal(thresholds.alpinaria.target.recallAt5, 0.72);
  assert.equal(thresholds.alpinaria.target.ndcgAt10, 0.78);
  assert.equal(thresholds.atlas.target.recallAt5, 0.7);
});

test("the harness honours --split and picks up mode and coverage from a search module", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "okf-eval-stub-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A stub that answers every query with one fixed concept in "any" mode. Coverage is exactly
  // 0.5 for queries containing "SPID" (not flagged: the rule is strictly below) and 0.3 otherwise.
  const stub = path.join(dir, "stub-search.js");
  fs.writeFileSync(stub, [
    "\"use strict\";",
    "module.exports = {",
    "  name: \"stub\",",
    "  searchConcepts(index, options) {",
    "    const coverage = /SPID/.test(options.query) ? 0.5 : 0.3;",
    "    const doc = index.concepts.find((concept) => concept.uri === \"okf://atlas/services/identity-service\");",
    "    return { mode: \"any\", total: 1, results: [{ uri: doc.uri, score: 1, coverage, relevance: 1 }] };",
    "  },",
    "};",
    "",
  ].join("\n"), "utf8");
  const report = runEvaluation({ fixtures: ["atlas"], split: "dev", searchModule: stub, bootstrap: 20 });
  const result = report.fixtures.atlas;
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "retrieval", "atlas", "queries.json"), "utf8")).queries;
  assert.equal(result.queries.total, all.filter((query) => query.split === "dev").length);
  assert.ok(result.perQuery.every((entry) => entry.split === "dev"));
  const lc = result.noAnswer.lowConfidence;
  assert.equal(lc.available, true);
  assert.equal(LOW_CONFIDENCE_COVERAGE, 0.5);
  // Every no-answer query is flagged (coverage 0.3 < 0.5), so recall is 1 and precision < 1.
  assert.equal(lc.flaggedNoAnswer, result.noAnswer.queries);
  assert.equal(lc.recall, 1);
  assert.ok(lc.precision > 0 && lc.precision < 1);
  const spid = result.perQuery.filter((entry) => /SPID/.test(entry.query));
  assert.ok(spid.length >= 1);
  spid.forEach((entry) => assert.equal(entry.lowConfidence, false, `${entry.id}: coverage exactly 0.5 must not be flagged`));
  assert.equal(lc.flaggedAnswerable, result.perQuery.filter((entry) => entry.answerable && !/SPID/.test(entry.query)).length);
});
