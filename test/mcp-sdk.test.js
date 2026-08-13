"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const packageMetadata = require("../package.json");
const { callJson, connectMcp } = require("./mcp-client");

function writeConcept(root, name, title, body) {
  fs.writeFileSync(path.join(root, name), [
    "---",
    "type: Concept",
    `title: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
    body || "",
    "",
  ].join("\n"), "utf8");
}

function makeBundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-sdk-"));
  writeConcept(root, "alpha.md", "Alpha", "alpha-only-token");
  writeConcept(root, "beta.md", "Beta", "beta-only-token");
  writeConcept(root, "space name.md", "Space Name", "space-only-token");
  return root;
}

function estimatePayload(results) {
  const bytes = results.flatMap((result) => result.result.content)
    .filter((block) => block.type === "text")
    .reduce((total, block) => total + Buffer.byteLength(block.text, "utf8"), 0);
  return { bytes, estimatedTokens: Math.ceil(bytes / 4) };
}

test("official SDK serves both modern and legacy MCP eras", async (t) => {
  for (const mode of ["legacy", { pin: "2026-07-28" }]) {
    const connection = await connectMcp(t, [`local=${makeBundle()}`], {}, mode);
    assert.deepEqual(connection.client.getServerVersion(), {
      name: "okf-mcp",
      version: packageMetadata.version,
    });
    const modern = typeof mode === "object";
    assert.equal(connection.client.getProtocolEra(), modern ? "modern" : "legacy");
    assert.equal(
      connection.client.getNegotiatedProtocolVersion(),
      modern ? "2026-07-28" : "2025-11-25",
    );
    assert.deepEqual(connection.client.getServerCapabilities(), {
      resources: { listChanged: false },
      tools: { listChanged: false },
    });
    const tools = await connection.client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "search_concepts"), true);
    const resources = await connection.client.listResources();
    assert.equal(resources.resources.some((resource) => resource.uri === "okf://local/alpha"), true);
    assert.equal(resources.resources.some((resource) => resource.uri === "okf://local/space%20name"), true);
    const resource = await connection.client.readResource({ uri: "okf://local/alpha" });
    assert.match(resource.contents[0].text, /# Alpha/);
    const spaced = await connection.client.readResource({ uri: "okf://local/space%20name" });
    assert.match(spaced.contents[0].text, /# Space Name/);
    await assert.rejects(
      () => connection.client.readResource({ uri: "okf://local/missing" }),
      (error) => error.code === -32602,
    );
    const search = await callJson(connection.client, "search_concepts", { tagsAny: [] });
    assert.equal(search.payload.total, 3);
    const lexical = await callJson(connection.client, "search_concepts", { query: "only alpha", detail: "full" });
    assert.deepEqual(lexical.payload.results.map((result) => result.path), ["alpha.md"]);
    const listed = await callJson(connection.client, "list_concepts", { query: "only beta", detail: "full" });
    assert.deepEqual(listed.payload.results.map((result) => result.path), ["beta.md"]);
    const compact = await callJson(connection.client, "list_concepts", { limit: 3 });
    assert.deepEqual(Object.keys(compact.payload.results[0]).sort(), ["description", "title", "type", "uri"]);
    const fullList = await callJson(connection.client, "list_concepts", { detail: "full", limit: 3 });
    assert.ok(JSON.stringify(compact.payload).length < JSON.stringify(fullList.payload).length / 2);
    await connection.close();
  }
});

test("compact discovery keeps a realistic research path within a token budget", async (t) => {
  const bundle = path.resolve(__dirname, "../okf/bundles/okf-mcp");
  const { client } = await connectMcp(t, [`okf-mcp=${bundle}`]);
  const uri = "okf://okf-mcp/runtime/mcp-server";
  const compactList = await callJson(client, "list_concepts", { limit: 10 });
  const fullList = await callJson(client, "list_concepts", { limit: 10, detail: "full" });
  const compactSearch = await callJson(client, "search_concepts", { query: "runtime", limit: 5 });
  const fullSearch = await callJson(client, "search_concepts", { query: "runtime", limit: 5, detail: "full" });
  const concept = await callJson(client, "get_concept", { uri });
  const neighbors = await callJson(client, "get_neighbors", { uri });
  assert.deepEqual(compactList.payload.results.map((entry) => entry.uri),
    fullList.payload.results.map((entry) => entry.uri));
  assert.deepEqual(compactSearch.payload.results.map((entry) => entry.uri),
    fullSearch.payload.results.map((entry) => entry.uri));
  assert.equal(compactSearch.payload.results.some((entry) => entry.uri === uri), true);
  const compact = estimatePayload([compactList, compactSearch, concept, neighbors]);
  const full = estimatePayload([fullList, fullSearch, concept, neighbors]);
  assert.ok(compact.estimatedTokens <= 6500, { compact, full });
  assert.ok(compact.estimatedTokens * 10 <= full.estimatedTokens * 7, { compact, full });
});

test("SDK advertises existing schemas and validates arguments without coercion", async (t) => {
  const { client } = await connectMcp(t, [`local=${makeBundle()}`], {
    allowRuntimeRemoteLoad: true,
  });
  const tools = await client.listTools();
  const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
  const searchSchema = byName.get("search_concepts").inputSchema;
  assert.equal(searchSchema.properties.limit.type, "integer");
  assert.equal(searchSchema.properties.limit.default, 25);
  assert.equal(searchSchema.properties.offset.minimum, 0);
  assert.equal(searchSchema.properties.query.maxLength, 512);
  assert.deepEqual(searchSchema.properties.detail.enum, ["compact", "full"]);
  assert.equal(byName.get("load_remote_bundle").inputSchema.properties.provider.default, "github");
  assert.equal(byName.get("export_graph").inputSchema.properties.format.default, "json");

  const invalid = await client.callTool({
    name: "search_concepts",
    arguments: { limit: "20", unexpectedField: true },
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /Invalid arguments/);
});

test("business failures stay tool errors and unexpected failures are sanitized", async (t) => {
  const { client } = await connectMcp(t, [`local=${makeBundle()}`]);
  const missing = await client.callTool({
    name: "get_concept",
    arguments: { uri: "okf://local/missing" },
  });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /Unknown OKF concept URI/);

  const stale = await callJson(client, "get_concept", { uri: "okf://local/former/alpha" });
  assert.equal(stale.result.isError, true);
  assert.equal(stale.payload.code, "concept_not_found");
  assert.equal(stale.payload.details.recovery.retryWith.uri, "okf://local/alpha");

  const invalidDate = await client.callTool({
    name: "search_concepts",
    arguments: { asOf: "not-a-date" },
  });
  assert.equal(invalidDate.isError, true);
  assert.match(invalidDate.content[0].text, /asOf must be a valid Date/);

  const tooManyTerms = await client.callTool({
    name: "search_concepts",
    arguments: {
      query: Array.from({ length: 17 }, (_, index) => `term${index}`).join(" "),
    },
  });
  assert.equal(tooManyTerms.isError, true);
  assert.match(tooManyTerms.content[0].text, /must not exceed 16 terms/);

  const authoringService = {
    store: { project: null },
    async proposeConcept() {
      throw new TypeError("private implementation detail");
    },
  };
  const broken = await connectMcp(t, [`local=${makeBundle()}`], {
    authoringService,
    allowAuthoring: true,
  });
  const internal = await broken.client.callTool({
    name: "okf_propose_concept",
    arguments: {
      bundle: "local",
      path: "new.md",
      frontmatter: { type: "Concept", title: "New" },
    },
  });
  assert.equal(internal.isError, true);
  assert.match(internal.content[0].text, /Internal tool error/);
  assert.doesNotMatch(internal.content[0].text, /private implementation detail/);
});

test("SDK stdio transport enforces the configured one MiB input boundary", () => {
  const bundle = makeBundle();
  const oversized = "é".repeat((1024 * 1024 / 2) + 1) + "\n";
  const initialize = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "boundary-test", version: "1" },
    },
  })}\n`;
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../bin/okf-mcp.js"), "--bundle", `local=${bundle}`, "mcp"],
    { encoding: "utf8", input: oversized + initialize, maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.error) {
    assert.equal(result.error.code, "EPIPE");
  } else {
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
