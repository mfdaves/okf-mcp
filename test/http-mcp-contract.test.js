"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const { main } = require("../src/cli");
const { runMcpHttpServer } = require("../src/mcp/http");
const {
  INITIALIZE_BODY: INITIALIZE,
  MCP_POST_HEADERS: MCP_HEADERS,
  callJson,
  connectHttp,
  connectMcp,
  httpExchange: exchange,
} = require("./mcp-client");

const repositoryRoot = path.resolve(__dirname, "..");
const binary = path.join(repositoryRoot, "bin", "okf-mcp.js");
const ROOT = path.join(repositoryRoot, "okf", "okf-mcp");
const TOOL_FIELDS = ["name", "title", "description", "inputSchema", "outputSchema", "annotations"];

async function startHttp(t, options) {
  const server = await runMcpHttpServer(
    [],
    Object.assign({ rootPath: ROOT }, options, {
      http: Object.assign({ port: 0 }, options?.http),
    }),
  );
  t.after(() => server.close());
  return server;
}

// The advertised fields as they travel as JSON (an unset field is absent).
function contractTools(tools) {
  return tools.map((tool) =>
    Object.fromEntries(
      TOOL_FIELDS.filter((key) => tool[key] !== undefined).map((key) => [key, tool[key]]),
    ),
  );
}

test("MCP over HTTP lists the stdio tools and answers reads in both protocol eras", async (t) => {
  const server = await startHttp(t);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const stdio = await connectMcp(t, [], { rootPath: ROOT });
  const expected = contractTools((await stdio.client.listTools()).tools);

  const legacy = await connectHttp(t, server.url, { mode: "legacy" });
  const modern = await connectHttp(t, server.url, { mode: { pin: "2026-07-28" } });
  assert.equal(legacy.getNegotiatedProtocolVersion(), "2025-11-25");
  assert.equal(modern.getNegotiatedProtocolVersion(), "2026-07-28");
  for (const client of [legacy, modern]) {
    assert.equal(client.getServerVersion().name, "okf-mcp");
    assert.deepEqual(contractTools((await client.listTools()).tools), expected);
    const found = await callJson(client, "search_concepts", { query: "write policy" });
    assert.ok(found.payload.results.length > 0);
    const uri = found.payload.results[0].uri;
    const concept = await callJson(client, "get_concept", { uri });
    assert.equal(concept.payload.uri, uri);
    assert.equal(concept.payload.title, found.payload.results[0].title);
  }
  // An anonymous caller is read-only even where stdio would list more.
  const names = expected.map((tool) => tool.name);
  assert.equal(names.includes("okf_apply_changes"), false);

  const health = await exchange(server.port, { path: "/health" });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { status: "ok" });
  assert.equal((await exchange(server.port, { path: "/elsewhere" })).status, 404);
});

test("the endpoint follows --public-url and /health sits beside it", async (t) => {
  const server = await startHttp(t, {
    http: {
      mcpPath: "/okf/mcp",
      publicUrl: "https://mcp.example.test/okf/mcp",
      allowedHosts: ["mcp.example.test"],
    },
  });
  for (const location of ["/okf/health", "/health"]) {
    const health = await exchange(server.port, {
      path: location,
      headers: { host: "mcp.example.test" },
    });
    assert.equal(health.status, 200, location);
    assert.deepEqual(JSON.parse(health.body), { status: "ok" });
  }
  const answer = await exchange(server.port, {
    method: "POST",
    path: "/okf/mcp",
    headers: Object.assign({ host: "mcp.example.test" }, MCP_HEADERS),
    body: INITIALIZE,
  });
  assert.equal(answer.status, 200);
  assert.equal((await exchange(server.port, { method: "POST", path: "/mcp" })).status, 404);
});

test("a raw 2025-11-25 initialize is served statelessly", async (t) => {
  const server = await startHttp(t);
  const answer = await exchange(server.port, {
    method: "POST",
    headers: MCP_HEADERS,
    body: INITIALIZE,
  });
  assert.equal(answer.status, 200);
  assert.match(answer.body, /"protocolVersion":"2025-11-25"/);
  assert.match(answer.body, /"name":"okf-mcp"/);
  assert.equal(answer.headers["mcp-session-id"], undefined);
});

test("wrong Host, foreign Origin and oversized bodies are refused", async (t) => {
  const server = await startHttp(t, { http: { allowedOrigins: ["app.example.test"] } });
  const wrongHost = await exchange(server.port, {
    method: "POST",
    headers: Object.assign({ host: "attacker.example" }, MCP_HEADERS),
    body: INITIALIZE,
  });
  assert.equal(wrongHost.status, 403);
  assert.match(JSON.parse(wrongHost.body).error.message, /Invalid Host/);
  const healthByName = await exchange(server.port, {
    path: "/health",
    headers: { host: "attacker.example" },
  });
  assert.equal(healthByName.status, 403);

  const foreign = await exchange(server.port, {
    method: "POST",
    headers: Object.assign({ origin: "https://attacker.example" }, MCP_HEADERS),
    body: INITIALIZE,
  });
  assert.equal(foreign.status, 403);
  assert.match(JSON.parse(foreign.body).error.message, /Invalid Origin/);
  for (const origin of ["http://localhost:3000", "https://app.example.test"]) {
    const allowed = await exchange(server.port, {
      method: "POST",
      headers: Object.assign({ origin }, MCP_HEADERS),
      body: INITIALIZE,
    });
    assert.equal(allowed.status, 200, origin);
  }

  const oversized = await exchange(server.port, {
    method: "POST",
    headers: MCP_HEADERS,
    body: Buffer.alloc(2 * 1024 * 1024, 0x20),
  });
  assert.equal(oversized.status, 413);
  assert.equal(JSON.parse(oversized.body).error.code, -32600);
  const streamed = await exchange(server.port, {
    method: "POST",
    headers: Object.assign({ "transfer-encoding": "chunked" }, MCP_HEADERS),
    chunks: Array.from({ length: 32 }, () => Buffer.alloc(64 * 1024, 0x20)),
  });
  assert.equal(streamed.status, 413);
  // The server keeps serving after refusing.
  const after = await exchange(server.port, { path: "/health" });
  assert.equal(after.status, 200);
});

test("--http flags are parsed strictly and a non-loopback host needs --auth", async (t) => {
  const calls = [];
  const runtime = {
    runMcpHttpServer: async (bundleArgs, options) => {
      calls.push({ bundleArgs, options });
      return { url: "http://127.0.0.1:1/mcp" };
    },
    runStdioServer: async () => {
      throw new Error("stdio must not start");
    },
  };
  const stderr = process.stderr.write;
  process.stderr.write = () => true;
  t.after(() => {
    process.stderr.write = stderr;
  });
  await main(["--root", ROOT, "mcp", "--http"], runtime);
  await main(
    [
      "--root",
      ROOT,
      "mcp",
      "--http",
      "--port",
      "0",
      "--public-url",
      "https://mcp.example.test/okf/mcp/",
      "--allowed-host",
      "proxy.internal:8080",
      "--allowed-origin=https://app.example.test",
    ],
    runtime,
  );
  assert.deepEqual(calls[0].bundleArgs, [ROOT]);
  assert.equal(calls[0].options.rootPath, ROOT);
  assert.deepEqual(calls[0].options.http, {
    host: "127.0.0.1",
    port: 8766,
    mcpPath: "/mcp",
    publicUrl: null,
    allowedHosts: [],
    allowedOrigins: [],
    auth: null,
    refreshIntervalMs: 2000,
  });
  assert.deepEqual(calls[1].options.http, {
    host: "127.0.0.1",
    port: 0,
    mcpPath: "/okf/mcp",
    publicUrl: "https://mcp.example.test/okf/mcp/",
    allowedHosts: ["proxy.internal", "mcp.example.test"],
    allowedOrigins: ["app.example.test"],
    auth: null,
    refreshIntervalMs: 2000,
  });

  const refused = [
    [["mcp", "--http", "--host", "0.0.0.0"], /non-loopback --host requires --auth/],
    [["mcp", "--http", "--write", "--actor", "human:x"], /--write with --http requires --auth/],
    [["mcp", "--http", "--authoring"], /--authoring is not available with --http/],
    [["mcp", "--public-url", "https://mcp.example.test/mcp"], /require --http/],
    [["mcp", "--http", "--public-url", "ftp://mcp.example.test/"], /http or https/],
    [["mcp", "--http", "--public-url", "https://mcp.example.test/mcp?x=1"], /query/],
    [["mcp", "--http", "--port", "70000"], /--port must be an integer/],
    [["mcp", "--http", "--allowed-host"], /requires a value/],
    [["validate", "--http"], /only with the mcp command/],
  ];
  for (const [args, message] of refused) {
    await assert.rejects(main(["--root", ROOT].concat(args), runtime), (error) => {
      assert.equal(error.exitCode, 2, args.join(" "));
      assert.match(error.message, message);
      return true;
    });
  }
  assert.equal(calls.length, 2);

  // Through the binary: a usage error exits 2 before anything listens.
  const result = spawnSync(
    process.execPath,
    [binary, "--root", ROOT, "mcp", "--http", "--host", "0.0.0.0"],
    { encoding: "utf8", timeout: 20000 },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires --auth/);
});
