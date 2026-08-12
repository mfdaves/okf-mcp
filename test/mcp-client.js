"use strict";

const { Client } = require("@modelcontextprotocol/client");
const { InMemoryTransport } = require("@modelcontextprotocol/server");
const { serveStdio } = require("@modelcontextprotocol/server/stdio");

const { createMcpServer } = require("../src/mcp-server");

async function connectMcp(t, bundleArgs, options, mode) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(
    () => createMcpServer(bundleArgs || [], options || {}),
    { legacy: "serve", transport: serverTransport },
  );
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

async function callJson(client, name, args) {
  const result = await client.callTool({ name, arguments: args || {} });
  return {
    result,
    payload: JSON.parse(result.content[0].text),
  };
}

module.exports = {
  callJson,
  connectMcp,
};
