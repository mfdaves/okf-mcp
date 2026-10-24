"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

const repositoryRoot = path.resolve(__dirname, "..");
const binary = path.join(repositoryRoot, "bin", "okf-mcp.js");

// A bundle whose only concept would match the plural query through English
// stemming: detection sees English stop words, so only an explicit setting
// can keep "runners" away from "Runner".
function writeBundle(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "index.md"),
    ["---", 'okf_version: "0.2"', "---", "", "# Root", "", "- [Runner](runner.md)", ""].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "runner.md"),
    [
      "---",
      "type: Concept",
      "title: Runner",
      "---",
      "",
      "# Runner",
      "",
      "The runner runs on the track every morning.",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function connectBinary(t, args) {
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
    { name: "okf-mcp-languages-test", version: "1" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    assert.equal(stderr, "");
  });
  return client;
}

async function callJson(client, name, args) {
  const result = await client.callTool({ name, arguments: args || {} });
  return { result, payload: JSON.parse(result.content[0].text) };
}

async function total(client, query) {
  const { payload } = await callJson(client, "search_concepts", { query, mode: "all" });
  return payload.total;
}

test("project config languages: none is honoured over MCP", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "okf-lang-project-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeBundle(path.join(dir, "bundle"));
  const config = path.join(dir, "okf.project.yaml");
  fs.writeFileSync(
    config,
    ["project: lang", "bundles:", "  - id: local", "    root: bundle", "languages: none", ""].join(
      "\n",
    ),
    "utf8",
  );
  const client = await connectBinary(t, ["--project", config]);
  assert.equal(await total(client, "runner"), 1);
  assert.equal(await total(client, "runners"), 0, "stemming must stay off under languages: none");
  // The same bundle under the default setting proves the query would otherwise match.
  const auto = await connectBinary(t, ["--root", path.join(dir, "bundle")]);
  assert.equal(await total(auto, "runners"), 1);
});

test("--languages none is honoured in root mode and survives the rebuild after okf_apply_changes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-lang-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBundle(root);
  const client = await connectBinary(t, [
    "--root",
    root,
    "--languages",
    "none",
    "--write",
    "--actor",
    "human:test",
  ]);
  assert.equal(await total(client, "runner"), 1);
  assert.equal(await total(client, "runners"), 0);
  const bundles = await callJson(client, "list_bundles", {});
  const listed = Array.isArray(bundles.payload) ? bundles.payload : bundles.payload.bundles;
  const bundle = listed[0].id;
  const applied = await callJson(client, "okf_apply_changes", {
    bundle,
    changes: [{ op: "create", path: "late.md", type: "Concept", title: "Late Runner" }],
  });
  assert.equal(applied.payload.applied, true, JSON.stringify(applied.payload));
  // The rebuilt index knows the new concept and still does not stem.
  assert.equal(await total(client, "late"), 1);
  assert.equal(await total(client, "runner"), 2);
  assert.equal(await total(client, "runners"), 0, "languages must survive the index rebuild");
});
