"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

const repositoryRoot = path.resolve(__dirname, "..");
const snapshotRoot = path.join(__dirname, "snapshots");
const binary = path.join(repositoryRoot, "bin", "okf-mcp.js");
const UPDATE_SNAPSHOTS = process.env.OKF_UPDATE_SNAPSHOTS === "1";

// One entry per row of the README capability table plus the project workspace
// form. The flags go through the real binary so the snapshot covers CLI parsing
// and registry composition together, not just the in-process server factory.
const MODES = [
  { name: "default", args: ["--root", "okf/okf-mcp"] },
  { name: "authoring", args: ["--root", "okf/okf-mcp", "--authoring"] },
  { name: "write", args: ["--root", "okf/okf-mcp", "--write", "--actor", "human:test"] },
  { name: "remote-tool", args: ["--root", "okf/okf-mcp", "--allow-remote-tool"] },
  {
    name: "computation-authoring",
    args: ["--root", "okf/okf-mcp", "--authoring", "--allow-computation-authoring"],
  },
  { name: "project", args: ["--project", "okf.project.yaml"] },
];

const TOOL_FIELDS = ["name", "title", "description", "inputSchema", "outputSchema", "annotations"];

// Object keys are sorted recursively so the stored JSON is stable regardless of
// construction order; arrays keep their order because it is part of the
// contract (required lists, enums, oneOf branches).
function sortedJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortedJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedJson(value[key])]),
    );
  }
  return value;
}

function pick(source, keys) {
  const result = {};
  keys.forEach((key) => {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  });
  return result;
}

function byName(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

async function captureContract(args) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binary].concat(args, ["mcp"]),
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client(
    { name: "okf-mcp-contract-snapshot", version: "1" },
    { versionNegotiation: { mode: "legacy" } },
  );
  let contract;
  try {
    await client.connect(transport);
    const serverInfo = Object.assign({}, client.getServerVersion());
    delete serverInfo.version;
    const instructions = client.getInstructions();
    const tools = (await client.listTools()).tools
      .map((tool) => pick(tool, TOOL_FIELDS))
      .sort(byName);
    const templates = (await client.listResourceTemplates()).resourceTemplates;
    contract = sortedJson({
      initialize: {
        capabilities: client.getServerCapabilities(),
        instructions: instructions === undefined ? null : instructions,
        serverInfo,
      },
      tools,
      resourceTemplates: templates,
    });
  } finally {
    await client.close();
  }
  assert.equal(stderr, "");
  return contract;
}

function snapshotPath(name) {
  return path.join(snapshotRoot, `mcp-contract-${name}.json`);
}

MODES.forEach((mode) => {
  test(`MCP contract snapshot matches for ${mode.name} mode`, async () => {
    const actual = await captureContract(mode.args);
    const file = snapshotPath(mode.name);
    if (UPDATE_SNAPSHOTS) {
      fs.mkdirSync(snapshotRoot, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    }
    assert.equal(
      fs.existsSync(file),
      true,
      `Missing snapshot ${path.relative(repositoryRoot, file)}; run with OKF_UPDATE_SNAPSHOTS=1 to create it.`,
    );
    const expected = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(actual, expected);
  });
});

test("snapshot modes cover every documented capability flag combination", () => {
  assert.deepEqual(
    MODES.map((mode) => mode.name),
    ["default", "authoring", "write", "remote-tool", "computation-authoring", "project"],
  );
  // A snapshot taken against a misparsed flag would silently freeze the wrong
  // contract, so pin the gating facts the capability table promises.
  const write = JSON.parse(fs.readFileSync(snapshotPath("write"), "utf8"));
  const writeNames = write.tools.map((tool) => tool.name);
  assert.equal(writeNames.includes("okf_apply_changes"), true);
  assert.equal(writeNames.includes("okf_propose_concept"), false);
  const base = JSON.parse(fs.readFileSync(snapshotPath("default"), "utf8"));
  const baseNames = base.tools.map((tool) => tool.name);
  assert.equal(baseNames.includes("okf_apply_changes"), false);
  assert.equal(baseNames.includes("load_remote_bundle"), false);
  assert.equal(baseNames.includes("okf_validate_concept"), true);
});
