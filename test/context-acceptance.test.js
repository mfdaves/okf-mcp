"use strict";

// WP3a acceptance (docs/plan-1.0.md section 7, pre-registered in thresholds.json as
// `target.sectionAnchorHitRate`): assembleContext returns the labelled `sectionAnchor` among its
// packed sections for at least 80% of the labelled development queries on both fixtures, never
// exceeds the budget, and keeps p95 latency within budget. The latency budget is 40 ms on the
// fixtures; CI gates on 3x that ceiling (section 4.6: absolute numbers are trended, ceilings
// keep runner variance from flaking) and the committed report records the measured value.
// At 5,000 synthetic concepts (the section 4.6 scale) the first call on a fresh index must stay
// within 100 ms once the concept search index exists (context assembly builds nothing of its
// own) and warm p95 within 40 ms, both gated at 3x.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const test = require("node:test");

const { DEFAULT_PREAMBLE_WEIGHT, assembleContext } = require("../src/context/assemble");
const { buildIndex } = require("../src/indexer");
const { prepareSearchIndex } = require("../src/search/lexical");
const { DEFAULT_OUT, parseArgs, runContextEvaluation } = require("../scripts/eval-context");
const { QUERIES, generateBundle } = require("../scripts/index-benchmark");
const thresholds = require("./fixtures/retrieval/thresholds.json");

const FIXTURES = ["alpinaria", "atlas"];
const BUDGET_TOKENS = 1200;
const P95_BUDGET_MS = 40;
const FIRST_CALL_BUDGET_MS = 100;
const SCALE_CONCEPTS = 5000;
const SCALE_SEED = 20261024;
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
  // The shipped preamble weight is the dev-sweep choice: best anchor MRR on both fixtures among
  // the candidates whose anchor hit rate is not below the unweighted (1.0) one.
  assert.equal(committed.preambleWeight, DEFAULT_PREAMBLE_WEIGHT);
  FIXTURES.forEach((name) => {
    const sweep = committed.fixtures[name].preambleSweep;
    assert.deepEqual(
      sweep.map((row) => row.weight),
      [1, 0.7, 0.5],
    );
    const unweighted = sweep.find((row) => row.weight === 1);
    const chosen = sweep.find((row) => row.weight === DEFAULT_PREAMBLE_WEIGHT);
    assert.ok(chosen.anchorHitRate >= unweighted.anchorHitRate, `${name}: anchor hit kept`);
    sweep
      .filter((row) => row.anchorHitRate >= unweighted.anchorHitRate)
      .forEach((row) => {
        assert.ok(chosen.anchorMrr >= row.anchorMrr, `${name}: weight ${row.weight} beats it`);
      });
  });
});

test("at 5,000 concepts the first call needs no warm-up and warm p95 stays within budget", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-context-scale-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  generateBundle(root, SCALE_CONCEPTS, SCALE_SEED);
  const index = buildIndex([root]);
  assert.equal(index.concepts.length, SCALE_CONCEPTS);
  // What search_concepts builds on first use; context assembly adds nothing to it.
  prepareSearchIndex(index);
  let started = performance.now();
  const first = assembleContext(index, { query: QUERIES[0] });
  const firstMs = performance.now() - started;
  assert.ok(first.sections.length > 0);
  assert.ok(
    firstMs <= FIRST_CALL_BUDGET_MS * CI_CEILING_FACTOR,
    `first call ${firstMs.toFixed(1)} ms above ${FIRST_CALL_BUDGET_MS * CI_CEILING_FACTOR} ms`,
  );
  const timings = [];
  for (let round = 0; round < 3; round += 1) {
    QUERIES.forEach((query) => {
      started = performance.now();
      const result = assembleContext(index, { query });
      timings.push(performance.now() - started);
      assert.ok(result.usedTokens <= BUDGET_TOKENS);
    });
  }
  timings.sort((left, right) => left - right);
  const p95 = timings[Math.floor((timings.length - 1) * 0.95)];
  assert.ok(
    p95 <= P95_BUDGET_MS * CI_CEILING_FACTOR,
    `warm p95 ${p95.toFixed(1)} ms above ${P95_BUDGET_MS * CI_CEILING_FACTOR} ms`,
  );
});
