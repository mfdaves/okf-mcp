"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const packageMetadata = require("../package.json");
const {
  SUPPORTED_PROTOCOL_VERSIONS,
  createServer,
  createServerAsync,
  runStdioServer,
} = require("../src/mcp-server");

function makeBundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-hardening-"));
  fs.writeFileSync(path.join(root, "concept.md"), [
    "---",
    "type: Concept",
    "title: Concept",
    "---",
    "",
    "# Concept",
    "",
  ].join("\n"), "utf8");
  return root;
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-hardening-project-"));
  const bundle = path.join(root, "bundle");
  fs.mkdirSync(bundle);
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: Hardening",
    "bundles:",
    "  - id: local",
    "    root: bundle",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(bundle, "concept.md"), [
    "---",
    "type: Concept",
    "title: Concept",
    "---",
    "",
    "# Concept",
    "",
  ].join("\n"), "utf8");
  return { root, bundle, projectPath: path.join(root, "okf.project.yaml") };
}

function toolNames(listed) {
  return new Set(listed.tools.map((tool) => tool.name));
}

function installRemoteFetch(t) {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    const apiMatch = textUrl.match(/^https:\/\/api\.github\.com\/repos\/acme\/([^/]+)\/contents\/([^?]+)\?ref=main$/);
    if (apiMatch) {
      const repo = apiMatch[1];
      const rootPath = decodeURIComponent(apiMatch[2]);
      const fileName = `${repo}.md`;
      return {
        ok: true,
        async json() {
          return [{
            type: "file",
            name: fileName,
            path: `${rootPath}/${fileName}`,
            size: 100,
            download_url: `https://raw.example/${repo}`,
          }];
        },
      };
    }
    const rawMatch = textUrl.match(/^https:\/\/raw\.example\/([^/]+)$/);
    if (rawMatch) {
      const repo = rawMatch[1];
      return {
        ok: true,
        async text() {
          return [
            "---",
            "type: Concept",
            `title: ${repo}`,
            "---",
            "",
            `# ${repo}`,
            "",
          ].join("\n");
        },
      };
    }
    return { ok: false, status: 404, statusText: "Not Found" };
  };
}

test("tools/list and tools/call enforce configured MCP capabilities", async () => {
  const bundle = makeBundle();
  const readOnlyServer = createServer([`local=${bundle}`]);
  const readOnlyNames = toolNames(await readOnlyServer.handle({ method: "tools/list" }));
  assert.equal(readOnlyNames.has("search_concepts"), true);
  assert.equal(readOnlyNames.has("okf_validate_concept"), false);
  assert.equal(readOnlyNames.has("okf_propose_concept"), false);
  assert.equal(readOnlyNames.has("load_remote_bundle"), false);
  await assert.rejects(
    () => readOnlyServer.handle({
      method: "tools/call",
      params: {
        name: "load_remote_bundle",
        arguments: {
          id: "blocked",
          url: "https://github.com/acme/blocked/tree/main/okf",
        },
      },
    }),
    /disabled by server configuration/,
  );

  const { projectPath } = makeProject();
  const projectServer = await createServerAsync([], { projectPath });
  const projectNames = toolNames(await projectServer.handle({ method: "tools/list" }));
  assert.equal(projectNames.has("okf_validate_concept"), true);
  assert.equal(projectNames.has("okf_get_proposal"), true);
  assert.equal(projectNames.has("okf_propose_concept"), false);
  assert.equal(projectNames.has("okf_accept_proposal"), false);
  await assert.rejects(
    () => projectServer.handle({
      method: "tools/call",
      params: {
        name: "okf_propose_concept",
        arguments: {
          bundle: "local",
          path: "blocked.md",
          frontmatter: { type: "Concept", title: "Blocked" },
        },
      },
    }),
    /disabled by server configuration/,
  );

  const enabledServer = await createServerAsync([], {
    projectPath,
    allowAuthoring: true,
    allowRuntimeRemoteLoad: true,
  });
  const enabledNames = toolNames(await enabledServer.handle({ method: "tools/list" }));
  assert.equal(enabledNames.has("okf_propose_concept"), true);
  assert.equal(enabledNames.has("okf_accept_proposal"), true);
  assert.equal(enabledNames.has("load_remote_bundle"), true);
});

test("accepted local proposals retain configured and runtime remote bundles and edges", async (t) => {
  installRemoteFetch(t);
  const { root, bundle, projectPath } = makeProject();
  fs.writeFileSync(projectPath, [
    "project: Hardening",
    "bundles:",
    "  - id: local",
    "    root: bundle",
    "remoteBundles:",
    "  - id: configured",
    "    provider: github",
    "    url: https://github.com/acme/configured/tree/main/okf",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(bundle, "source.md"), [
    "---",
    "type: Concept",
    "title: Source",
    "relations:",
    "  - type: related_to",
    "    target: okf://configured/configured.md",
    "---",
    "",
    "# Source",
    "",
  ].join("\n"), "utf8");

  const server = await createServerAsync([], {
    projectPath,
    proposalRoot: path.join(root, "proposals"),
    allowAuthoring: true,
    allowRuntimeRemoteLoad: true,
  });
  await server.handle({
    method: "tools/call",
    params: {
      name: "load_remote_bundle",
      arguments: {
        id: "runtime",
        url: "https://github.com/acme/runtime/tree/main/okf",
      },
    },
  });
  assert.equal(server.index.byUri.has("okf://configured/configured.md"), true);
  assert.equal(server.index.byUri.has("okf://runtime/runtime.md"), true);

  const proposed = await server.handle({
    method: "tools/call",
    params: {
      name: "okf_propose_concept",
      arguments: {
        bundle: "local",
        path: "accepted.md",
        frontmatter: { type: "Concept", title: "Accepted" },
      },
    },
  });
  const proposalId = JSON.parse(proposed.content[0].text).proposal.id;
  await server.handle({
    method: "tools/call",
    params: {
      name: "okf_accept_proposal",
      arguments: { proposalId },
    },
  });

  assert.equal(server.index.byUri.has("okf://configured/configured.md"), true);
  assert.equal(server.index.byUri.has("okf://runtime/runtime.md"), true);
  assert.equal(server.index.byUri.has("okf://local/accepted.md"), true);
  assert.equal(server.index.edges.some((edge) => (
    edge.source === "okf://local/source.md"
    && edge.target === "okf://configured/configured.md"
    && edge.relationType === "related_to"
    && !edge.broken
  )), true);
});

test("synchronous project servers rebuild from their configured local registry", async (t) => {
  installRemoteFetch(t);
  const { projectPath } = makeProject();
  const server = createServer([], {
    projectPath,
    allowRuntimeRemoteLoad: true,
  });

  await server.handle({
    method: "tools/call",
    params: {
      name: "load_remote_bundle",
      arguments: {
        id: "runtime",
        url: "https://github.com/acme/runtime/tree/main/okf",
      },
    },
  });

  assert.equal(server.index.project.name, "Hardening");
  assert.equal(server.index.byUri.has("okf://local/concept.md"), true);
  assert.equal(server.index.byUri.has("okf://runtime/runtime.md"), true);
});

test("initialize accepts only explicit supported MCP protocol versions", async () => {
  const server = createServer([`local=${makeBundle()}`]);
  for (const protocolVersion of SUPPORTED_PROTOCOL_VERSIONS) {
    const initialized = await server.handle({
      method: "initialize",
      params: { protocolVersion },
    });
    assert.equal(initialized.protocolVersion, protocolVersion);
    assert.equal(initialized.serverInfo.version, packageMetadata.version);
  }
  await assert.rejects(
    () => server.handle({
      method: "initialize",
      params: { protocolVersion: "1900-01-01" },
    }),
    /Unsupported MCP protocol version/,
  );
});

test("stdio MCP runner emits newline-delimited JSON-RPC on its output stream only", async () => {
  const bundle = makeBundle();
  const inputStream = new PassThrough();
  const outputStream = new PassThrough();
  let output = "";
  let resolveResponses;
  const responsesReady = new Promise((resolve) => {
    resolveResponses = resolve;
  });
  outputStream.on("data", (chunk) => {
    output += String(chunk);
    if (output.trim().split("\n").length >= 2) {
      resolveResponses();
    }
  });
  await runStdioServer([`local=${bundle}`], inputStream, outputStream);
  const input = [
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
    "",
  ].join("\n");
  inputStream.end(input);
  let timeout;
  try {
    await Promise.race([
      responsesReady,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for stdio MCP responses.")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  const responses = output.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(responses.map((response) => response.id), [1, 2]);
  assert.equal(responses[0].result.serverInfo.version, packageMetadata.version);
  const names = new Set(responses[1].result.tools.map((tool) => tool.name));
  assert.equal(names.has("search_concepts"), true);
  assert.equal(names.has("okf_propose_concept"), false);
  assert.equal(names.has("load_remote_bundle"), false);
});
