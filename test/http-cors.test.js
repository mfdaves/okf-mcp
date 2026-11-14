"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { runMcpHttpServer } = require("../src/mcp/http");
const { INITIALIZE_BODY, MCP_POST_HEADERS, httpExchange, writeTokenFile } = require("./mcp-client");

const ROOT = path.join(__dirname, "..", "okf", "okf-mcp");
const APP = "https://app.example.test";
const ALLOW_METHODS = "GET, POST, DELETE, OPTIONS";
const ALLOW_HEADERS =
  "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID";
const EXPOSE_HEADERS = "WWW-Authenticate, Mcp-Session-Id";

async function start(t) {
  const file = writeTokenFile(t, [
    { token: "tok-reader", subject: "reader", actor: "human:reader", scopes: ["okf.read"] },
    { token: "tok-write-only", subject: "w", actor: "human:w", scopes: ["okf.write"] },
  ]);
  const server = await runMcpHttpServer([], {
    rootPath: ROOT,
    http: { port: 0, allowedOrigins: [new URL(APP).hostname], auth: { mode: "tokens", file } },
  });
  t.after(() => server.close());
  return server;
}

function preflight(server, origin) {
  return httpExchange(server.port, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type, mcp-protocol-version",
    },
  });
}

function post(server, headers, body) {
  return httpExchange(server.port, {
    method: "POST",
    headers: Object.assign({}, MCP_POST_HEADERS, headers),
    body: body === undefined ? INITIALIZE_BODY : body,
  });
}

function assertCors(answer, origin, label) {
  assert.equal(answer.headers["access-control-allow-origin"], origin, label);
  assert.match(answer.headers.vary || "", /\bOrigin\b/, label);
  assert.equal(answer.headers["access-control-expose-headers"], EXPOSE_HEADERS, label);
}

function assertNoCors(answer, label) {
  const cors = Object.keys(answer.headers).filter((key) => key.startsWith("access-control-"));
  assert.deepEqual(cors, [], label);
}

test("allowed origins get CORS: a preflight without credentials and headers on every answer", async (t) => {
  const server = await start(t);
  for (const origin of [APP, "http://localhost:5173"]) {
    const answer = await preflight(server, origin);
    assert.equal(answer.status, 204, origin);
    assertCors(answer, origin, origin);
    assert.equal(answer.headers["access-control-allow-methods"], ALLOW_METHODS);
    assert.equal(answer.headers["access-control-allow-headers"], ALLOW_HEADERS);
    assert.equal(answer.body, "");
  }

  const origin = { origin: APP };
  const missing = await post(server, origin);
  assert.equal(missing.status, 401);
  assert.ok(missing.headers["www-authenticate"]);
  assertCors(missing, APP, "401");
  const insufficient = await post(
    server,
    Object.assign({ authorization: "Bearer tok-write-only" }, origin),
  );
  assert.equal(insufficient.status, 403);
  assertCors(insufficient, APP, "403");
  const served = await post(server, Object.assign({ authorization: "Bearer tok-reader" }, origin));
  assert.equal(served.status, 200);
  assertCors(served, APP, "200");
  const tooLarge = await post(
    server,
    Object.assign({ authorization: "Bearer tok-reader" }, origin),
    Buffer.alloc(2 * 1024 * 1024, 0x20),
  );
  assert.equal(tooLarge.status, 413);
  assertCors(tooLarge, APP, "413");

  // Without an Origin header nothing changes.
  assertNoCors(await post(server, { authorization: "Bearer tok-reader" }), "no origin");
});

test("disallowed origins keep getting 403 without CORS headers", async (t) => {
  const server = await start(t);
  for (const origin of ["https://attacker.example", "null"]) {
    const refusedPreflight = await preflight(server, origin);
    assert.equal(refusedPreflight.status, 403, origin);
    assertNoCors(refusedPreflight, origin);
    const refused = await post(server, { origin, authorization: "Bearer tok-reader" });
    assert.equal(refused.status, 403, origin);
    assertNoCors(refused, origin);
  }
});
