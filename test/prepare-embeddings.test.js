"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { openVectorCache, resolveCacheDir } = require("../src/cache/store");
const { createOpenAiEmbedder } = require("../src/embed/openai");
const { prepareEmbeddings } = require("../src/embed/prepare");
const { conceptUnits, hashUnitText } = require("../src/embed/units");
const { buildIndex, buildProjectIndex } = require("../src/indexer");
const { LiveAuthoringService } = require("../src/live-authoring");
const { FileConceptStore } = require("../src/store");
const { startFakeEmbeddingsServer, vectorFor } = require("./fake-embeddings-server");

const FIXTURE = path.join(__dirname, "fixtures", "retrieval", "alpinaria");
const KEY = "sk-test-0123456789abcdefghijklmnop";
const BATCH_SIZE = 50;

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function fakeSetup(t, overrides) {
  const server = await startFakeEmbeddingsServer({ apiKey: KEY, dimension: 16 });
  t.after(() => server.close());
  const embedder = createOpenAiEmbedder({
    baseUrl: server.baseUrl,
    model: "fake-embed",
    apiKeyEnv: "OKF_TEST_EMBED_KEY",
    env: { OKF_TEST_EMBED_KEY: KEY },
    dimensions: 16,
    batchSize: BATCH_SIZE,
    concurrency: 2,
    ...(overrides || {}),
  });
  return { server, embedder };
}

// A deterministic in-process embedder: proves the interface is enough and
// keeps the git test free of sockets.
function memoryEmbedder(dimension) {
  let calls = 0;
  return {
    id: `memory:test:${dimension}`,
    dimension,
    languages: ["en", "it"],
    remote: false,
    maxBatch: 8,
    maxInputChars: 1000,
    async embed(texts) {
      calls += 1;
      return texts.map((text) => vectorFor(text, dimension));
    },
    calls: () => calls,
  };
}

function git(repository, args) {
  const result = spawnSync("git", ["-C", repository].concat(args), { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function write(root, relativePath, text) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
}

function makeGitRoot(t) {
  const root = tempDir(t, "okf-embed-git-");
  write(
    root,
    "index.md",
    ["---", 'okf_version: "0.2"', "---", "", "# Test catalog", "", "- [Alpha](alpha.md)", ""].join(
      "\n",
    ),
  );
  write(
    root,
    "alpha.md",
    [
      "---",
      "type: Reference",
      "title: Alpha",
      "description: Existing concept",
      "---",
      "",
      "# Alpha",
      "",
    ].join("\n"),
  );
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "OKF Test"]);
  git(root, ["config", "user.email", "okf@example.invalid"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return fs.realpathSync(root);
}

test("prepares the alpinaria fixture with the minimum requests and re-embeds only the edited concept", async (t) => {
  const work = tempDir(t, "okf-embed-prepare-");
  const fixture = path.join(work, "alpinaria");
  fs.cpSync(FIXTURE, fixture, { recursive: true });
  const projectPath = path.join(fixture, "okf.project.yaml");
  const { server, embedder } = await fakeSetup(t);
  const cache = openVectorCache(path.join(work, "cache"), {
    embedderId: embedder.id,
    dimension: 16,
  });

  const index = buildProjectIndex(projectPath);
  const concepts = index.documents.filter((doc) => doc.kind === "concept").length;
  assert.ok(concepts > 200, "fixture has a meaningful number of concepts");
  const progress = [];
  const first = await prepareEmbeddings(index, embedder, cache, {
    onProgress: (event) => progress.push(event),
  });
  const expectedRequests = Math.ceil(concepts / BATCH_SIZE);
  assert.equal(first.units, concepts);
  assert.equal(first.embedded, concepts);
  assert.equal(first.reused, 0);
  assert.equal(first.deduplicated, 0);
  assert.equal(first.pruned, 0);
  assert.equal(first.requests, expectedRequests);
  assert.equal(server.requests.length, expectedRequests);
  assert.equal(first.usage.requests, expectedRequests);
  assert.equal(first.usage.retries, 0);
  assert.ok(first.usage.promptTokens > 0);
  assert.deepEqual(first.embedder, { id: embedder.id, remote: false, dimension: 16 });
  assert.deepEqual(first.cache, {
    dir: path.join(work, "cache"),
    rows: concepts,
    rebuilt: true,
    reason: "missing",
  });
  assert.ok(first.durationMs >= 0);
  // One event per persisted batch of at most maxBatch units, in completion order.
  assert.equal(progress.length, Math.ceil(concepts / BATCH_SIZE));
  assert.deepEqual(progress.at(-1), { embedded: concepts, total: concepts, units: concepts });
  progress.forEach((event, position) => {
    assert.ok(position === 0 || event.embedded > progress[position - 1].embedded);
    assert.equal(event.total, concepts);
  });
  assert.equal(cache.size, concepts);
  for (const unit of conceptUnits(index)) {
    assert.deepEqual(Array.from(cache.get(unit.hash)), Array.from(vectorFor(unit.text, 16)));
  }

  const second = await prepareEmbeddings(buildProjectIndex(projectPath), embedder, cache);
  assert.equal(second.requests, 0);
  assert.equal(second.embedded, 0);
  assert.equal(second.reused, concepts);
  assert.equal(second.pruned, 0);
  assert.equal(server.requests.length, expectedRequests);

  const target = path.join(fixture, "bundles", "alpinaria", "audiences", "trail-runner.md");
  const before = conceptUnits(index).find(
    (unit) => unit.id === "okf://alpinaria/audiences/trail-runner",
  );
  fs.appendFileSync(target, "\nSezione aggiunta per cambiare il testo.\n");
  const edited = buildProjectIndex(projectPath);
  const after = conceptUnits(edited).find(
    (unit) => unit.id === "okf://alpinaria/audiences/trail-runner",
  );
  assert.notEqual(after.hash, before.hash);
  const third = await prepareEmbeddings(edited, embedder, cache);
  assert.equal(third.requests, 1);
  assert.equal(third.embedded, 1);
  assert.equal(third.reused, concepts - 1);
  assert.equal(third.pruned, 1);
  assert.equal(server.requests.length, expectedRequests + 1);
  assert.deepEqual(server.requests.at(-1).body.input, [after.text]);
  assert.equal(cache.has(before.hash), false);
  assert.deepEqual(Array.from(cache.get(after.hash)), Array.from(vectorFor(after.text, 16)));
  assert.equal(cache.size, concepts);
  const reopened = openVectorCache(path.join(work, "cache"), {
    embedderId: embedder.id,
    dimension: 16,
  });
  assert.deepEqual(reopened.opened, { rebuilt: false, reason: null, rows: concepts });
});

test("accepts a pluggable unit function, deduplicates identical text, and persists per chunk", async (t) => {
  const work = tempDir(t, "okf-embed-prepare-");
  const embedder = memoryEmbedder(6);
  const cache = openVectorCache(path.join(work, "cache"), {
    embedderId: embedder.id,
    dimension: 6,
  });
  const sections = (count) =>
    Array.from({ length: count }, (_, position) => {
      const text = `Section ${position % 10}`;
      return { id: `okf://b/c#s${position}`, text, hash: hashUnitText(text) };
    });
  const receipt = await prepareEmbeddings({}, embedder, cache, { units: () => sections(20) });
  assert.equal(receipt.units, 20);
  assert.equal(receipt.embedded, 10);
  assert.equal(receipt.deduplicated, 10);
  assert.equal(receipt.reused, 0);
  assert.equal(receipt.requests, 2);
  assert.equal(embedder.calls(), 2);
  assert.equal(receipt.usage, null);
  assert.deepEqual(receipt.embedder, { id: "memory:test:6", remote: false, dimension: 6 });
  assert.equal(cache.size, 10);

  const shrunk = await prepareEmbeddings({}, embedder, cache, { units: () => sections(3) });
  assert.deepEqual(
    [shrunk.units, shrunk.embedded, shrunk.reused, shrunk.pruned, shrunk.requests],
    [3, 0, 3, 7, 0],
  );
  assert.equal(cache.size, 3);
  assert.deepEqual(
    cache.all().map((row) => row.id),
    ["okf://b/c#s0", "okf://b/c#s1", "okf://b/c#s2"],
  );
});

test("refuses a mismatched cache, an invalid embedder, and malformed units", async (t) => {
  const work = tempDir(t, "okf-embed-prepare-");
  const embedder = memoryEmbedder(6);
  const other = openVectorCache(path.join(work, "other"), {
    embedderId: "memory:other:6",
    dimension: 6,
  });
  await assert.rejects(
    prepareEmbeddings({}, embedder, other),
    (error) => error.code === "cache_mismatch",
  );
  const narrow = openVectorCache(path.join(work, "narrow"), {
    embedderId: embedder.id,
    dimension: 5,
  });
  await assert.rejects(
    prepareEmbeddings({}, embedder, narrow),
    (error) => error.code === "cache_mismatch",
  );
  const cache = openVectorCache(path.join(work, "cache"), {
    embedderId: embedder.id,
    dimension: 6,
  });
  await assert.rejects(
    prepareEmbeddings({}, { ...embedder, remote: "yes" }, cache),
    (error) => error.code === "invalid_embedder" && error.details.field === "remote",
  );
  await assert.rejects(
    prepareEmbeddings({}, embedder, null),
    (error) => error.code === "invalid_cache",
  );
  await assert.rejects(
    prepareEmbeddings({}, embedder, cache, {
      units: () => [{ id: "x", text: "t", hash: "short" }],
    }),
    (error) => error.code === "invalid_units" && error.details.position === 0,
  );
  await assert.rejects(
    prepareEmbeddings({}, embedder, cache, { units: () => "nope" }),
    (error) => error.code === "invalid_units",
  );
  const lying = {
    ...embedder,
    embed: async (texts) => texts.slice(1).map(() => vectorFor("x", 6)),
  };
  await assert.rejects(
    prepareEmbeddings({ documents: [] }, lying, cache, {
      units: () => [{ id: "a", text: "a", hash: hashUnitText("a") }],
    }),
    (error) => error.code === "embedder_bad_output",
  );
  assert.equal(cache.size, 0);
});

test("a populated cache outside the root leaves git-backed apply free to commit", async (t) => {
  const root = makeGitRoot(t);
  const cacheHome = tempDir(t, "okf-embed-cache-home-");
  const dir = resolveCacheDir({ root, env: { XDG_CACHE_HOME: cacheHome } });
  assert.ok(path.relative(root, dir).startsWith(".."));
  const embedder = memoryEmbedder(6);
  const cache = openVectorCache(dir, { embedderId: embedder.id, dimension: 6 });
  const first = await prepareEmbeddings(buildIndex([{ id: "catalog", root }]), embedder, cache);
  assert.equal(first.embedded, 1);
  assert.ok(fs.readdirSync(dir).some((name) => /^vectors\.[0-9a-z-]+\.f32$/.test(name)));
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), "");

  const service = new LiveAuthoringService(FileConceptStore.fromRoot(root), {
    actor: "process:embed-test",
    gitCommit: true,
    now: () => new Date("2026-10-24T12:00:00.000Z"),
  });
  const applied = await service.applyChanges({
    message: "docs(okf): add beta",
    changes: [
      { op: "create", path: "beta.md", type: "Reference", title: "Beta", description: "New" },
    ],
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.git.committed, true);
  assert.equal(git(root, ["log", "-1", "--pretty=%s"]), "docs(okf): add beta");

  const second = await prepareEmbeddings(buildIndex([{ id: "catalog", root }]), embedder, cache);
  assert.deepEqual([second.units, second.embedded, second.reused, second.pruned], [2, 1, 1, 0]);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), "");

  // The same cache inside the root is exactly what blocks the commit.
  const inside = openVectorCache(
    resolveCacheDir({ root, cacheDir: ".okf-vectors", allowInsideRoot: true }),
    {
      embedderId: embedder.id,
      dimension: 6,
    },
  );
  await prepareEmbeddings(buildIndex([{ id: "catalog", root }]), embedder, inside);
  await assert.rejects(
    service.applyChanges({
      changes: [{ op: "create", path: "gamma.md", type: "Reference", title: "Gamma" }],
    }),
    /worktree must be completely clean/,
  );
  assert.equal(fs.existsSync(path.join(root, "gamma.md")), false);
});

test("calls embed() with at most maxBatch units and at most concurrency calls in flight", async (t) => {
  const work = tempDir(t, "okf-embed-prepare-");
  let inFlight = 0;
  let maxInFlight = 0;
  const sizes = [];
  const strict = {
    id: "strict:test:4",
    dimension: 4,
    languages: [],
    remote: false,
    maxBatch: 8,
    maxInputChars: 1000,
    concurrency: 3,
    async embed(texts) {
      if (texts.length > 8) throw new Error(`a conforming embedder rejects ${texts.length} inputs`);
      sizes.push(texts.length);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return texts.map((text) => vectorFor(text, 4));
    },
  };
  const units = Array.from({ length: 30 }, (_, position) => {
    const text = `unit ${position}`;
    return { id: `okf://b/${position}`, text, hash: hashUnitText(text) };
  });
  const cache = openVectorCache(path.join(work, "cache"), { embedderId: strict.id, dimension: 4 });
  const progress = [];
  const receipt = await prepareEmbeddings({}, strict, cache, {
    units: () => units,
    onProgress: (event) => progress.push(event.embedded),
  });
  assert.deepEqual([receipt.units, receipt.embedded, receipt.requests], [30, 30, 4]);
  assert.deepEqual(
    sizes.sort((left, right) => left - right),
    [6, 8, 8, 8],
  );
  assert.equal(maxInFlight, 3);
  assert.equal(progress.length, 4);
  assert.equal(progress.at(-1), 30);
  assert.equal(cache.size, 30);

  // A failing call stops further calls, keeps the batches already persisted,
  // and surfaces the error.
  let calls = 0;
  const flaky = {
    ...strict,
    concurrency: 1,
    async embed(texts) {
      calls += 1;
      if (calls === 2) throw new Error("boom");
      return texts.map((text) => vectorFor(text, 4));
    },
  };
  const other = openVectorCache(path.join(work, "flaky"), { embedderId: strict.id, dimension: 4 });
  await assert.rejects(prepareEmbeddings({}, flaky, other, { units: () => units }), /boom/);
  assert.equal(calls, 2);
  assert.equal(other.size, 8);
});

test("keeps the requests in flight at the prepare concurrency when calls split into requests", async (t) => {
  const work = tempDir(t, "okf-embed-prepare-");
  const server = await startFakeEmbeddingsServer({ apiKey: KEY, dimension: 4, delayMs: 20 });
  t.after(() => server.close());
  const embedder = createOpenAiEmbedder({
    baseUrl: server.baseUrl,
    model: "fake-embed",
    apiKeyEnv: "OKF_TEST_EMBED_KEY",
    env: { OKF_TEST_EMBED_KEY: KEY },
    dimensions: 4,
    batchSize: 8,
    concurrency: 2,
    maxInputChars: 400,
    maxRequestTokens: 200,
  });
  // 100 tokens per unit and a 200-token budget: every call of 8 units splits
  // into 4 requests, and two calls run at once.
  const units = Array.from({ length: 40 }, (_, position) => {
    const text = `${position}`.padEnd(400, "x");
    return { id: `okf://b/${position}`, text, hash: hashUnitText(text) };
  });
  const cache = openVectorCache(path.join(work, "cache"), {
    embedderId: embedder.id,
    dimension: 4,
  });
  const receipt = await prepareEmbeddings({}, embedder, cache, { units: () => units });
  assert.equal(receipt.embedded, 40);
  assert.equal(receipt.requests, 20);
  assert.equal(server.requests.length, 20);
  assert.ok(
    server.stats.maxInFlight <= 2,
    `at most two requests in flight, saw ${server.stats.maxInFlight}`,
  );
});

test("a failing call lets the in-flight call settle before the error surfaces", async (t) => {
  const work = tempDir(t, "okf-embed-prepare-");
  let calls = 0;
  const settled = [];
  const stub = {
    id: "settle:test:4",
    dimension: 4,
    languages: [],
    remote: false,
    maxBatch: 8,
    maxInputChars: 1000,
    concurrency: 2,
    async embed(texts) {
      calls += 1;
      const call = calls;
      if (call === 1) throw new Error("first call failed");
      await new Promise((resolve) => setTimeout(resolve, 30));
      settled.push(call);
      return texts.map((text) => vectorFor(text, 4));
    },
  };
  const units = Array.from({ length: 24 }, (_, position) => {
    const text = `unit ${position}`;
    return { id: `okf://b/${position}`, text, hash: hashUnitText(text) };
  });
  const cache = openVectorCache(path.join(work, "cache"), { embedderId: stub.id, dimension: 4 });
  await assert.rejects(
    prepareEmbeddings({}, stub, cache, { units: () => units }),
    /first call failed/,
  );
  assert.equal(calls, 2, "no call was started after the failure");
  assert.deepEqual(settled, [2], "the in-flight call finished before the rejection");
  assert.equal(cache.size, 8, "its batch was persisted");
});

test("unit hashes are stable for identical text and change with any character", () => {
  const text = "Title\nDescription\n# Body";
  assert.equal(hashUnitText(text), crypto.createHash("sha256").update(text).digest("hex"));
  assert.notEqual(hashUnitText(text), hashUnitText(`${text} `));
  const index = {
    documents: [
      { kind: "reserved", reserved: true, uri: "okf://b/index.md", title: "Index", body: "" },
      {
        kind: "concept",
        reserved: false,
        uri: "okf://b/a",
        title: "A",
        description: "D",
        body: "B",
      },
      {
        kind: "concept",
        reserved: false,
        uri: "okf://b/c",
        title: "C",
        description: undefined,
        body: "",
      },
    ],
  };
  assert.deepEqual(conceptUnits(index), [
    { id: "okf://b/a", text: "A\nD\nB", hash: hashUnitText("A\nD\nB") },
    { id: "okf://b/c", text: "C\n\n", hash: hashUnitText("C\n\n") },
  ]);
});
