"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runMcpHttpServer } = require("../src/mcp/http");
const { callJson, connectHttp, connectMcp } = require("./mcp-client");

const REMOTE_URL = "https://github.com/acme/widgets/tree/main/okf/bundles/docs";
const REMOTE_FILE = "okf/bundles/docs/remote.md";
const REMOTE_TEXT = [
  "---",
  "type: Concept",
  "title: Runtime Remote",
  "---",
  "",
  "# Runtime Remote",
  "",
].join("\n");

// Answers the GitHub requests of one remote bundle with one file and hands
// every other request (the MCP client's own) to the real fetch.
function mockGitHub(t) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.startsWith("https://api.github.com/repos/acme/widgets/commits/")) {
      return { ok: true, json: async () => ({ sha: "a".repeat(40) }) };
    }
    if (text.startsWith("https://api.github.com/repos/acme/widgets/contents/")) {
      const directory = decodeURIComponent(new URL(text).pathname.split("/contents/")[1] || "");
      return {
        ok: true,
        json: async () =>
          directory === path.posix.dirname(REMOTE_FILE)
            ? [
                {
                  type: "file",
                  name: path.posix.basename(REMOTE_FILE),
                  path: REMOTE_FILE,
                  size: Buffer.byteLength(REMOTE_TEXT),
                  download_url: `https://raw.example/${REMOTE_FILE}`,
                },
              ]
            : [],
      };
    }
    if (text === `https://raw.example/${REMOTE_FILE}`) {
      return { ok: true, status: 200, statusText: "OK", text: async () => REMOTE_TEXT };
    }
    return realFetch(url, init);
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
}

function tokenFile(t) {
  const file = path.join(os.tmpdir(), `okf-remote-tokens-${process.pid}-${Date.now()}.yaml`);
  t.after(() => fs.rmSync(file, { force: true }));
  const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
  const entry = (token, subject, scopes) => [
    `  - sha256: ${hash(token)}`,
    `    subject: ${subject}`,
    `    actor: human:${subject}`,
    `    scopes: [${scopes}]`,
  ];
  fs.writeFileSync(
    file,
    ["tokens:"]
      .concat(entry("tok-reader", "reader", "okf.read"))
      .concat(entry("tok-writer", "writer", "okf.read, okf.write"))
      .concat([""])
      .join("\n"),
  );
  return file;
}

async function callError(client, name, args) {
  try {
    return { result: await client.callTool({ name, arguments: args }) };
  } catch (error) {
    return { code: error.code };
  }
}

test("over HTTP, load_remote_bundle needs okf.write; over stdio --allow-remote-tool is enough", async (t) => {
  mockGitHub(t);
  const root = path.join(__dirname, "..", "okf", "okf-mcp");
  const server = await runMcpHttpServer([], {
    rootPath: root,
    allowRuntimeRemoteLoad: true,
    http: { port: 0, auth: { mode: "tokens", file: tokenFile(t) } },
  });
  t.after(() => server.close());
  const args = { id: "runtime", url: REMOTE_URL };

  // Read-only: not listed, and a call fails as for a disabled tool.
  const reader = await connectHttp(t, server.url, { token: "tok-reader" });
  const readerTools = (await reader.listTools()).tools.map((tool) => tool.name);
  assert.equal(readerTools.includes("load_remote_bundle"), false);
  assert.equal(readerTools.includes("list_remote_bundles"), true);
  assert.equal((await callError(reader, "load_remote_bundle", args)).code, -32602);
  assert.deepEqual(server.state.remoteBundles, []);

  // okf.write: listed and usable; every principal then reads the bundle.
  const writer = await connectHttp(t, server.url, { token: "tok-writer" });
  const writerTools = (await writer.listTools()).tools.map((tool) => tool.name);
  assert.equal(writerTools.includes("load_remote_bundle"), true);
  const loaded = await callJson(writer, "load_remote_bundle", args);
  assert.equal(loaded.result.isError, undefined);
  assert.equal(loaded.payload.fileCount, 1);
  const concept = await callJson(reader, "get_concept", { uri: "okf://runtime/remote.md" });
  assert.equal(concept.payload.title, "Runtime Remote");

  // Stdio keeps its single principal's rule: the flag alone enables the tool.
  const { client } = await connectMcp(t, [], { rootPath: root, allowRuntimeRemoteLoad: true });
  const stdioTools = (await client.listTools()).tools.map((tool) => tool.name);
  assert.equal(stdioTools.includes("load_remote_bundle"), true);
});
