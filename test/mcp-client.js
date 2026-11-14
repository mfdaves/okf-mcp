"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Client, StreamableHTTPClientTransport } = require("@modelcontextprotocol/client");
const { InMemoryTransport } = require("@modelcontextprotocol/server");
const { serveStdio } = require("@modelcontextprotocol/server/stdio");

const { createMcpServer } = require("../src/mcp-server");

// Connects an SDK client over an in-memory pair to the servers a factory
// builds (one per connection, as serveStdio calls it).
async function connectFactory(t, factory, mode) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(factory, {
    legacy: "serve",
    transport: serverTransport,
  });
  const client = new Client(
    { name: "okf-mcp-test", version: "1" },
    { versionNegotiation: { mode: mode || "legacy" } },
  );
  await client.connect(clientTransport);
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await client.close();
    await handle.close();
  }
  if (t) t.after(close);
  return { client, close };
}

async function connectMcp(t, bundleArgs, options, mode) {
  return connectFactory(t, () => createMcpServer(bundleArgs || [], options || {}), mode);
}

// An SDK client over Streamable HTTP; `token` is sent as a bearer token.
async function connectHttp(t, url, options) {
  const config = options || {};
  const client = new Client(
    { name: "okf-http-test", version: "1" },
    { versionNegotiation: { mode: config.mode || "legacy" } },
  );
  const headers = config.token ? { authorization: `Bearer ${config.token}` } : {};
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }),
  );
  if (t) t.after(() => client.close());
  return client;
}

// One raw HTTP exchange with 127.0.0.1:port, so tests can set any header and
// send oversized or chunked bodies (`chunks` are written without a length).
function httpExchange(port, options) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method || "GET",
        path: options.path || "/mcp",
        headers: options.headers || {},
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    for (const chunk of options.chunks || []) request.write(chunk);
    request.end(options.body);
  });
}

// A raw legacy initialize and the headers a Streamable HTTP POST carries.
const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "raw", version: "1" },
  },
});
const MCP_POST_HEADERS = Object.freeze({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
});

// A token file (--auth tokens:<file>) for `entries` of { token, subject,
// actor, scopes }, removed after the test.
function writeTokenFile(t, entries) {
  const file = path.join(
    os.tmpdir(),
    `okf-tokens-${process.pid}-${crypto.randomBytes(6).toString("hex")}.yaml`,
  );
  if (t) t.after(() => fs.rmSync(file, { force: true }));
  const lines = ["tokens:"];
  for (const entry of entries) {
    lines.push(
      `  - sha256: ${crypto.createHash("sha256").update(entry.token).digest("hex")}`,
      `    subject: ${JSON.stringify(entry.subject)}`,
      `    actor: ${JSON.stringify(entry.actor)}`,
      `    scopes: [${entry.scopes.join(", ")}]`,
    );
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

// The JSON-RPC error code of a call the server refuses, or its result.
async function callOutcome(client, name, args) {
  try {
    return { result: await client.callTool({ name, arguments: args || {} }) };
  } catch (error) {
    return { code: error.code };
  }
}

async function callJson(client, name, args) {
  const result = await client.callTool({ name, arguments: args || {} });
  return {
    result,
    payload: JSON.parse(result.content[0].text),
  };
}

module.exports = {
  INITIALIZE_BODY,
  MCP_POST_HEADERS,
  callJson,
  callOutcome,
  connectFactory,
  connectHttp,
  connectMcp,
  httpExchange,
  writeTokenFile,
};
