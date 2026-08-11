"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { ConceptAuthoringService } = require("../src/authoring");
const { parseArgs, discoverProject } = require("../src/cli");
const { buildIndex, resolveConcept } = require("../src/indexer");
const { createServerAsync } = require("../src/mcp-server");
const { FileConceptStore } = require("../src/store");

function write(root, relativePath, text) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
}

function concept(title, extra) {
  return [
    "---",
    "type: Reference",
    `title: ${title}`,
    ...(extra || []),
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-root-mode-"));
  write(root, "index.md", [
    "---",
    "okf_version: \"0.2\"",
    "---",
    "",
    "# Root",
    "",
    "- [Alpha](alpha.md)",
    "- [Beta](nested/beta.md)",
    "",
  ].join("\n"));
  write(root, "alpha.md", concept("Alpha", [
    "relations:",
    "  - type: supervises",
    "    target: /nested/beta.md",
  ]));
  write(root, "nested/beta.md", concept("Beta"));
  return root;
}

function git(repository, args) {
  const result = spawnSync("git", ["-C", repository].concat(args), {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

test("standalone roots use portable Concept IDs and path-valued extension relations", () => {
  const root = makeRoot();
  const index = buildIndex([root], { allowCustomRelationTypes: true });
  assert.equal(index.validForProject, true);
  const alpha = resolveConcept(index, "alpha");
  const beta = resolveConcept(index, "/nested/beta.md");
  assert.equal(alpha.conceptId, "alpha");
  assert.equal(beta.conceptId, "nested/beta");
  assert.equal(resolveConcept(index, beta.uri), beta);
  assert.equal(index.edges.some((edge) => (
    edge.kind === "relation"
    && edge.relationType === "supervises"
    && edge.source === alpha.uri
    && edge.target === beta.uri
    && !edge.broken
  )), true);
});

test("root discovery wins before legacy project discovery", () => {
  const root = makeRoot();
  const nested = path.join(root, "nested", "deeper");
  fs.mkdirSync(nested, { recursive: true });
  write(root, "okf.project.yaml", "project: legacy\nbundles:\n  - root: .\n");
  const args = discoverProject(parseArgs(["validate"]), nested);
  assert.equal(args.root, root);
  assert.equal(args.project, null);
});

test("root mode configures review-only authoring without a project manifest", async () => {
  const root = makeRoot();
  const store = FileConceptStore.fromRoot(root);
  const service = new ConceptAuthoringService(store);
  const validation = service.validateConcept({
    path: "new.md",
    frontmatter: { type: "Reference", title: "New" },
    body: "# New",
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.bundle, path.basename(root));

  const server = await createServerAsync([], { rootPath: root, allowAuthoring: true });
  const tools = await server.handle({ method: "tools/list", params: {} });
  const proposeTool = tools.tools.find((entry) => entry.name === "okf_propose_concept");
  assert.ok(proposeTool);
  assert.equal(proposeTool.inputSchema.required.includes("bundle"), false);
  const proposed = await server.handle({
    method: "tools/call",
    params: {
      name: "okf_propose_concept",
      arguments: {
        path: "new.md",
        frontmatter: { type: "Reference", title: "New" },
        body: "# New",
      },
    },
  });
  assert.equal(JSON.parse(proposed.content[0].text).created, true);
  const migration = await server.handle({
    method: "tools/call",
    params: { name: "check_v02_migration", arguments: {} },
  });
  assert.equal(JSON.parse(migration.content[0].text).bundle, path.basename(root));
  const read = await server.handle({
    method: "tools/call",
    params: { name: "get_concept", arguments: { id: "nested/beta" } },
  });
  assert.match(read.content[0].text, /"conceptId": "nested\/beta"/);
});

test("MCP reads only a declared pinned Git source through an explicit mapping", async (t) => {
  const root = makeRoot();
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "okf-root-source-repo-"));
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  git(repository, ["init", "--quiet"]);
  write(repository, "src/example.js", "first\nsecond\nthird\n");
  git(repository, ["add", "--all"]);
  git(repository, [
    "-c", "user.name=OKF Test", "-c", "user.email=okf@example.invalid",
    "commit", "--quiet", "-m", "source",
  ]);
  const revision = git(repository, ["rev-parse", "HEAD"]);
  write(root, "repositories/example.md", [
    "---",
    "type: Git Repository",
    "title: Example repository",
    "resource: ssh://git@example.invalid/team/example.git",
    "---",
    "",
    "# Example repository",
    "",
  ].join("\n"));
  write(root, "implementation.md", [
    "---",
    "type: Reference",
    "title: Implementation",
    "sources:",
    "  - id: implementation",
    "    resource: /repositories/example.md",
    "    git:",
    `      revision: ${revision}`,
    "      path: src/example.js",
    "      lines:",
    "        from: 2",
    "        to: 3",
    "---",
    "",
    "# Implementation",
    "",
  ].join("\n"));

  const server = await createServerAsync([], {
    rootPath: root,
    repositoryMappings: new Map([["repositories/example", repository]]),
  });
  const response = await server.handle({
    method: "tools/call",
    params: {
      name: "read_git_source",
      arguments: { concept: "implementation", sourceId: "implementation" },
    },
  });
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.available, true);
  assert.equal(result.content, "second\nthird\n");
  assert.equal(result.repository.conceptId, "repositories/example");
  assert.match(result.sha256, /^sha256:[0-9a-f]{64}$/);
});
