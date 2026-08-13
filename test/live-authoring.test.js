"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { ConceptAuthoringService } = require("../src/authoring");
const { LiveAuthoringService } = require("../src/live-authoring");
const { createMcpServer } = require("../src/mcp-server");
const { FileConceptStore } = require("../src/store");
const { callJson, connectMcp } = require("./mcp-client");

function write(root, relativePath, text) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
}

function concept(title, extra, body) {
  return [
    "---",
    "type: Reference",
    `title: ${title}`,
    ...(extra || []),
    "---",
    "",
    body || `# ${title}`,
    "",
  ].join("\n");
}

function makeRoot(alphaExtra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-live-authoring-"));
  write(root, "index.md", [
    "---",
    "okf_version: \"0.2\"",
    "---",
    "",
    "# Test catalog",
    "",
    "- [Alpha](alpha.md)",
    "",
  ].join("\n"));
  write(root, "alpha.md", concept("Alpha", [
    "description: Existing concept",
    "tags: [existing, remove-me]",
    "x-retained: yes",
    ...(alphaExtra || []),
  ]));
  return root;
}

function fixedService(root, options) {
  return new LiveAuthoringService(FileConceptStore.fromRoot(root), Object.assign({
    actor: "openai/gpt-5.6",
    now: () => new Date("2026-08-13T12:34:56.000Z"),
  }, options || {}));
}

function git(repository, args) {
  const result = spawnSync("git", ["-C", repository].concat(args), {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function initializeGit(root) {
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "OKF Test"]);
  git(root, ["config", "user.email", "okf@example.invalid"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
}

test("live MCP applies a cross-linked create batch and exposes it immediately", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { client } = await connectMcp(t, [], {
    rootPath: root,
    allowWrite: true,
    actor: "openai/gpt-5.6",
  });
  const listed = await client.listTools();
  const applyTool = listed.tools.find((entry) => entry.name === "okf_apply_changes");
  assert.ok(applyTool);
  assert.equal(applyTool.annotations.destructiveHint, true);

  const result = await callJson(client, "okf_apply_changes", {
    changes: [
      {
        op: "create",
        type: "Knowledge Note",
        title: "First Note",
        tags: ["agent", "test"],
        sources: ["/alpha.md"],
        relations: [{ type: "related_to", target: "/knowledge-note/second-note.md" }],
      },
      {
        op: "create",
        type: "Knowledge Note",
        title: "Second Note",
        body: "# Second Note\n\nCreated in the same batch.",
        relations: [{ type: "related_to", target: "/knowledge-note/first-note.md" }],
      },
    ],
  });
  assert.equal(result.result.isError, undefined);
  assert.equal(result.payload.applied, true);
  assert.equal(result.payload.status, "applied");
  assert.equal(result.payload.changes.length, 2);
  assert.equal(result.payload.generated.by, "openai/gpt-5.6");
  assert.match(result.payload.generated.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(fs.existsSync(path.join(root, ".okf-proposals")), false);

  const first = await callJson(client, "get_concept", { id: "knowledge-note/first-note" });
  assert.equal(first.payload.title, "First Note");
  assert.deepEqual(first.payload.tags, ["agent", "test"]);
  assert.equal(first.payload.signals.sourceCount, 1);
  assert.equal(first.payload.signals.generated.by, "openai/gpt-5.6");
  const neighbors = await callJson(client, "get_neighbors", { uri: first.payload.uri });
  assert.equal(neighbors.payload.outbound.some((entry) => (
    entry.edge.target === `okf://${path.basename(root)}/knowledge-note/second-note`
  )), true);
});

test("live updates patch collections, preserve extensions, and reject no-ops", async (t) => {
  const root = makeRoot([
    "sources: [repo://example/original.js]",
    "generated:",
    "  by: human:fixture",
    "  at: 2026-08-12T12:00:00.000Z",
    "  model_revision: retained",
  ]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { client } = await connectMcp(t, [], {
    rootPath: root,
    allowWrite: true,
    actor: "openai/gpt-5.6",
  });
  const uri = `okf://${path.basename(root)}/alpha`;
  const applied = await callJson(client, "okf_apply_changes", {
    changes: [{
      op: "update",
      uri,
      title: "Alpha Updated",
      tags: { remove: ["remove-me", "new"], add: ["new"] },
      sources: {
        remove: ["repo://example/original.js"],
        add: [
          { resource: "repo://example/replaced.js", credibility: "low" },
          { id: "primary", resource: "repo://example/src/alpha.js" },
        ],
      },
      relations: { add: [{ type: "related_to", target: "/alpha.md" }] },
      metadata: { status: "stable", obsolete: true },
      removeMetadataKeys: ["obsolete"],
    }],
  });
  assert.equal(applied.payload.applied, true);
  const read = await callJson(client, "get_concept", { uri });
  assert.equal(read.payload.title, "Alpha Updated");
  assert.deepEqual(read.payload.tags, ["existing", "new"]);
  assert.equal(read.payload.frontmatter["x-retained"], "yes");
  assert.equal(read.payload.frontmatter.obsolete, undefined);
  assert.deepEqual(read.payload.frontmatter.sources, [
    { resource: "repo://example/replaced.js", credibility: "low" },
    { id: "primary", resource: "repo://example/src/alpha.js" },
  ]);
  assert.equal(read.payload.signals.generated.by, "openai/gpt-5.6");
  assert.equal(read.payload.frontmatter.generated.model_revision, "retained");

  const replaced = await callJson(client, "okf_apply_changes", {
    changes: [{
      op: "update",
      uri,
      sources: {
        add: [{ resource: "repo://example/replaced.js", credibility: "high" }],
      },
    }],
  });
  assert.equal(replaced.payload.applied, true);
  const replacedRead = await callJson(client, "get_concept", { uri });
  assert.deepEqual(replacedRead.payload.frontmatter.sources, [
    { resource: "repo://example/replaced.js", credibility: "high" },
    { id: "primary", resource: "repo://example/src/alpha.js" },
  ]);

  const unchangedAt = replacedRead.payload.signals.generated.at;
  const noOp = await callJson(client, "okf_apply_changes", {
    changes: [{ op: "update", uri, title: "Alpha Updated" }],
  });
  assert.equal(noOp.result.isError, true);
  assert.match(noOp.result.content[0].text, /no effective changes/i);
  const reread = await callJson(client, "get_concept", { uri });
  assert.equal(reread.payload.signals.generated.at, unchangedAt);
});

test("a mixed create/update batch shares one server timestamp", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = fixedService(root);
  const result = await service.applyChanges({
    changes: [
      {
        op: "update",
        uri: `okf://${path.basename(root)}/alpha`,
        relations: { add: [{ type: "related_to", target: "/reference/new.md" }] },
      },
      {
        op: "create",
        type: "Reference",
        title: "New",
        sources: ["/alpha.md"],
      },
    ],
  });
  assert.equal(result.applied, true);
  assert.equal(result.generated.at, "2026-08-13T12:34:56.000Z");
  const index = service.store.getIndex();
  for (const id of ["alpha", "reference/new"]) {
    assert.equal(index.byConceptId.get(id).frontmatter.generated.at, result.generated.at);
    assert.equal(index.byConceptId.get(id).frontmatter.generated.by, "openai/gpt-5.6");
  }
});

test("live validation prevents semantic duplicates and recovers stale update locators", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "beta.md", concept("Beta"));
  const service = fixedService(root);
  const bundle = path.basename(root);

  const duplicate = await service.validateChanges({
    changes: [{ op: "create", path: "alternate.md", type: "Reference", title: " alpha " }],
  });
  assert.equal(duplicate.code, "concept_already_exists");
  assert.equal(duplicate.details.retryWith.uri, `okf://${bundle}/alpha`);
  assert.equal(fs.existsSync(path.join(root, "alternate.md")), false);

  const differentType = await service.validateChanges({
    changes: [{ op: "create", path: "guide-alpha.md", type: "Guide", title: "Alpha" }],
  });
  assert.equal(differentType.valid, true);

  const peerDuplicate = await service.validateChanges({
    changes: ["one", "two"].map((name) => ({
      op: "create", path: `${name}.md`, type: "Guide", title: "Same Batch",
    })),
  });
  assert.equal(peerDuplicate.code, "concept_already_exists");
  assert.equal(peerDuplicate.details.reason, "same_batch_type_title");

  const converged = await service.validateChanges({
    changes: [
      { op: "update", uri: `okf://${bundle}/alpha`, title: "Converged" },
      { op: "create", path: "converged.md", type: "Reference", title: "Converged" },
    ],
  });
  assert.equal(converged.code, "concept_already_exists");
  assert.equal(converged.details.reason, "same_batch_type_title");

  const updatesConverged = await service.validateChanges({
    changes: [
      { op: "update", uri: `okf://${bundle}/alpha`, title: "Shared" },
      { op: "update", uri: `okf://${bundle}/beta`, title: "Shared" },
    ],
  });
  assert.equal(updatesConverged.code, "concept_already_exists");

  const reused = await service.validateChanges({
    changes: [
      { op: "update", uri: `okf://${bundle}/alpha`, title: "Renamed Alpha" },
      { op: "create", path: "replacement-alpha.md", type: "Reference", title: "Alpha" },
    ],
  });
  assert.equal(reused.valid, true);

  const stale = await service.validateChanges({
    changes: [{
      op: "update",
      uri: `okf://${bundle}/former/location/alpha`,
      tags: { add: ["recovered"] },
    }],
  });
  assert.equal(stale.code, "concept_not_found");
  assert.equal(stale.details.recovery.retryWith.uri, `okf://${bundle}/alpha`);
});

test("an invalid batch writes nothing and process-generated targets stay protected", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "managed.md", concept("Managed", [
    "generated:",
    "  by: process:fixture-generator",
  ]));
  write(root, "generated-flag.md", concept("Generated Flag", [
    "generated_file: true",
  ]));
  const service = fixedService(root);
  const suggestion = new ConceptAuthoringService(service.store).suggestConceptPath({
    type: "Reference", title: "Generated Flag",
  });
  assert.equal(suggestion.recommendedOperation, "change_generator");
  const rejected = await service.applyChanges({
    changes: [
      { op: "create", path: "batch/good.md", type: "Reference", title: "Good" },
      {
        op: "create",
        path: "batch/bad.md",
        type: "Reference",
        title: "Bad",
        relations: [{ type: "related_to", target: "/missing.md" }],
      },
    ],
  });
  assert.equal(rejected.applied, false);
  assert.equal(rejected.status, "rejected");
  assert.equal(fs.existsSync(path.join(root, "batch")), false);

  await assert.rejects(
    service.applyChanges({
      changes: [{
        op: "update",
        uri: `okf://${path.basename(root)}/managed`,
        title: "Overwrite",
      }],
    }),
    /must be changed through its generator/,
  );
  await assert.rejects(
    service.applyChanges({
      changes: [{
        op: "update",
        uri: `okf://${path.basename(root)}/generated-flag`,
        title: "Overwrite",
      }],
    }),
    /must be changed through its generator/,
  );
  assert.match(fs.readFileSync(path.join(root, "managed.md"), "utf8"), /title: Managed/);
});

test("configured generator outputs and computation contracts cannot be authored live", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "okf-live-project-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const bundle = path.join(projectRoot, "bundle");
  fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
  fs.mkdirSync(bundle, { recursive: true });
  write(bundle, "index.md", "---\nokf_version: \"0.2\"\n---\n\n# Project\n");
  write(bundle, "generated/owned.md", concept("Generated Output"));
  write(projectRoot, "okf.project.yaml", [
    "project: LiveProject",
    "bundles:",
    "  - id: live",
    "    root: bundle",
    "    exclude:",
    "      - blocked/**",
    "plugins:",
    "  - name: docs",
    "    type: filesystem",
    "    root: source",
    "    output: bundle/generated",
    "    bundle: live",
    "",
  ].join("\n"));
  const service = new LiveAuthoringService(
    FileConceptStore.fromProject(path.join(projectRoot, "okf.project.yaml")),
    { actor: "openai/gpt-5.6" },
  );
  const stale = await service.validateChanges({
    bundle: "live",
    changes: [{ op: "update", uri: "okf://live/archive/owned", tags: { add: ["reviewed"] } }],
  });
  assert.equal(stale.details.recovery.recommendedOperation, "change_generator");
  assert.equal(stale.details.recovery.retryWith, undefined);
  await assert.rejects(
    service.applyChanges({
      bundle: "live",
      changes: [{ op: "create", path: "generated/new.md", type: "Reference", title: "New" }],
    }),
    /configured generator output/,
  );
  await assert.rejects(
    service.applyChanges({
      bundle: "live",
      changes: [{ op: "create", type: "Attested Computation", title: "Unsafe" }],
    }),
    /cannot create Attested Computation/,
  );
  await assert.rejects(
    service.applyChanges({
      bundle: "live",
      changes: [{ op: "create", path: "blocked/new.md", type: "Reference", title: "Blocked" }],
    }),
    /excluded by the bundle policy/,
  );
});

test("live authoring rejects reserved metadata, duplicate targets, oversized batches, and missing actors", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = fixedService(root);
  await assert.rejects(
    service.applyChanges({
      changes: [{
        op: "create",
        type: "Reference",
        title: "Managed metadata",
        metadata: { generated: { by: "human:spoofed" } },
      }],
    }),
    /generated is server-managed/,
  );
  await assert.rejects(
    service.applyChanges({
      changes: [
        { op: "create", path: "duplicate.md", type: "Reference", title: "One" },
        { op: "create", path: "duplicate.md", type: "Reference", title: "Two" },
      ],
    }),
    /same concept more than once/,
  );
  await assert.rejects(
    service.applyChanges({
      changes: Array.from({ length: 101 }, (_, index) => ({
        op: "create",
        path: `many/${index}.md`,
        type: "Reference",
        title: `Concept ${index}`,
      })),
    }),
    /1 through 100/,
  );
  await assert.rejects(
    createMcpServer([], { rootPath: root, allowWrite: true }),
    /actor must be a non-empty string/,
  );
  assert.equal(fs.existsSync(path.join(root, "duplicate.md")), false);
  assert.equal(fs.existsSync(path.join(root, "many")), false);
});

test("post-write validation failure rolls the complete batch back", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  class FailingValidationService extends LiveAuthoringService {
    constructor(store) {
      super(store, { actor: "openai/gpt-5.6" });
      this.validationCalls = 0;
    }

    validationResult(index, candidates) {
      this.validationCalls += 1;
      if (this.validationCalls === 2) {
        return { valid: false, diagnostics: [{ code: "injected_failure" }] };
      }
      return super.validationResult(index, candidates);
    }
  }
  const service = new FailingValidationService(FileConceptStore.fromRoot(root));
  const result = await service.applyChanges({
    changes: [
      { op: "create", path: "rollback/one.md", type: "Reference", title: "One" },
      { op: "create", path: "rollback/two.md", type: "Reference", title: "Two" },
    ],
  });
  assert.equal(result.applied, false);
  assert.equal(result.status, "rolled_back");
  assert.equal(fs.existsSync(path.join(root, "rollback")), false);
});

test("a publication race restores every file already changed by the batch", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const alphaPath = path.join(root, "alpha.md");
  const originalAlpha = fs.readFileSync(alphaPath, "utf8");
  class RacingService extends LiveAuthoringService {
    assertRevisions(staged) {
      super.assertRevisions(staged);
      fs.writeFileSync(staged[2].target.absolutePath, "external writer\n", "utf8");
    }
  }
  const service = new RacingService(FileConceptStore.fromRoot(root), {
    actor: "openai/gpt-5.6",
  });
  await assert.rejects(
    service.applyChanges({
      changes: [
        { op: "update", uri: `okf://${path.basename(root)}/alpha`, title: "Changed" },
        { op: "create", path: "race/one.md", type: "Reference", title: "One" },
        { op: "create", path: "race/two.md", type: "Reference", title: "Two" },
      ],
    }),
    (error) => error && error.code === "EEXIST",
  );
  assert.equal(fs.readFileSync(alphaPath, "utf8"), originalAlpha);
  assert.equal(fs.existsSync(path.join(root, "race/one.md")), false);
  assert.equal(fs.readFileSync(path.join(root, "race/two.md"), "utf8"), "external writer\n");
});

test("Git policy commits a clean batch, rejects dirty state, and preserves commit failures", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const service = fixedService(root, { gitCommit: true });
  const committed = await service.applyChanges({
    message: "docs(okf): live fixture",
    changes: [{ op: "create", path: "git/committed.md", type: "Reference", title: "Committed" }],
  });
  assert.equal(committed.applied, true);
  assert.equal(committed.git.committed, true);
  assert.match(committed.git.commitSha, /^[0-9a-f]{40}$/);
  assert.equal(git(root, ["log", "-1", "--pretty=%s"]), "docs(okf): live fixture");

  write(root, "dirty.txt", "dirty\n");
  await assert.rejects(
    service.applyChanges({
      changes: [{ op: "create", path: "dirty-blocked/new.md", type: "Reference", title: "Blocked" }],
    }),
    /worktree must be completely clean/,
  );
  assert.equal(fs.existsSync(path.join(root, "dirty-blocked")), false);
  fs.unlinkSync(path.join(root, "dirty.txt"));

  const realSpawnSync = spawnSync;
  const failingCommit = fixedService(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (args.includes("commit-tree")) {
        return { status: 1, stdout: "", stderr: "simulated commit failure" };
      }
      return realSpawnSync(command, args, options);
    },
  });
  const uncommitted = await failingCommit.applyChanges({
    changes: [{ op: "create", path: "git/uncommitted.md", type: "Reference", title: "Uncommitted" }],
  });
  assert.equal(uncommitted.applied, true);
  assert.equal(uncommitted.status, "applied_uncommitted");
  assert.equal(uncommitted.git.committed, false);
  assert.match(uncommitted.git.error, /simulated commit failure/);
  assert.equal(fs.existsSync(path.join(root, "git/uncommitted.md")), true);
});

test("Git policy treats a non-Git catalog as a normal uncommitted apply", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await fixedService(root, { gitCommit: true }).applyChanges({
    changes: [{ op: "create", path: "plain.md", type: "Reference", title: "Plain" }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.status, "applied");
  assert.deepEqual(result.git, {
    enabled: true,
    repository: false,
    repositoryRoot: null,
    committed: false,
    commitState: "not_repository",
    persistence: "working_tree",
    reason: "not_git_repository",
  });
});
