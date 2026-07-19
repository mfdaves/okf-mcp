"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const packageMetadata = require(path.join(repositoryRoot, "package.json"));
const lockMetadata = require(path.join(repositoryRoot, "package-lock.json"));
const serverMetadata = require(path.join(repositoryRoot, "server.json"));

function executable(directory, name) {
  return path.join(directory, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...(options || {}),
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}\n${detail}`);
  }
  return result;
}

function parseRpcLines(stdout) {
  return String(stdout || "").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function main() {
  assert.equal(lockMetadata.name, packageMetadata.name);
  assert.equal(lockMetadata.version, packageMetadata.version);
  assert.equal(lockMetadata.packages[""].name, packageMetadata.name);
  assert.equal(lockMetadata.packages[""].version, packageMetadata.version);
  assert.equal(serverMetadata.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.equal(serverMetadata.name, packageMetadata.mcpName);
  assert.equal(serverMetadata.version, packageMetadata.version);
  assert.equal(serverMetadata.packages.length, 1);
  assert.equal(serverMetadata.packages[0].registryType, "npm");
  assert.equal(serverMetadata.packages[0].identifier, packageMetadata.name);
  assert.equal(serverMetadata.packages[0].version, packageMetadata.version);
  assert.deepEqual(serverMetadata.packages[0].transport, { type: "stdio" });
  assert.deepEqual(
    serverMetadata.packages[0].packageArguments.map((argument) => ({
      type: argument.type,
      name: argument.name,
      value: argument.value,
      format: argument.format,
      isRequired: argument.isRequired,
    })),
    [
      {
        type: "named",
        name: "--project",
        value: undefined,
        format: "filepath",
        isRequired: true,
      },
      {
        type: "positional",
        name: undefined,
        value: "mcp",
        format: undefined,
        isRequired: undefined,
      },
    ],
  );

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-package-smoke-"));
  const packRoot = path.join(temporaryRoot, "pack");
  const installRoot = path.join(temporaryRoot, "install");
  fs.mkdirSync(packRoot, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });

  try {
    const packed = JSON.parse(run(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", packRoot],
    ).stdout)[0];
    const packedPaths = new Set(packed.files.map((entry) => entry.path));
    assert.equal(packed.name, packageMetadata.name);
    assert.equal(packed.version, packageMetadata.version);
    assert.equal(packedPaths.has("okf.project.yaml"), true);
    assert.equal(packedPaths.has("okf/bundles/okf-mcp/index.md"), true);
    assert.equal(packedPaths.has("server.json"), true);
    [
      ".agents/",
      ".github/",
      ".okf-proposals/",
      "scripts/",
      "test/",
    ].forEach((prefix) => {
      assert.equal(
        Array.from(packedPaths).some((entry) => entry.startsWith(prefix)),
        false,
        `${prefix} must not be present in the package`,
      );
    });
    assert.equal(packedPaths.has("package-lock.json"), false);

    const tarball = path.join(packRoot, packed.filename);
    run("npm", [
      "install",
      "--prefix",
      installRoot,
      tarball,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);

    const installedPackageRoot = path.join(installRoot, "node_modules", ...packageMetadata.name.split("/"));
    const installedProject = path.join(installedPackageRoot, "okf.project.yaml");
    const installedServerMetadata = JSON.parse(fs.readFileSync(path.join(installedPackageRoot, "server.json"), "utf8"));
    const okf = executable(installRoot, "okf");
    const okfMcp = executable(installRoot, "okf-mcp");

    assert.equal(installedServerMetadata.name, packageMetadata.mcpName);
    assert.equal(installedServerMetadata.version, packageMetadata.version);
    assert.equal(installedServerMetadata.packages[0].identifier, packageMetadata.name);
    assert.equal(installedServerMetadata.packages[0].version, packageMetadata.version);
    assert.equal(run(okf, ["--version"]).stdout.trim(), packageMetadata.version);
    assert.equal(run(okfMcp, ["--version"]).stdout.trim(), packageMetadata.version);

    const validation = JSON.parse(run(okf, ["--project", installedProject, "validate"]).stdout);
    assert.equal(validation.conformant, true);
    assert.equal(validation.validForProject, true);

    const rpcInput = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "package-smoke", version: "1" } },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", method: "notifications/package-smoke", params: {} },
      { jsonrpc: "2.0", id: 2, method: "ping", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 4, method: "resources/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "resources/read",
        params: { uri: "okf://okf-mcp/overview/okf-mcp" },
      },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "get_concept", arguments: { uri: "okf://okf-mcp/overview/okf-mcp" } },
      },
    ].map((message) => JSON.stringify(message)).join("\n") + "\n";
    const protocol = run(okfMcp, ["--project", installedProject, "mcp"], { input: rpcInput });
    assert.equal(protocol.stderr, "");
    const responses = parseRpcLines(protocol.stdout);
    assert.deepEqual(responses.map((response) => response.id), [1, 2, 3, 4, 5, 6]);
    assert.equal(responses[0].result.protocolVersion, "2025-11-25");
    assert.equal(responses[0].result.serverInfo.version, packageMetadata.version);
    assert.deepEqual(responses[1].result, {});
    const toolNames = responses[2].result.tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("get_concept"), true);
    assert.equal(toolNames.includes("okf_accept_proposal"), false);
    assert.equal(toolNames.includes("load_remote_bundle"), false);
    assert.equal(
      responses[3].result.resources.some((resource) => resource.uri === "okf://okf-mcp/overview/okf-mcp"),
      true,
    );
    assert.equal(responses[4].result.contents[0].uri, "okf://okf-mcp/overview/okf-mcp");
    assert.match(responses[4].result.contents[0].text, /# okf-mcp/);
    assert.match(responses[5].result.content[0].text, /"uri": "okf:\/\/okf-mcp\/overview\/okf-mcp"/);

    const fallbackInput = JSON.stringify({
      jsonrpc: "2.0",
      id: "fallback",
      method: "initialize",
      params: {
        protocolVersion: "2099-01-01",
        capabilities: {},
        clientInfo: { name: "package-smoke", version: "1" },
      },
    }) + "\n";
    const fallbackProtocol = run(okfMcp, ["--project", installedProject, "mcp"], { input: fallbackInput });
    assert.equal(fallbackProtocol.stderr, "");
    const fallbackResponses = parseRpcLines(fallbackProtocol.stdout);
    assert.equal(fallbackResponses.length, 1);
    assert.equal(fallbackResponses[0].id, "fallback");
    assert.equal(fallbackResponses[0].result.protocolVersion, "2025-11-25");

    process.stdout.write(JSON.stringify({
      package: `${packageMetadata.name}@${packageMetadata.version}`,
      entries: packed.entryCount,
      concepts: 11,
      binaries: ["okf", "okf-mcp"],
      stdio: "passed",
    }, null, 2) + "\n");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
