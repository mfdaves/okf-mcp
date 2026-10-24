"use strict";

// WP3a acceptance (docs/plan-1.0.md section 7, pre-registered in thresholds.json as
// `target.sectionAnchorHitRate`): assembleContext returns the labelled `sectionAnchor` among its
// packed sections for at least 80% of the labelled development queries on both fixtures, never
// exceeds the budget, and keeps p95 latency within budget. The latency budget is 40 ms on the
// fixtures; CI gates on 3x that ceiling (section 4.6: absolute numbers are trended, ceilings
// keep runner variance from flaking) and the committed report records the measured value.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { DEFAULT_OUT, parseArgs, runContextEvaluation } = require("../scripts/eval-context");
const thresholds = require("./fixtures/retrieval/thresholds.json");

const FIXTURES = ["alpinaria", "atlas"];
const BUDGET_TOKENS = 1200;
const P95_BUDGET_MS = 40;
const CI_CEILING_FACTOR = 3;
// WP0 labelled at least 40 development queries per fixture.
const MIN_LABELLED_DEV = 40;
const REPORTS = path.join(__dirname, "fixtures", "retrieval", "reports");

test("the labelled section anchor is packed for at least 80% of dev queries on both fixtures", () => {
  const report = runContextEvaluation({
    fixtures: FIXTURES,
    budgetTokens: BUDGET_TOKENS,
    bootstrap: 1000,
  });
  FIXTURES.forEach((name) => {
    const result = report.fixtures[name];
    const target = thresholds[name].target.sectionAnchorHitRate;
    assert.equal(target, 0.8, `${name}: the pre-registered target is unchanged`);
    assert.equal(result.corpus.validForProject, true, `${name} index is valid for project`);
    const dev = result.bySplit.dev;
    assert.ok(dev.queries >= MIN_LABELLED_DEV, `${name}: ${dev.queries} labelled dev queries`);
    assert.ok(
      dev.anchorHitRate >= target,
      `${name}: dev anchor hit rate ${dev.anchorHitRate.toFixed(3)} < ${target}`,
    );
    Object.entries(result.bySplit).forEach(([split, summary]) => {
      assert.equal(summary.budgetExceeded, 0, `${name}/${split}: budget exceeded`);
      assert.ok(summary.maxUsedTokens <= BUDGET_TOKENS, `${name}/${split}: max used tokens`);
      assert.ok(
        summary.ci.anchorHit.low <= summary.anchorHitRate &&
          summary.anchorHitRate <= summary.ci.anchorHit.high,
        `${name}/${split}: the point estimate lies in its CI`,
      );
      assert.ok(
        summary.latency.p95Ms <= P95_BUDGET_MS * CI_CEILING_FACTOR,
        `${name}/${split}: p95 ${summary.latency.p95Ms} ms above the ${P95_BUDGET_MS * CI_CEILING_FACTOR} ms ceiling`,
      );
    });
    // Every packed row cites a section of a concept the index knows.
    result.perQuery.forEach((row) => {
      assert.ok(row.sections >= 0 && row.sections <= 20, `${name} ${row.id}: section cap`);
      assert.equal(row.hitAt1 <= row.anchorHit, true);
    });
  });
});

test("routine runs write to the ignored latest path and the committed report meets the gate", () => {
  assert.equal(parseArgs([]).out, DEFAULT_OUT);
  assert.match(path.basename(DEFAULT_OUT), /^latest/);
  assert.deepEqual(parseArgs([]).fixtures, FIXTURES);
  assert.equal(parseArgs([]).budgetTokens, BUDGET_TOKENS);
  const committed = JSON.parse(
    fs.readFileSync(path.join(REPORTS, "context-0.11-2026-10-24.json"), "utf8"),
  );
  assert.equal(committed.budgetTokens, BUDGET_TOKENS);
  FIXTURES.forEach((name) => {
    const dev = committed.fixtures[name].bySplit.dev;
    assert.ok(dev.anchorHitRate >= thresholds[name].target.sectionAnchorHitRate, name);
    assert.ok(dev.latency.p95Ms <= P95_BUDGET_MS, `${name}: committed p95 ${dev.latency.p95Ms}`);
  });
});
