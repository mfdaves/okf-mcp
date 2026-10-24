"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildProjectIndex } = require("../src/indexer");
const {
  DEFAULT_FUSION_ALPHA,
  DEFAULT_FUSION_NORMALIZATION,
  FUSION_NORMALIZATIONS,
} = require("../src/search/fusion");
const { openEmbeddingRuntime } = require("../src/search/hybrid");
const { searchConcepts } = require("../src/search/query");
const { startFakeEmbeddingsServer } = require("./fake-embeddings-server");

// WP3c acceptance, offline part only (docs/plan-1.0.md WP3c). The quality numbers come from a
// live endpoint and are recorded in the committed report; this file never gates on them. It
// gates the plumbing every live number depends on, against the fake OpenAI-compatible server,
// and the shape and hygiene of the committed report.

const RETRIEVAL = path.join(__dirname, "fixtures", "retrieval");
const REPORT = path.join(RETRIEVAL, "reports", "hybrid-0.11-2026-10-24");

function copyFixture(t, name) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `okf-hybrid-accept-${name}-`));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.cpSync(path.join(RETRIEVAL, name), target, { recursive: true });
  return target;
}

async function fixtureRuntime(t, name) {
  const server = await startFakeEmbeddingsServer({ dimension: 32 });
  t.after(() => server.close());
  const root = copyFixture(t, name);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "okf-hybrid-accept-cache-"));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const runtime = await openEmbeddingRuntime(
    {
      embedder: { baseUrl: server.baseUrl, model: "fake", dimensions: 32, batchSize: 512 },
      cacheDir,
    },
    { root },
  );
  const project = path.join(root, "okf.project.yaml");
  return { server, root, project, runtime, index: buildProjectIndex(project) };
}

for (const name of ["alpinaria", "atlas"]) {
  test(`${name}: the cache fills in one request and hybrid search runs on every query`, async (t) => {
    const { server, runtime, index } = await fixtureRuntime(t, name);
    const receipt = await runtime.sync(index);
    assert.equal(receipt.embedded, index.concepts.length);
    assert.equal(receipt.requests, 1);
    assert.equal(server.requests.length, 1);
    const { queries } = JSON.parse(fs.readFileSync(path.join(RETRIEVAL, name, "queries.json")));
    let hybrid = 0;
    for (const query of queries.slice(0, 40)) {
      const response = await runtime.search(index, { query: query.query, limit: 10 });
      const lexical = searchConcepts(index, { query: query.query, limit: 10 });
      if (response.hybrid) hybrid += 1;
      assert.equal(response.embedder.degraded, false);
      assert.equal(response.mode, lexical.mode, "mode keeps its lexical meaning");
      // lowConfidence reads the displayed top result.
      const top = response.results[0];
      assert.equal(
        response.lowConfidence,
        response.mode === "any" && Boolean(top) && top.coverage < 0.5,
      );
      assert.equal(response.alpha, DEFAULT_FUSION_ALPHA);
    }
    assert.equal(hybrid, 40);
    const again = await runtime.sync(index);
    assert.equal(again.requests, 0, "a second preparation reuses the cache");
  });
}

test("an incremental embed after a 5-concept batch issues one request", async (t) => {
  const { server, runtime, index, root, project } = await fixtureRuntime(t, "alpinaria");
  await runtime.sync(index);
  const before = server.requests.length;
  const bundle = path.join(root, "bundles", "alpinaria");
  const files = fs
    .readdirSync(bundle, { recursive: true })
    .filter((file) => String(file).endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(file))
    .slice(0, 5);
  assert.equal(files.length, 5);
  files.forEach((file) => {
    fs.appendFileSync(path.join(bundle, file), "\nAppended by the acceptance test.\n");
  });
  const receipt = await runtime.embedChanged(index, buildProjectIndex(project));
  assert.equal(server.requests.length - before, 1);
  assert.equal(receipt.units, 5);
  assert.equal(receipt.embedded, 5);
  assert.equal(receipt.usage.requests, 1);
});

test("the committed hybrid report records its model, alpha and usage, and no secret", () => {
  const json = fs.readFileSync(`${REPORT}.json`, "utf8");
  const markdown = fs.readFileSync(`${REPORT}.md`, "utf8");
  const report = JSON.parse(json);
  for (const text of [json, markdown]) {
    assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(text), "no API key");
    assert.ok(!/https?:\/\/[^\s/"]*@/.test(text), "no URL with credentials");
    assert.ok(!text.includes(os.tmpdir()), "no temporary cache path");
  }
  assert.equal(report.hybrid.alpha, DEFAULT_FUSION_ALPHA, "the default is the measured choice");
  for (const name of ["alpinaria", "atlas"]) {
    const entry = report.hybrid.fixtures[name];
    assert.match(
      entry.embedder.id,
      /^openai:https:\/\/api\.openai\.com\/v1\/embeddings:text-embedding-3-small:512:/,
    );
    assert.equal(entry.embedder.degraded, false);
    assert.ok(report.fixtures[name].bySplit.dev && report.fixtures[name].bySplit.heldout);
    assert.ok(Number.isFinite(entry.queries.usage.promptTokens));
  }
  assert.ok(report.measurement.preregistration.length > 0);
  // The defaults are the recorded dev-sweep choice: the best mean dev Recall@5 over every grid,
  // ties within 0.005 broken by mean nDCG@10, then by the smaller alpha.
  const rows = report.measurement.sweep.flatMap((grid) =>
    grid.rows.map((row) => Object.assign({ normalization: grid.normalization }, row)),
  );
  assert.deepEqual(
    report.measurement.sweep.map((grid) => grid.normalization).sort(),
    FUSION_NORMALIZATIONS.slice().sort(),
  );
  const best = Math.max(...rows.map((row) => row.meanRecallAt5));
  const [choice] = rows
    .filter((row) => row.meanRecallAt5 >= best - 0.005)
    .sort((a, b) => b.meanNdcgAt10 - a.meanNdcgAt10 || a.alpha - b.alpha);
  assert.equal(choice.alpha, DEFAULT_FUSION_ALPHA);
  assert.equal(choice.normalization, DEFAULT_FUSION_NORMALIZATION);
  assert.equal(report.hybrid.normalization, DEFAULT_FUSION_NORMALIZATION);
});
