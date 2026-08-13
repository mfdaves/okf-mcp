"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { ConceptAuthoringService } = require("../src/authoring");
const { parseArgs, discoverProject } = require("../src/cli");
const { buildIndex, recoverConceptLocator, resolveConcept } = require("../src/indexer");
const { FileConceptStore } = require("../src/store");
const { callJson, connectMcp } = require("./mcp-client");

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
  assert.equal(resolveConcept(index, "okf://nested/beta.md"), beta);
  assert.equal(index.edges.some((edge) => (
    edge.kind === "relation"
    && edge.relationType === "supervises"
    && edge.source === alpha.uri
    && edge.target === beta.uri
    && !edge.broken
  )), true);
});

test("URI-shaped portable locators remain unique and never override canonical identity", (t) => {
  const domain = fs.mkdtempSync(path.join(os.tmpdir(), "okf-domain-"));
  const aggregate = fs.mkdtempSync(path.join(os.tmpdir(), "okf-aggregate-"));
  const duplicate = fs.mkdtempSync(path.join(os.tmpdir(), "okf-duplicate-"));
  t.after(() => [domain, aggregate, duplicate].forEach((root) => {
    fs.rmSync(root, { recursive: true, force: true });
  }));
  write(domain, "other.md", concept("Other"));
  write(aggregate, "domain/guide.md", concept("Aggregate guide"));
  write(duplicate, "domain/guide.md", concept("Duplicate guide"));

  const unique = buildIndex([{ id: "domain", root: domain }, { id: "aggregate", root: aggregate }]);
  assert.equal(resolveConcept(unique, "okf://domain/guide.md"), null);
  assert.equal(resolveConcept(buildIndex([{ id: "aggregate", root: aggregate }]), "okf://domain/guide.md").uri,
    "okf://aggregate/domain/guide");
  write(domain, "guide.md", concept("Canonical guide"));
  const collision = buildIndex([{ id: "domain", root: domain }, { id: "aggregate", root: aggregate }]);
  assert.equal(resolveConcept(collision, "okf://domain/guide#section").uri, "okf://domain/guide");
  assert.equal(resolveConcept(collision, "OKF://domain/guide"), null);
  assert.equal(resolveConcept(collision, "okf:///domain/guide"), null);
  assert.equal(recoverConceptLocator(collision, "okf://domain/former/guide", { bundle: "aggregate" })
    .retryWith.uri, "okf://domain/guide");
  const ambiguous = buildIndex([{ id: "aggregate", root: aggregate }, { id: "duplicate", root: duplicate }]);
  assert.equal(resolveConcept(ambiguous, "okf://domain/guide.md"), null);
  const recovery = recoverConceptLocator(ambiguous, "okf://domain/guide.md");
  assert.equal(recovery.status, "ambiguous");
  assert.equal(recovery.retryWith, undefined);
  assert.equal(recoverConceptLocator(collision, "OKF://domain/guide").status, "not_found");

  write(aggregate, "domain/bar.md", concept("Valid bar"));
  write(duplicate, "domain/bar.md", "---\ntitle: Invalid bar\n---\n\n# Invalid bar\n");
  const invalidPortable = buildIndex([{ id: "aggregate", root: aggregate }, { id: "owner", root: duplicate }]);
  assert.equal(recoverConceptLocator(invalidPortable, "okf://domain/bar.md").status, "ambiguous");

  write(domain, "invalid-a.md", "---\nid: okf://domain/alias\ntitle: Invalid A\n---\n");
  write(duplicate, "invalid-b.md", "---\nid: okf://domain/alias\ntitle: Invalid B\n---\n");
  write(aggregate, "domain/alias.md", concept("Valid alias"));
  const invalidAlias = buildIndex([
    { id: "aggregate", root: aggregate }, { id: "owner-a", root: domain }, { id: "owner-b", root: duplicate },
  ]);
  assert.equal(recoverConceptLocator(invalidAlias, "okf://domain/alias").status, "ambiguous");
  assert.equal(recoverConceptLocator(invalidAlias, "okf://domain/alias").retryWith, undefined);

  write(aggregate, "domain/invalid-only.md", "---\ntitle: Invalid only\n---\n");
  const invalidOnly = buildIndex([{ id: "aggregate", root: aggregate }]);
  assert.equal(recoverConceptLocator(invalidOnly, "okf://domain/invalid-only.md").status, "not_found");
  assert.equal(recoverConceptLocator(invalidOnly, "okf://domain/invalid-only.md").retryWith, undefined);
  assert.equal(recoverConceptLocator(invalidOnly, "okf://index.md").retryWith, undefined);
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

test("root mode configures review-only authoring without a project manifest", async (t) => {
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

  const { client } = await connectMcp(t, [], { rootPath: root, allowAuthoring: true });
  const tools = await client.listTools();
  const proposeTool = tools.tools.find((entry) => entry.name === "okf_propose_concept");
  assert.ok(proposeTool);
  assert.equal(proposeTool.inputSchema.required.includes("bundle"), false);
  const proposed = await callJson(client, "okf_propose_concept", {
    path: "new.md",
    frontmatter: { type: "Reference", title: "New" },
    body: "# New",
  });
  assert.equal(proposed.payload.created, true);
  const migration = await callJson(client, "check_v02_migration");
  assert.equal(migration.payload.bundle, path.basename(root));
  const read = await callJson(client, "get_concept", { id: "nested/beta" });
  assert.equal(read.payload.conceptId, "nested/beta");
  const compatible = await callJson(client, "get_concept", { uri: "okf://nested/beta.md" });
  assert.equal(compatible.payload.uri, read.payload.uri);
  fs.mkdirSync(path.join(root, "relocated"), { recursive: true });
  fs.renameSync(path.join(root, "nested/beta.md"), path.join(root, "relocated/beta.md"));
  const stale = await callJson(client, "get_concept", { uri: read.payload.uri });
  assert.equal(stale.result.isError, true);
  assert.equal(stale.payload.code, "concept_not_found");
  assert.equal(stale.payload.details.recovery.retryWith.uri,
    `okf://${path.basename(root)}/relocated/beta`);
});

test("MCP reads only a declared pinned Git source through an explicit mapping", async (t) => {
  const root = makeRoot();
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "okf-root-source-repo-"));
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  git(repository, ["init", "--quiet"]);
  write(repository, "src/example.js", "first\nsecond\nthird\n");
  write(repository, "src/at-limit.txt", "z".repeat(65536));
  write(repository, "src/large.txt", "x".repeat(65537));
  write(repository, "src/too-large.txt", "y".repeat(1048577));
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
    "  - id: at-limit",
    "    resource: /repositories/example.md",
    "    git:",
    `      revision: ${revision}`,
    "      path: src/at-limit.txt",
    "  - id: large",
    "    resource: /repositories/example.md",
    "    git:",
    `      revision: ${revision}`,
    "      path: src/large.txt",
    "  - id: too-large",
    "    resource: /repositories/example.md",
    "    git:",
    `      revision: ${revision}`,
    "      path: src/too-large.txt",
    "      lines: { from: 1, to: 1 }",
    "---",
    "",
    "# Implementation",
    "",
  ].join("\n"));

  const { client } = await connectMcp(t, [], {
    rootPath: root,
    repositoryMappings: new Map([["repositories/example", repository]]),
  });
  const { payload: result } = await callJson(client, "read_git_source", {
    concept: "implementation",
    sourceId: "implementation",
  });
  assert.equal(result.available, true);
  assert.equal(result.content, "second\nthird\n");
  assert.equal(result.repository.conceptId, "repositories/example");
  assert.match(result.sha256, /^sha256:[0-9a-f]{64}$/);

  const atLimit = await callJson(client, "read_git_source", {
    concept: "implementation",
    sourceId: "at-limit",
  });
  assert.equal(atLimit.result.isError, undefined);
  assert.equal(atLimit.payload.content.length, 65536);

  const large = await callJson(client, "read_git_source", {
    concept: "implementation",
    sourceId: "large",
  });
  assert.equal(large.result.isError, true);
  assert.equal(large.payload.code, "git_source_too_large");
  assert.deepEqual(large.payload.details, {
    actualBytes: 65537,
    limitBytes: 65536,
    maxAllowedBytes: 1048576,
    retryable: true,
  });

  const retried = await callJson(client, "read_git_source", {
    concept: "implementation",
    sourceId: "large",
    maxContentBytes: 65537,
  });
  assert.equal(retried.result.isError, undefined);
  assert.equal(retried.payload.content.length, 65537);

  const tooLarge = await callJson(client, "read_git_source", {
    concept: "implementation",
    sourceId: "too-large",
  });
  assert.equal(tooLarge.result.isError, true);
  assert.deepEqual(tooLarge.payload.details, {
    actualBytes: 1048577,
    limitBytes: 65536,
    maxAllowedBytes: 1048576,
    retryable: false,
  });
});
