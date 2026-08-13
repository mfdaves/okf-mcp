"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { LiveAuthoringService } = require("../src/live-authoring");
const { FileConceptStore } = require("../src/store");
const { callJson, connectMcp } = require("./mcp-client");

const ACTOR = "openai/gpt-5.6";
const GENERATED_AT = "2026-08-13T12:34:56.000Z";
const BODY_SENTINEL = "SENTINEL_BODY_CONTENT";

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function git(repository, args) {
  const result = spawnSync("git", ["-C", repository].concat(args), {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return String(result.stdout || "").trim();
}

function makeGitRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-live-agent-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "index.md", [
    "---",
    "okf_version: \"0.2\"",
    "---",
    "",
    "# Live agent fixture",
    "",
    "- [Alpha](alpha.md)",
    "- [Source](references/source.md)",
    "- [Legacy](references/legacy.md)",
    "- [Managed](managed.md)",
    "",
  ].join("\n"));
  write(root, "references/source.md", [
    "---",
    "type: Reference",
    "title: Source",
    "---",
    "",
    "# Source",
    "",
  ].join("\n"));
  write(root, "references/legacy.md", [
    "---",
    "type: Reference",
    "title: Legacy",
    "---",
    "",
    "# Legacy",
    "",
  ].join("\n"));
  write(root, "managed.md", [
    "---",
    "type: Reference",
    "title: Managed",
    "generated:",
    "  by: process:fixture-generator",
    "  at: 2026-08-01T00:00:00.000Z",
    "---",
    "",
    "# Managed",
    "",
  ].join("\n"));
  write(root, "alpha.md", [
    "---",
    "type: Reference",
    "title: Alpha",
    "description: Existing concept",
    "tags: [existing, shared, remove-me]",
    "x-retained: yes",
    "sources:",
    "  - id: primary",
    "    resource: /references/source.md",
    "  - id: legacy",
    "    resource: /references/legacy.md",
    "relations:",
    "  - type: related_to",
    "    target: /references/source.md",
    "    label: old label",
    "  - type: depends_on",
    "    target: /references/legacy.md",
    "---",
    "",
    "# Alpha",
    "",
    "Old body.",
    "",
  ].join("\n"));

  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "OKF Agent Test"]);
  git(root, ["config", "user.email", "okf-agent@example.invalid"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return root;
}

function primaryPayload(bundleId) {
  return {
    bundle: bundleId,
    message: "docs(okf): add incident handoff",
    changes: [
      {
        op: "create",
        type: "Agent Guide",
        title: "Incident Handoff",
        description: "Agent-facing incident handoff.",
        tags: ["agents", "handoff", "agents"],
        sources: [{ id: "orientation", resource: "/references/source.md" }],
        relations: [{ type: "related_to", target: "/alpha.md" }],
        body: `# Incident Handoff\n\n${BODY_SENTINEL}`,
      },
      updateChange(bundleId),
    ],
  };
}

function updateChange(bundleId) {
  return {
    op: "update",
    uri: `okf://${bundleId}/alpha`,
    description: "Updated by the structured workflow.",
    tags: {
      remove: ["remove-me", "shared"],
      add: ["agents", "shared"],
    },
    sources: {
      remove: [{ id: "legacy" }],
      add: [{ id: "primary", resource: "/agent-guide/incident-handoff.md" }],
    },
    relations: {
      remove: [{ type: "depends_on", target: "/references/legacy.md" }],
      add: [
        {
          type: "related_to",
          target: "/references/source.md",
          label: "replacement label",
        },
        {
          type: "depends_on",
          target: "/agent-guide/incident-handoff.md",
        },
      ],
    },
    metadata: { review_state: "draft" },
    removeMetadataKeys: ["x-retained"],
    body: "# Alpha\n\nUpdated without composing YAML.",
  };
}

function values(effect) {
  assert.equal(effect.omitted, 0);
  return effect.values;
}

function assertEffects(receipt) {
  const create = receipt.changes.find((change) => change.op === "create");
  const update = receipt.changes.find((change) => change.op === "update");
  assert.ok(create);
  assert.ok(update);

  assert.equal(create.path, "agent-guide/incident-handoff.md");
  assert.equal(create.effects.bodyChanged, true);
  assert.deepEqual(values(create.effects.tags.added), ["agents", "handoff"]);
  assert.deepEqual(values(create.effects.sources.added), ["id:orientation"]);
  assert.deepEqual(
    values(create.effects.relations.added),
    ["related_to\u0000/alpha.md"],
  );
  assert.equal(create.effects.beforeRevision, null);
  assert.match(create.effects.afterRevision, /^sha256:[0-9a-f]{64}$/);
  assert.equal(create.effects.bytesBefore, 0);
  assert.ok(create.effects.bytesAfter > 0);

  assert.equal(update.path, "alpha.md");
  assert.equal(update.effects.bodyChanged, true);
  assert.deepEqual(values(update.effects.tags.added), ["agents"]);
  assert.deepEqual(values(update.effects.tags.removed), ["remove-me"]);
  assert.deepEqual(values(update.effects.tags.updated), []);
  assert.deepEqual(values(update.effects.sources.added), []);
  assert.deepEqual(values(update.effects.sources.removed), ["id:legacy"]);
  assert.deepEqual(values(update.effects.sources.updated), ["id:primary"]);
  assert.deepEqual(
    values(update.effects.relations.added),
    ["depends_on\u0000/agent-guide/incident-handoff.md"],
  );
  assert.deepEqual(
    values(update.effects.relations.removed),
    ["depends_on\u0000/references/legacy.md"],
  );
  assert.deepEqual(
    values(update.effects.relations.updated),
    ["related_to\u0000/references/source.md"],
  );
  assert.deepEqual(values(update.effects.metadata.set), ["description", "review_state"]);
  assert.deepEqual(values(update.effects.metadata.removed), ["x-retained"]);
  assert.match(update.effects.beforeRevision, /^sha256:[0-9a-f]{64}$/);
  assert.match(update.effects.afterRevision, /^sha256:[0-9a-f]{64}$/);
}

function assertPolicyDiagnostic(receipt, code, message) {
  assert.equal(receipt.filesChanged, false);
  assert.equal(receipt.validation.valid, false);
  assert.ok(receipt.validation.diagnostics.some((diagnostic) => (
    diagnostic.code === code && message.test(diagnostic.message)
  )));
}

test("a fresh agent previews and applies one exact Git-backed concept batch", async (t) => {
  const root = makeGitRoot(t);
  const realRoot = fs.realpathSync(root);
  const bundleId = path.basename(root);
  const store = FileConceptStore.fromRoot(root);
  const liveAuthoringService = new LiveAuthoringService(store, {
    actor: ACTOR,
    gitCommit: true,
    now: () => new Date(GENERATED_AT),
  });
  const { client } = await connectMcp(t, [], {
    rootPath: root,
    allowWrite: true,
    actor: ACTOR,
    gitCommit: true,
    liveAuthoringService,
  });

  const tools = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
  const validateTool = tools.get("okf_validate_changes");
  const applyTool = tools.get("okf_apply_changes");
  assert.ok(validateTool);
  assert.ok(applyTool);
  assert.equal(validateTool.annotations.readOnlyHint, true);
  assert.equal(validateTool.annotations.destructiveHint, false);
  assert.equal(applyTool.annotations.destructiveHint, true);
  assert.deepEqual(validateTool.inputSchema, applyTool.inputSchema);

  const unsafeControlPath = await callJson(client, "okf_validate_changes", {
    bundle: bundleId,
    changes: [{
      op: "create",
      path: ".git/refs/heads/poison.md",
      type: "Reference",
      title: "Unsafe control path",
    }],
  });
  assert.equal(unsafeControlPath.result.isError, undefined);
  assert.equal(unsafeControlPath.payload.valid, false);
  assertPolicyDiagnostic(
    unsafeControlPath.payload,
    "unsafe_target_path",
    /hidden|safe relative/i,
  );
  assert.equal(fs.existsSync(path.join(root, ".git", "refs", "heads", "poison.md")), false);

  const payload = primaryPayload(bundleId);
  const createdPath = path.join(root, "agent-guide", "incident-handoff.md");
  const alphaPath = path.join(root, "alpha.md");
  const headBefore = git(root, ["rev-parse", "HEAD"]);
  const indexBefore = fs.readFileSync(path.join(root, ".git", "index"));
  const alphaBefore = fs.readFileSync(alphaPath);

  const preview = await callJson(client, "okf_validate_changes", payload);
  assert.equal(preview.result.isError, undefined);
  assert.deepEqual(preview.result.structuredContent, preview.payload);
  assert.equal(preview.payload.valid, true);
  assert.equal(preview.payload.readyToApply, true);
  assert.equal(preview.payload.status, "ready");
  assert.equal(preview.payload.filesChanged, false);
  assert.deepEqual(preview.payload.generated, { by: ACTOR, at: GENERATED_AT });
  assert.equal(preview.payload.target.bundleRoot, realRoot);
  assert.equal(preview.payload.target.repositoryRoot, realRoot);
  assert.deepEqual(preview.payload.target.absolutePaths.slice().sort(), [
    alphaPath,
    createdPath,
  ].sort());
  assert.equal(preview.payload.durability.state, "not_persisted");
  assert.equal(preview.payload.durability.persistence, "none");
  assert.equal(preview.payload.durability.filesChanged, false);
  assert.equal(preview.payload.durability.commitState, "not_attempted");
  assert.equal(preview.payload.durability.crashDurable, false);
  assert.equal(preview.payload.git.ready, true);
  assert.deepEqual(preview.payload.snapshot, {
    checkedAt: GENERATED_AT,
    timeOfCheck: true,
    generatedBy: ACTOR,
    graphValidation: "future_overlay",
  });
  assert.equal(preview.payload.preconditions.allSatisfied, true);
  assert.equal(preview.payload.preconditions.revisions.length, 2);
  assertEffects(preview.payload);
  const previewByPath = new Map(preview.payload.changes.map((change) => [change.path, change]));
  assert.equal(previewByPath.get("alpha.md").absolutePath, alphaPath);
  assert.equal(
    previewByPath.get("agent-guide/incident-handoff.md").absolutePath,
    createdPath,
  );
  preview.payload.preconditions.revisions.forEach((revision) => {
    const change = previewByPath.get(revision.path);
    assert.ok(change);
    assert.equal(revision.absolutePath, change.absolutePath);
    assert.equal(revision.baseRevision, change.effects.beforeRevision);
    assert.equal(revision.candidateRevision, change.effects.afterRevision);
  });
  assert.equal(JSON.stringify(preview.payload).includes(BODY_SENTINEL), false);

  assert.equal(fs.existsSync(createdPath), false);
  assert.deepEqual(fs.readFileSync(alphaPath), alphaBefore);
  assert.deepEqual(fs.readFileSync(path.join(root, ".git", "index")), indexBefore);
  assert.equal(fs.existsSync(path.join(root, ".git", "index.lock")), false);
  assert.equal(git(root, ["rev-parse", "HEAD"]), headBefore);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), "");

  const applied = await callJson(client, "okf_apply_changes", payload);
  assert.equal(applied.result.isError, undefined);
  assert.deepEqual(applied.result.structuredContent, applied.payload);
  assert.equal(applied.payload.applied, true);
  assert.equal(applied.payload.readyToApply, true);
  assert.equal(applied.payload.status, "applied");
  assert.equal(applied.payload.filesChanged, true);
  assert.deepEqual(applied.payload.generated, preview.payload.generated);
  assert.deepEqual(applied.payload.target, preview.payload.target);
  assert.deepEqual(applied.payload.changes, preview.payload.changes);
  assert.equal(applied.payload.durability.state, "git_committed");
  assert.equal(applied.payload.durability.persistence, "git_commit");
  assert.equal(applied.payload.durability.filesChanged, true);
  assert.equal(applied.payload.durability.commitState, "committed");
  assert.equal(applied.payload.durability.crashDurable, false);
  assert.equal(applied.payload.git.committed, true);
  assert.equal(applied.payload.git.commitState, "committed");
  assert.equal(applied.payload.git.persistence, "git_commit");
  assert.equal(applied.payload.git.repositoryRoot, realRoot);
  assert.match(applied.payload.git.commitSha, /^[0-9a-f]{40,64}$/);
  assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "2");
  assert.equal(git(root, ["log", "-1", "--pretty=%s"]), payload.message);
  assert.deepEqual(
    git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").sort(),
    ["agent-guide/incident-handoff.md", "alpha.md"],
  );
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), "");

  const created = await callJson(client, "get_concept", {
    uri: `okf://${bundleId}/agent-guide/incident-handoff`,
  });
  assert.equal(created.payload.title, "Incident Handoff");
  assert.deepEqual(created.payload.tags, ["agents", "handoff"]);
  assert.equal(created.payload.signals.generated.by, ACTOR);
  assert.equal(created.payload.signals.generated.at, GENERATED_AT);
  assert.deepEqual(created.payload.frontmatter.generated, { by: ACTOR, at: GENERATED_AT });
  assert.match(created.payload.body, new RegExp(BODY_SENTINEL));
  const alpha = await callJson(client, "get_concept", { uri: `okf://${bundleId}/alpha` });
  assert.deepEqual(alpha.payload.tags, ["existing", "agents", "shared"]);
  assert.equal(alpha.payload.frontmatter.review_state, "draft");
  assert.equal(Object.hasOwn(alpha.payload.frontmatter, "x-retained"), false);
  assert.equal(alpha.payload.signals.generated.by, ACTOR);
  assert.equal(alpha.payload.signals.generated.at, GENERATED_AT);
  assert.deepEqual(alpha.payload.frontmatter.generated, { by: ACTOR, at: GENERATED_AT });

  const neighbors = await callJson(client, "get_neighbors", { uri: created.payload.uri });
  assert.ok(neighbors.payload.outbound.some((entry) => (
    entry.edge.relationType === "related_to"
    && entry.edge.target === `okf://${bundleId}/alpha`
    && entry.edge.broken === false
  )));
  assert.ok(neighbors.payload.inbound.some((entry) => (
    entry.edge.relationType === "depends_on"
    && entry.edge.source === `okf://${bundleId}/alpha`
    && entry.edge.broken === false
  )));

  const noOp = await callJson(client, "okf_validate_changes", {
    bundle: bundleId,
    changes: [updateChange(bundleId)],
  });
  assert.equal(noOp.result.isError, undefined);
  assert.equal(noOp.payload.valid, false);
  assert.equal(noOp.payload.readyToApply, false);
  assert.equal(noOp.payload.status, "invalid");
  assertPolicyDiagnostic(noOp.payload, "no_effective_changes", /no effective changes/i);
  const headAfterApply = git(root, ["rev-parse", "HEAD"]);
  const noOpApply = await callJson(client, "okf_apply_changes", {
    bundle: bundleId,
    changes: [updateChange(bundleId)],
  });
  assert.equal(noOpApply.result.isError, true);
  assert.equal(noOpApply.payload.error, "Tool execution failed");
  assert.match(noOpApply.payload.message, /no effective changes/i);
  assert.equal(git(root, ["rev-parse", "HEAD"]), headAfterApply);

  const generated = await callJson(client, "okf_validate_changes", {
    bundle: bundleId,
    changes: [{
      op: "update",
      uri: `okf://${bundleId}/managed`,
      tags: { add: ["agent-test"] },
    }],
  });
  assert.equal(generated.result.isError, undefined);
  assert.equal(generated.payload.valid, false);
  assert.equal(generated.payload.readyToApply, false);
  assertPolicyDiagnostic(
    generated.payload,
    "generated_owner_protected",
    /changed through its generator/i,
  );

  write(root, "dirty.txt", "pre-existing user change\n");
  const dirty = await callJson(client, "okf_validate_changes", {
    bundle: bundleId,
    changes: [{
      op: "create",
      path: "dirty-check.md",
      type: "Reference",
      title: "Dirty Check",
    }],
  });
  assert.equal(dirty.result.isError, undefined);
  assert.equal(dirty.payload.valid, true);
  assert.equal(dirty.payload.readyToApply, false);
  assert.equal(dirty.payload.status, "blocked");
  assert.equal(dirty.payload.filesChanged, false);
  assert.equal(dirty.payload.validation.valid, true);
  assert.equal(dirty.payload.git.ready, false);
  assert.equal(dirty.payload.preconditions.git.ready, false);
  assert.ok(dirty.payload.preconditions.git.diagnostics.some((diagnostic) => (
    diagnostic.code === "git_worktree_dirty"
    && /worktree must be completely clean/i.test(diagnostic.message)
  )));
  assert.equal(dirty.payload.durability.state, "not_persisted");
  assert.equal(fs.existsSync(path.join(root, "dirty-check.md")), false);
  assert.equal(fs.readFileSync(path.join(root, "dirty.txt"), "utf8"), "pre-existing user change\n");
  assert.equal(git(root, ["rev-parse", "HEAD"]), headAfterApply);
});
