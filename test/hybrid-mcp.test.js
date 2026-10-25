"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main } = require("../src/cli");
const { loadProjectConfig } = require("../src/project");
const {
  loadEmbeddingConfigFile,
  normalizeEmbeddingConfig,
} = require("../src/search/embedding-config");
const { TOOL_ORDER, toolEnabled } = require("../src/mcp/registry");
const { callTool, createStateAsync } = require("../src/mcp/server");
const { tools: searchTools } = require("../src/mcp/tools/search");
const { sectionUnits } = require("../src/context/sections");
const { startFakeEmbeddingsServer } = require("./fake-embeddings-server");

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeConcept(root, relativePath, title, body) {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\ntype: Reference\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`);
}

function seedRoot(t, count) {
  const root = tempDir(t, "okf-hybrid-mcp-");
  for (let index = 0; index < count; index += 1) {
    writeConcept(
      root,
      `reference/seed-${index}.md`,
      `Seed ${index}`,
      `Alpine note number ${index}.`,
    );
  }
  return root;
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

async function hybridState(t, options) {
  const server = await startFakeEmbeddingsServer({ dimension: 16 });
  t.after(() => server.close());
  const root = seedRoot(t, 12);
  const cacheDir = path.join(tempDir(t, "okf-hybrid-mcp-cache-"), "vectors");
  const state = await createStateAsync([], {
    rootPath: root,
    allowWrite: true,
    actor: "test/wp3c",
    embedding: {
      embedder: {
        type: "openai",
        baseUrl: server.baseUrl,
        model: "fake-embed",
        dimensions: 16,
        batchSize: 64,
      },
      cacheDir,
      fusion: { alpha: 0.4 },
      embedUnits: "sections",
    },
    ...(options || {}),
  });
  return { server, root, cacheDir, state, bundle: path.basename(root) };
}

test("project config parses embedder, cacheDir, fusion and embedUnits", (t) => {
  const dir = tempDir(t, "okf-hybrid-project-");
  fs.mkdirSync(path.join(dir, "kb"));
  writeConcept(path.join(dir, "kb"), "a.md", "A", "Body.");
  const config = path.join(dir, "okf.project.yaml");
  fs.writeFileSync(
    config,
    [
      "bundles:",
      "  - id: kb",
      "    root: kb",
      "embedder:",
      "  type: openai",
      "  baseUrl: https://api.openai.com",
      "  model: text-embedding-3-small",
      "  apiKeyEnv: OPENAI_API_KEY",
      "  dimensions: 512",
      "cacheDir: ../vectors",
      "fusion:",
      "  alpha: 0.3",
      "  normalization: tmm",
      "embedUnits: concepts",
      "",
    ].join("\n"),
  );
  const project = loadProjectConfig(config);
  assert.deepEqual(project.errors, []);
  assert.deepEqual(project.embedding, {
    embedder: {
      type: "openai",
      baseUrl: "https://api.openai.com",
      model: "text-embedding-3-small",
      apiKeyEnv: "OPENAI_API_KEY",
      dimensions: 512,
    },
    cacheDir: "../vectors",
    fusion: { alpha: 0.3, normalization: "tmm" },
    embedUnits: "concepts",
  });
  // No embedder: off, and the project shape only gains a null field.
  assert.equal(normalizeEmbeddingConfig({ fusion: { alpha: 0.2 } }, []), null);

  const errors = [];
  const bad = normalizeEmbeddingConfig(
    {
      embedder: { type: "openai", baseUrl: "https://user:pw@example.com", model: "m", tls: 1 },
      fusion: { alpha: 2 },
      embedUnits: "words",
    },
    errors,
  );
  assert.equal(bad, null);
  assert.deepEqual(
    errors.map((entry) => entry.field),
    ["embedder.tls", "embedder.baseUrl", "fusion", "embedUnits"],
  );
  assert.ok(errors.every((entry) => !entry.message.includes("pw@")));
  const wrongType = [];
  normalizeEmbeddingConfig({ embedder: { type: "onnx" } }, wrongType);
  assert.equal(wrongType[0].field, "embedder.type");
});

test("--embedder-config files hold a bare embedder block or the project keys", (t) => {
  const dir = tempDir(t, "okf-hybrid-file-");
  const bare = path.join(dir, "bare.json");
  fs.writeFileSync(
    bare,
    JSON.stringify({ type: "openai", baseUrl: "http://127.0.0.1:1", model: "m" }),
  );
  assert.deepEqual(loadEmbeddingConfigFile(bare), {
    embedder: { type: "openai", baseUrl: "http://127.0.0.1:1", model: "m" },
    cacheDir: null,
    fusion: { alpha: 0.4, normalization: "tmm" },
    embedUnits: "concepts",
  });
  const full = path.join(dir, "full.yaml");
  fs.writeFileSync(
    full,
    "embedder:\n  type: openai\n  baseUrl: http://127.0.0.1:1\n  model: m\nfusion:\n  alpha: 0.7\n",
  );
  assert.equal(loadEmbeddingConfigFile(full).fusion.alpha, 0.7);
  const broken = path.join(dir, "broken.json");
  fs.writeFileSync(broken, JSON.stringify({ embedder: { type: "openai" }, extra: true }));
  assert.throws(
    () => loadEmbeddingConfigFile(broken),
    (error) => error.code === "invalid_embedder_config" && /extra/.test(error.message),
  );
});

test("the CLI passes --embedder-config and --cache-dir to the stdio server", async () => {
  let received = null;
  await main(
    ["--root", "okf/okf-mcp", "--embedder-config", "e.yaml", "--cache-dir", "/tmp/v", "mcp"],
    {
      runStdioServer: async (_bundles, _input, _output, options) => {
        received = options;
      },
    },
  );
  assert.deepEqual(received.embedding, { configPath: "e.yaml", cacheDir: "/tmp/v" });
  await assert.rejects(
    () => main(["--root", "okf/okf-mcp", "--embedder-config"], { runStdioServer: async () => {} }),
    /requires a file or directory path/,
  );
});

test("an MCP server with an embedder prepares vectors, fuses searches and reports status", async (t) => {
  const { server, root, cacheDir, state } = await hybridState(t);
  assert.ok(state.embeddings, "runtime attached");
  await state.embeddings.idle();
  // Section units by default: a lead unit and one per heading, all in one startup request.
  const units = new Set(sectionUnits(state.index).map((unit) => unit.hash)).size;
  assert.ok(units > 12);
  assert.equal(server.requests.length, 1, "every section in one startup request");
  assert.equal(toolEnabled(searchTools.embedding_status, state), true);
  assert.equal(TOOL_ORDER.at(-1), "embedding_status");

  const status = parse(await callTool(state, "embedding_status", {}));
  assert.equal(status.embedder.id, `openai:${server.baseUrl}/v1/embeddings:fake-embed:16:24000`);
  assert.equal(status.embedder.remote, false, "loopback endpoint");
  assert.equal(status.embedder.degraded, false);
  assert.equal(status.alpha, 0.4);
  assert.equal(status.startup.embedded, units);
  assert.equal(status.embedUnits, "sections");
  assert.equal(status.startup.requests, 1);
  assert.equal(status.cache.rows, units);
  assert.equal(
    fs.realpathSync(status.cache.dir),
    fs.realpathSync(cacheDir),
    "dir shown with --write",
  );

  const search = parse(await callTool(state, "search_concepts", { query: "alpine note" }));
  assert.equal(search.hybrid, true);
  assert.equal(search.alpha, 0.4);
  assert.equal(search.embedder.degraded, false);
  assert.deepEqual(search.usage, { promptTokens: 3, requests: 1 });
  assert.equal(typeof search.results[0].fusedScore, "number");
  const lexical = parse(
    await callTool(state, "search_concepts", { query: "alpine", hybrid: false }),
  );
  assert.equal(lexical.hybrid, false);
  assert.equal(lexical.results[0].fusedScore, undefined);
  // Nothing derived landed in the root.
  assert.deepEqual(fs.readdirSync(root), ["reference"]);
});

test("okf_apply_changes embeds a 5-concept batch in one request and reports it", async (t) => {
  const { server, state } = await hybridState(t);
  await state.embeddings.idle();
  const before = server.requests.length;
  const rowsBefore = state.embeddings.cache.size;
  const changes = Array.from({ length: 5 }, (_value, index) => ({
    op: "create",
    path: `reference/new-${index}.md`,
    type: "Reference",
    title: `New ${index}`,
    body: `# New ${index}\n\nFresh alpine finding ${index}.`,
  }));
  const receipt = parse(await callTool(state, "okf_apply_changes", { changes }));
  assert.equal(receipt.applied, true);
  assert.equal(server.requests.length - before, 1, "one embeddings request for the batch");
  assert.equal(server.requests.at(-1).body.input.length, receipt.embedding.units);
  assert.ok(receipt.embedding.units >= 5, "at least one section per new concept");
  assert.equal(receipt.embedding.embedded, receipt.embedding.units);
  assert.equal(receipt.embedding.usage.requests, 1);
  assert.ok(receipt.embedding.usage.promptTokens > 0);
  assert.equal(receipt.embedding.embedder.degraded, false);
  assert.equal(receipt.embedding.cache.rows, rowsBefore + receipt.embedding.units);
  const search = parse(await callTool(state, "search_concepts", { query: "fresh finding" }));
  assert.equal(search.hybrid, true);
  await state.embeddings.idle();
  assert.equal(server.requests.length - before, 2, "the follow-up sync embeds nothing");
});

test("an embedder error degrades search to lexical with the enumerated server code", async (t) => {
  const { server, state } = await hybridState(t);
  await state.embeddings.idle();
  server.script({ status: 401, code: "invalid_api_key" });
  const degraded = parse(await callTool(state, "search_concepts", { query: "seed alpine" }));
  assert.equal(degraded.hybrid, false);
  assert.equal(degraded.embedder.degraded, true);
  assert.equal(degraded.embedder.code, "embedder_http_error");
  assert.equal(degraded.embedder.serverCode, "invalid_api_key");
  assert.ok(!JSON.stringify(degraded).includes("Scripted"), "no server text");
  assert.ok(degraded.results.length > 0, "lexical results still returned");
  const status = parse(await callTool(state, "embedding_status", {}));
  assert.equal(status.embedder.degraded, true);
});

test("a server without an embedder keeps the lexical response and hides the status tool", async (t) => {
  const root = seedRoot(t, 3);
  const state = await createStateAsync([], { rootPath: root });
  assert.equal(state.embeddings, undefined);
  assert.equal(toolEnabled(searchTools.embedding_status, state), false);
  const plain = parse(await callTool(state, "search_concepts", { query: "seed" }));
  assert.equal("hybrid" in plain, false);
  assert.equal("embedder" in plain, false);
  const asked = parse(await callTool(state, "search_concepts", { query: "seed", hybrid: true }));
  assert.equal(asked.hybrid, false);
  assert.deepEqual(asked.embedder, {
    id: null,
    remote: null,
    dimension: null,
    degraded: true,
    code: "not_configured",
  });
  assert.deepEqual(asked.results, plain.results);
});
