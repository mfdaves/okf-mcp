"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const { parseHybridArgs, runHybridEvaluation } = require("../scripts/eval-hybrid");
const { runEvaluation } = require("../scripts/eval-search");
const { buildProjectIndex } = require("../src/indexer");
const { openVectorCache } = require("../src/cache/store");
const { denseSearch } = require("../src/search/dense");
const { startFakeEmbeddingsServer, vectorFor } = require("./fake-embeddings-server");

// Offline plumbing of the hybrid harness against the fake OpenAI-compatible server: its
// vectors are hash-derived, so these tests check wiring and invariants, never quality.

const FIXTURE_PROJECT = path.join(__dirname, "fixtures", "retrieval", "atlas", "okf.project.yaml");
const DIMENSION = 16;

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function harness(t, extra) {
  const server = await startFakeEmbeddingsServer({ dimension: DIMENSION });
  t.after(() => server.close());
  const dir = tempDir(t, "okf-eval-hybrid-");
  const embedderFile = path.join(dir, "embedder.json");
  fs.writeFileSync(
    embedderFile,
    JSON.stringify({
      type: "openai",
      baseUrl: server.baseUrl,
      model: "fake-embed",
      dimensions: DIMENSION,
      batchSize: 256,
    }),
  );
  const run = (args) =>
    runHybridEvaluation(
      parseHybridArgs(
        [
          "--embedder",
          embedderFile,
          "--fixture",
          "atlas",
          "--bootstrap",
          "20",
          "--units",
          "concepts",
        ].concat(args || []),
      ),
      { env: { XDG_CACHE_HOME: path.join(dir, "xdg") } },
    );
  return { server, dir, embedderFile, run, ...(extra || {}) };
}

test("the hybrid harness scores a fused run and reports embedder, usage and latencies", async (t) => {
  const { server, run } = await harness(t);
  const report = await run(["--alpha", "0.5"]);
  const result = report.fixtures.atlas;
  const hybrid = report.hybrid.fixtures.atlas;
  assert.equal(hybrid.embedder.degraded, false);
  assert.equal(hybrid.embedder.remote, false);
  assert.equal(hybrid.embedder.dimension, DIMENSION);
  assert.equal(hybrid.documents.embedded, result.corpus.concepts);
  assert.equal(hybrid.documents.requests, 1);
  assert.equal(hybrid.queries.encoded, hybrid.queries.usage.requests);
  assert.equal(hybrid.queries.encoding.samples, hybrid.queries.encoded);
  assert.ok(hybrid.queries.encoding.p95Ms >= 0);
  assert.ok(result.latency.p95Ms >= 0, "search latency excludes encoding");
  assert.equal(server.requests.length, 1 + hybrid.queries.usage.requests);
  assert.equal(result.overall.zeroResultRate, 0);
  assert.ok(hybrid.comparison.byCategory.synonym, "per-category comparison");
  assert.ok(hybrid.lexical.categoryCi.synonym.halfWidth >= 0);
  assert.ok(!JSON.stringify(report).includes(`${path.sep}xdg`), "no cache path in the report");
});

test("alpha 0 reproduces the lexical run and alpha 1 the dense ranking", async (t) => {
  const { run, dir } = await harness(t);
  const lexical = runEvaluation({ fixtures: ["atlas"], split: "all", bootstrap: 20 });
  const zero = await run(["--alpha", "0"]);
  const rows = (report) => report.fixtures.atlas.perQuery.map((row) => row.top);
  assert.deepEqual(rows(zero), rows(lexical));
  assert.equal(zero.fixtures.atlas.overall.recallAt5, lexical.fixtures.atlas.overall.recallAt5);
  // Hybrid rows carry the v2 flag (WP3c-2), named in the summary; the counts agree here.
  const { rule, ...hybridFlags } = zero.fixtures.atlas.noAnswer.lowConfidence;
  const { rule: lexicalRule, ...lexicalFlags } = lexical.fixtures.atlas.noAnswer.lowConfidence;
  assert.deepEqual(hybridFlags, lexicalFlags);
  assert.match(rule, /topSimilarity < minSimilarity/);
  assert.equal(lexicalRule, 'mode === "any" && top1.coverage < 0.5');

  const one = await run(["--alpha", "1"]);
  // The dense ranking straight from the cache the harness filled.
  const index = buildProjectIndex(FIXTURE_PROJECT);
  const status = one.hybrid.fixtures.atlas.embedder;
  const { resolveCacheDir } = require("../src/cache/store");
  const cache = openVectorCache(
    resolveCacheDir({
      root: path.dirname(FIXTURE_PROJECT),
      env: { XDG_CACHE_HOME: path.join(dir, "xdg") },
    }),
    { embedderId: status.id, dimension: status.dimension },
  );
  one.fixtures.atlas.perQuery.slice(0, 15).forEach((row) => {
    const expected = denseSearch(index, {
      queryVector: vectorFor(row.query === undefined ? "" : row.query, DIMENSION),
      cache,
      limit: 10,
    }).map((entry) => entry.id);
    assert.deepEqual(row.top, expected, row.id);
  });
});

test("the harness reuses the vector cache across runs and sweeps alpha on dev only", async (t) => {
  const { server, run } = await harness(t);
  await run(["--alpha", "0.3"]);
  const before = server.requests.length;
  const second = await run(["--split", "dev", "--alpha-sweep", "0,0.5,1"]);
  const hybrid = second.hybrid.fixtures.atlas;
  assert.equal(hybrid.documents.embedded, 0, "documents come from the cache");
  assert.equal(hybrid.documents.requests, 0);
  assert.equal(server.requests.length - before, hybrid.queries.usage.requests);
  assert.deepEqual(
    hybrid.sweep.map((row) => row.alpha),
    [0, 0.5, 1],
  );
  assert.ok(hybrid.sweep.every((row) => typeof row.byCategory.synonym === "number"));
  assert.throws(
    () => parseHybridArgs(["--embedder", "x.json", "--fixture", "atlas", "--alpha-sweep", "0,1"]),
    /dev split only/,
  );
});

test("an unreachable embedder degrades the harness to the lexical run", async (t) => {
  const dir = tempDir(t, "okf-eval-hybrid-down-");
  const embedderFile = path.join(dir, "embedder.json");
  // Port 9 (discard) on loopback: nothing listens, the probe fails fast.
  fs.writeFileSync(
    embedderFile,
    JSON.stringify({
      type: "openai",
      baseUrl: "http://127.0.0.1:9",
      model: "m",
      maxRetries: 0,
      timeoutMs: 2000,
    }),
  );
  const report = await runHybridEvaluation(
    parseHybridArgs(["--embedder", embedderFile, "--fixture", "atlas", "--bootstrap", "20"]),
    { env: { XDG_CACHE_HOME: path.join(dir, "xdg") } },
  );
  const hybrid = report.hybrid.fixtures.atlas;
  assert.equal(hybrid.embedder.degraded, true);
  assert.equal(hybrid.embedder.code, "embedder_network_error");
  assert.equal(hybrid.queries.encoded, 0);
  const lexical = runEvaluation({ fixtures: ["atlas"], split: "all", bootstrap: 20 });
  assert.equal(report.fixtures.atlas.overall.recallAt5, lexical.fixtures.atlas.overall.recallAt5);
});

test("node scripts/eval-search.js --embedder runs the hybrid harness end to end", async (t) => {
  const { dir, embedderFile } = await harness(t);
  const out = path.join(dir, "report");
  const args = [
    path.join(__dirname, "..", "scripts", "eval-search.js"),
    "--embedder",
    embedderFile,
    "--fixture",
    "atlas",
    "--split",
    "dev",
    "--units",
    "concepts",
    "--bootstrap",
    "10",
    "--out",
    out,
  ];
  // Asynchronous on purpose: the fake server answers from this process.
  const { stdout } = await promisify(childProcess.execFile)(process.execPath, args, {
    env: { ...process.env, XDG_CACHE_HOME: path.join(dir, "xdg-cli") },
  });
  const summary = JSON.parse(stdout);
  assert.equal(summary.fixtures.atlas.embedder.degraded, false);
  assert.equal(summary.fixtures.atlas.documents.requests, 1);
  assert.match(fs.readFileSync(`${out}.md`, "utf8"), /## Hybrid run/);
  assert.ok(JSON.parse(fs.readFileSync(`${out}.json`, "utf8")).hybrid.fixtures.atlas);
});

test("the harness scores the adaptive weight, its dev grid and a paired baseline", async (t) => {
  const { run, dir } = await harness(t);
  const fixed = await run(["--alpha", "0.4"]);
  const baselineFile = path.join(dir, "baseline.json");
  fs.writeFileSync(baselineFile, JSON.stringify(fixed));
  const adaptive = await run([
    "--alpha",
    "adaptive",
    "--adaptive",
    "0.1,0.3,0.8",
    "--baseline",
    baselineFile,
  ]);
  assert.equal(adaptive.hybrid.alpha, "adaptive");
  assert.deepEqual(adaptive.hybrid.adaptive, { low: 0.1, mid: 0.3, high: 0.8 });
  const rows = adaptive.fixtures.atlas.perQuery;
  assert.ok(rows.every((row) => typeof row.alphaUsed === "number" && row.alphaReason));
  assert.ok(rows.some((row) => row.alphaReason !== "all_terms"));
  const paired = adaptive.hybrid.fixtures.atlas.paired;
  assert.equal(paired.overall.queries, fixed.fixtures.atlas.queries.answerable);
  assert.ok(Math.abs(paired.overall.baseline - fixed.fixtures.atlas.overall.recallAt5) < 1e-12);
  assert.ok(Math.abs(paired.overall.current - adaptive.fixtures.atlas.overall.recallAt5) < 1e-12);
  assert.ok(
    paired.overall.low <= paired.overall.delta && paired.overall.delta <= paired.overall.high,
  );
  Object.values(paired.byCategory).forEach((value) => {
    assert.equal(value.regressed, value.high < 0);
  });
  // A run paired with itself differs by exactly zero everywhere.
  const self = await run(["--alpha", "0.4", "--baseline", baselineFile]);
  assert.deepEqual(
    [self.hybrid.fixtures.atlas.paired.overall.low, self.hybrid.fixtures.atlas.paired.overall.high],
    [0, 0],
  );
  const grid = await run(["--split", "dev", "--adaptive-grid", "0.1,0.2/0.4/0.4,0.8"]);
  assert.deepEqual(
    grid.hybrid.grid.rows.map((row) => [row.low, row.mid, row.high]),
    [
      [0.1, 0.4, 0.4],
      [0.1, 0.4, 0.8],
      [0.2, 0.4, 0.4],
      [0.2, 0.4, 0.8],
    ],
  );
  assert.ok(grid.hybrid.grid.choice, "a choice is named");
  assert.throws(
    () =>
      parseHybridArgs([
        "--embedder",
        "x.json",
        "--fixture",
        "atlas",
        "--adaptive-grid",
        "0.1/0.4/0.8",
      ]),
    /dev split only/,
  );
  assert.throws(
    () =>
      parseHybridArgs(["--embedder", "x.json", "--fixture", "atlas", "--adaptive", "0.1,0.9,0.5"]),
    /high >= mid/,
  );
});
