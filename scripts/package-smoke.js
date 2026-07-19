"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const packageMetadata = require(path.join(repositoryRoot, "package.json"));

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
    const okf = executable(installRoot, "okf");
    const okfMcp = executable(installRoot, "okf-mcp");

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
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "package-smoke", version: "1" } },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_concept", arguments: { uri: "okf://okf-mcp/overview/okf-mcp" } },
      },
    ].map((message) => JSON.stringify(message)).join("\n") + "\n";
    const protocol = run(okfMcp, ["--project", installedProject, "mcp"], { input: rpcInput });
    assert.equal(protocol.stderr, "");
    const responses = parseRpcLines(protocol.stdout);
    assert.deepEqual(responses.map((response) => response.id), [1, 2, 3]);
    assert.equal(responses[0].result.serverInfo.version, packageMetadata.version);
    const toolNames = responses[1].result.tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("get_concept"), true);
    assert.equal(toolNames.includes("okf_accept_proposal"), false);
    assert.equal(toolNames.includes("load_remote_bundle"), false);
    assert.match(responses[2].result.content[0].text, /"uri": "okf:\/\/okf-mcp\/overview\/okf-mcp"/);

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
