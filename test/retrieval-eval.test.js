"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  LOW_CONFIDENCE_COVERAGE,
  NDCG_CUTOFF,
  evaluateQuery,
  runEvaluation,
} = require("../scripts/eval-search");
const thresholds = require("./fixtures/retrieval/thresholds.json");

const FIXTURES = ["alpinaria", "atlas"];
// Floors are the measured baseline minus its bootstrap half-width (thresholds.json `baseline`).
const FLOOR_METRICS = ["recallAt5", "mustRecallAt5", "ndcgAt10", "mrrAt10", "p1"];
// Section 8: a fixture with at least 150 queries is also gated on its held-out split.
const HELDOUT_GATE_MIN_QUERIES = 150;
const ORACLE_CONTEXT = { limit: 10, asOf: "2026-10-24" };

function assertInterval(interval, label) {
  assert.ok(
    Number.isFinite(interval.low) && Number.isFinite(interval.high),
    `${label} bounds are finite`,
  );
  assert.ok(interval.low <= interval.high, `${label} bounds are ordered`);
  assert.ok(interval.halfWidth >= 0, `${label} half-width is non-negative`);
}

function oracleIndex(uris) {
  return { byUri: new Map(uris.map((uri) => [uri, { uri }])) };
}

function moduleReturning(results) {
  return { search: () => ({ results, total: results.length }) };
}

function oracleQuery(expected) {
  return {
    id: "oracle",
    query: "oracle",
    lang: "en",
    category: "keyword",
    split: "dev",
    expected,
    distractors: [],
  };
}

test("the shipped search meets the pre-registered baseline floors on both fixtures (--split all)", () => {
  const report = runEvaluation({ fixtures: FIXTURES, split: "all", bootstrap: 1000 });
  FIXTURES.forEach((name) => {
    const result = report.fixtures[name];
    const baseline = thresholds[name].baseline;
    assert.equal(result.corpus.validForProject, true, `${name} index is not valid for project`);
    assert.equal(
      result.queries.expectedMissingFromIndex.length,
      0,
      `${name} references concepts missing from the index`,
    );
    FLOOR_METRICS.forEach((metric) => {
      assert.ok(
        result.overall[metric] >= baseline[metric],
        `${name} ${metric} ${result.overall[metric].toFixed(4)} is below the baseline floor ${baseline[metric]}`,
      );
    });
    assert.ok(
      result.overall.zeroResultRate <= baseline.zeroResultRateMax,
      `${name} zero-result rate ${result.overall.zeroResultRate.toFixed(4)} is above ${baseline.zeroResultRateMax}`,
    );
    // Held-out gate: a module that aces dev and fails held-out must not pass (section 8).
    if (result.queries.total >= HELDOUT_GATE_MIN_QUERIES) {
      assert.ok(
        baseline.bySplit?.heldout,
        `${name} has ${result.queries.total} queries and needs pre-registered held-out floors`,
      );
      FLOOR_METRICS.forEach((metric) => {
        assert.ok(
          result.bySplit.heldout[metric] >= baseline.bySplit.heldout[metric],
          `${name} held-out ${metric} ${result.bySplit.heldout[metric].toFixed(4)} is below the held-out floor ${baseline.bySplit.heldout[metric]}`,
        );
      });
    }
    // The report carries what the plan's gates read: CIs, breakdowns, no-answer handling, latency, RSS.
    assertInterval(result.overall.ci.recallAt5, `${name} overall Recall@5 CI`);
    assertInterval(result.overall.ci.ndcgAt10, `${name} overall nDCG@10 CI`);
    assert.ok(Object.keys(result.byCategory).length >= 5 && Object.keys(result.byLang).length >= 2);
    assert.ok(result.bySplit.dev && result.bySplit.heldout);
    assertInterval(result.bySplit.heldout.ci.recallAt5, `${name} held-out Recall@5 CI`);
    assertInterval(result.bySplit.dev.ci.ndcgAt10, `${name} dev nDCG@10 CI`);
    assert.ok(result.noAnswer.queries >= 8);
    assert.ok(typeof result.noAnswer.lowConfidence.available === "boolean");
    // R-4 (plan revision 5): when the module reports the flag, at most the pre-registered
    // share of answerable queries with a relevant top-1 may carry it.
    const flagShareMax = thresholds[name].target.lowConfidenceAnswerableTop1HitShareMax;
    if (flagShareMax !== undefined && result.noAnswer.lowConfidence.available) {
      const share =
        result.noAnswer.lowConfidence.flaggedAnswerableTop1Hits / result.queries.answerable;
      assert.ok(
        share <= flagShareMax,
        `${name} flags ${(share * 100).toFixed(1)}% of answerable queries with a relevant top-1 (max ${flagShareMax * 100}%)`,
      );
    }
    assert.ok(
      result.latency.p95Ms >= 0 && result.build.okfIndexMs > 0 && result.build.rssEndMb > 0,
    );
  });
  // Targets are recorded for later work packages and must stay pre-registered, never tuned here.
  assert.equal(thresholds.alpinaria.target.recallAt5, 0.72);
  assert.equal(thresholds.alpinaria.target.ndcgAt10, 0.78);
  assert.equal(thresholds.alpinaria.target.lowConfidenceNoAnswerRecall, 0.5);
  assert.equal(thresholds.alpinaria.target.lowConfidenceAnswerableTop1HitShareMax, 0.03);
  assert.equal(thresholds.atlas.target.recallAt5, 0.7);
});

test("the harness honours --split and picks up mode and coverage from a search module", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "okf-eval-stub-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A stub that answers every query with one fixed concept in "any" mode. Coverage is exactly
  // 0.5 for queries containing "SPID" (not flagged: the rule is strictly below) and 0.3 otherwise.
  const stub = path.join(dir, "stub-search.js");
  fs.writeFileSync(
    stub,
    [
      '"use strict";',
      "module.exports = {",
      '  name: "stub",',
      "  searchConcepts(index, options) {",
      "    const coverage = /SPID/.test(options.query) ? 0.5 : 0.3;",
      '    const doc = index.concepts.find((concept) => concept.uri === "okf://atlas/services/identity-service");',
      '    return { mode: "any", total: 1, results: [{ uri: doc.uri, score: 1, coverage, relevance: 1 }] };',
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  const report = runEvaluation({
    fixtures: ["atlas"],
    split: "dev",
    searchModule: stub,
    bootstrap: 20,
  });
  const result = report.fixtures.atlas;
  const all = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "retrieval", "atlas", "queries.json"), "utf8"),
  ).queries;
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
  spid.forEach((entry) => {
    assert.equal(
      entry.lowConfidence,
      false,
      `${entry.id}: coverage exactly 0.5 must not be flagged`,
    );
  });
  assert.equal(
    lc.flaggedAnswerable,
    result.perQuery.filter((entry) => entry.answerable && !/SPID/.test(entry.query)).length,
  );
});

test("nDCG@10 oracle: a perfect ranking scores exactly 1 whatever the --limit", () => {
  assert.equal(NDCG_CUTOFF, 10);
  // Four relevant concepts: perfect for limits 5, 10 and 12 alike.
  const few = [2, 2, 1, 1].map((grade, index) => ({ bundle: "oracle", id: `few-${index}`, grade }));
  const fewUris = few.map((entry) => `okf://${entry.bundle}/${entry.id}`);
  [5, 10, 12].forEach((limit) => {
    const result = evaluateQuery(
      oracleIndex(fewUris),
      moduleReturning(fewUris.map((uri) => ({ uri, score: 1 }))),
      oracleQuery(few),
      { limit, asOf: ORACLE_CONTEXT.asOf },
    );
    assert.equal(result.ndcgAt10, 1, `limit ${limit}`);
    assert.equal(result.mrrAt10, 1);
    assert.equal(result.p1, 1);
    assert.equal(result.recallAt5, 1);
  });
  // Twelve relevant concepts: a perfect top-10 is still 1 at --limit 12 (IDCG uses ten grades,
  // not the limit) and at --limit 10.
  const many = Array.from({ length: 12 }, (_, index) => ({
    bundle: "oracle",
    id: `many-${index}`,
    grade: index < 7 ? 2 : 1,
  }));
  const manyUris = many.map((entry) => `okf://${entry.bundle}/${entry.id}`);
  [10, 12].forEach((limit) => {
    const result = evaluateQuery(
      oracleIndex(manyUris),
      moduleReturning(manyUris.map((uri) => ({ uri, score: 1 }))),
      oracleQuery(many),
      { limit, asOf: ORACLE_CONTEXT.asOf },
    );
    assert.equal(result.ndcgAt10, 1, `limit ${limit}`);
    assert.equal(result.recallAt5, 5 / 12);
  });
});

test("duplicate result URIs never push any metric above 1", () => {
  const expected = [{ bundle: "oracle", id: "only", grade: 2 }];
  const uri = "okf://oracle/only";
  const duplicated = Array.from({ length: 10 }, () => ({ uri, score: 1 }));
  const result = evaluateQuery(
    oracleIndex([uri]),
    moduleReturning(duplicated),
    oracleQuery(expected),
    ORACLE_CONTEXT,
  );
  assert.equal(result.returned, 1);
  assert.deepEqual(result.top, [uri]);
  ["recallAt5", "mustRecallAt5", "ndcgAt10", "mrrAt10", "p1", "hitAt10"].forEach((metric) => {
    assert.ok(result[metric] <= 1, `${metric} ${result[metric]} exceeds 1`);
    assert.equal(result[metric], 1, `${metric} of the sole relevant concept`);
  });
  // Duplicates of an irrelevant concept ahead of the relevant one count once in the ranks.
  const noise = Array.from({ length: 3 }, () => ({ uri: "okf://oracle/noise", score: 2 }));
  const mixed = evaluateQuery(
    oracleIndex([uri, "okf://oracle/noise"]),
    moduleReturning(noise.concat([{ uri, score: 1 }])),
    oracleQuery(expected),
    ORACLE_CONTEXT,
  );
  assert.equal(mixed.returned, 2);
  assert.equal(mixed.firstRelevantRank, 2);
  assert.equal(mixed.mrrAt10, 0.5);
  assert.ok(mixed.ndcgAt10 < 1 && mixed.ndcgAt10 > 0);
});
