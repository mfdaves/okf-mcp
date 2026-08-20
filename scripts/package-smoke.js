"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

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

async function smokeMcp(okfMcp, installedRoot, mode) {
  const transport = new StdioClientTransport({
    command: okfMcp,
    args: ["--root", installedRoot, "mcp"],
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client(
    { name: "okf-package-smoke", version: "1" },
    { versionNegotiation: { mode } },
  );
  try {
    await client.connect(transport);
    const modern = typeof mode === "object";
    assert.equal(client.getProtocolEra(), modern ? "modern" : "legacy");
    assert.equal(
      client.getNegotiatedProtocolVersion(),
      modern ? "2026-07-28" : "2025-11-25",
    );
    assert.equal(client.getServerVersion().version, packageMetadata.version);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("get_concept"), true);
    assert.equal(toolNames.includes("okf_accept_proposal"), false);
    assert.equal(toolNames.includes("okf_validate_changes"), false);
    assert.equal(toolNames.includes("okf_apply_changes"), false);
    assert.equal(toolNames.includes("load_remote_bundle"), false);
    assert.deepEqual(
      tools.tools.find((tool) => tool.name === "search_concepts").inputSchema.properties.detail.enum,
      ["compact", "full"],
    );

    const resources = await client.listResources();
    assert.equal(
      resources.resources.some((resource) => resource.uri === "okf://okf-mcp/overview/okf-mcp"),
      true,
    );
    const read = await client.readResource({ uri: "okf://okf-mcp/overview/okf-mcp" });
    assert.equal(read.contents[0].uri, "okf://okf-mcp/overview/okf-mcp");
    assert.match(read.contents[0].text, /# okf-mcp/);
    const concept = await client.callTool({
      name: "get_concept",
      arguments: { uri: "okf://okf-mcp/overview/okf-mcp" },
    });
    assert.match(concept.content[0].text, /"uri": "okf:\/\/okf-mcp\/overview\/okf-mcp"/);
    const search = await client.callTool({
      name: "search_concepts",
      arguments: { query: "server stdio", limit: 1 },
    });
    const searchPayload = JSON.parse(search.content[0].text);
    assert.equal(searchPayload.results[0].uri, "okf://okf-mcp/runtime/mcp-server");
    assert.deepEqual(
      Object.keys(searchPayload.results[0]).sort(),
      ["description", "title", "type", "uri"],
    );
  } finally {
    await client.close();
  }
  assert.equal(stderr, "");
}

async function smokeLiveValidation(okfMcp, installedRoot, mode) {
  const target = path.join(installedRoot, "package-smoke-preview.md");
  const transport = new StdioClientTransport({
    command: okfMcp,
    args: ["--root", installedRoot, "--write", "--actor", "process:package-smoke", "mcp"],
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client(
    { name: "okf-package-live-smoke", version: "1" },
    { versionNegotiation: { mode } },
  );
  try {
    await client.connect(transport);
    const modern = typeof mode === "object";
    assert.equal(client.getProtocolEra(), modern ? "modern" : "legacy");
    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.get("okf_validate_changes").annotations.readOnlyHint, true);
    assert.equal(byName.get("okf_apply_changes").annotations.destructiveHint, true);
    assert.equal(byName.get("okf_validate_changes").inputSchema.properties.detail.default, "compact");
    const result = await client.callTool({
      name: "okf_validate_changes",
      arguments: {
        changes: [{
          op: "create",
          path: "package-smoke-preview.md",
          type: "Reference",
          title: "Package Smoke Preview",
        }],
      },
    });
    assert.equal(result.isError, undefined);
    const payload = result.structuredContent || JSON.parse(result.content[0].text);
    assert.equal(payload.valid, true);
    assert.equal(payload.readyToApply, true);
    assert.equal(payload.durability.state, "not_persisted");
    assert.equal(fs.existsSync(target), false);
  } finally {
    await client.close();
  }
  assert.equal(stderr, "");
}

async function main() {
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
        name: "--root",
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
    assert.equal(packedPaths.has("okf/okf-mcp/index.md"), true);
    assert.equal(packedPaths.has("server.json"), true);
    assert.equal(packedPaths.has(".agents/skills/okf-v02-migration/SKILL.md"), true);
    assert.equal(packedPaths.has(".agents/skills/okf-v02-migration/agents/openai.yaml"), true);
    assert.equal(packedPaths.has(".agents/skills/okf-v02-migration/references/field-mapping.md"), true);
    [
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
    const installedRoot = path.join(installedPackageRoot, "okf", "okf-mcp");
    const installedServerMetadata = JSON.parse(fs.readFileSync(path.join(installedPackageRoot, "server.json"), "utf8"));
    const okf = executable(installRoot, "okf");
    const okfMcp = executable(installRoot, "okf-mcp");

    assert.equal(installedServerMetadata.name, packageMetadata.mcpName);
    assert.equal(installedServerMetadata.version, packageMetadata.version);
    assert.equal(installedServerMetadata.packages[0].identifier, packageMetadata.name);
    assert.equal(installedServerMetadata.packages[0].version, packageMetadata.version);
    assert.equal(run(okf, ["--version"]).stdout.trim(), packageMetadata.version);
    assert.equal(run(okfMcp, ["--version"]).stdout.trim(), packageMetadata.version);

    const validation = JSON.parse(run(okf, ["--root", installedRoot, "validate"]).stdout);
    assert.equal(validation.conformant, true);
    assert.equal(validation.validForProject, true);

    await smokeMcp(okfMcp, installedRoot, "legacy");
    await smokeMcp(okfMcp, installedRoot, { pin: "2026-07-28" });
    await smokeLiveValidation(okfMcp, installedRoot, "legacy");
    await smokeLiveValidation(okfMcp, installedRoot, { pin: "2026-07-28" });

    process.stdout.write(JSON.stringify({
      package: `${packageMetadata.name}@${packageMetadata.version}`,
      entries: packed.entryCount,
      concepts: 14,
      binaries: ["okf", "okf-mcp"],
      stdio: "passed",
    }, null, 2) + "\n");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
