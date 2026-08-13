"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { LiveAuthoringService } = require("../src/live-authoring");
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

function makeRoot(extra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-live-correctness-"));
  write(root, "index.md", "---\nokf_version: \"0.2\"\n---\n\n# Test\n\n- [Alpha](alpha.md)\n");
  write(root, "alpha.md", concept("Alpha", extra));
  return root;
}

function service(root, options) {
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

test("validateChanges returns bounded target/effect receipts without touching files or Git", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let spawned = false;
  const authoring = service(root, {
    spawnSync() {
      spawned = true;
      throw new Error("Git must not be inspected when automatic commits are disabled.");
    },
  });
  const receipt = await authoring.validateChanges({
    changes: [{
      op: "create",
      type: "Reference",
      title: "Receipt",
      tags: Array.from({ length: 30 }, (_, index) => `tag-${index}`),
    }],
  });
  assert.equal(receipt.valid, true);
  assert.equal(receipt.applied, false);
  assert.equal(receipt.filesChanged, false);
  assert.equal(receipt.git.repositoryStatus, "not_inspected");
  assert.equal(spawned, false);
  assert.equal(receipt.target.bundleRoot, root);
  assert.equal(receipt.target.projectRoot, root);
  assert.equal(receipt.target.repositoryRoot, null);
  assert.equal(receipt.changes[0].absolutePath, path.join(root, "reference/receipt.md"));
  assert.equal(receipt.changes[0].effects.tags.added.values.length, 20);
  assert.equal(receipt.changes[0].effects.tags.added.omitted, 10);
  assert.equal(fs.existsSync(receipt.changes[0].absolutePath), false);
});

test("validateChanges converts policy failures to stable invalid receipts while apply still throws", async (t) => {
  const root = makeRoot(["generated:", "  by: process:fixture"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const authoring = service(root);
  const input = {
    changes: [{
      op: "update",
      uri: `okf://${path.basename(root)}/alpha`,
      title: "Unsafe",
    }],
  };
  const receipt = await authoring.validateChanges(input);
  assert.equal(receipt.valid, false);
  assert.equal(receipt.status, "invalid");
  assert.equal(receipt.validation.diagnostics[0].code, "generated_owner_protected");
  await assert.rejects(authoring.applyChanges(input), /must be changed through its generator/);
});

test("success returns persisted validation and absolute target/durability receipts", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  class PersistedReceiptService extends LiveAuthoringService {
    validationResult(index, candidates) {
      const result = super.validationResult(index, candidates);
      this.calls = (this.calls || 0) + 1;
      result.receiptPhase = this.calls === 1 ? "planned" : "persisted";
      return result;
    }
  }
  const authoring = new PersistedReceiptService(FileConceptStore.fromRoot(root), {
    actor: "openai/gpt-5.6",
  });
  const result = await authoring.applyChanges({
    changes: [{ op: "create", type: "Reference", title: "Persisted" }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.validation.receiptPhase, "persisted");
  assert.equal(result.filesChanged, true);
  assert.equal(result.target.bundleRoot, root);
  assert.equal(result.changes[0].absolutePath, path.join(root, "reference/persisted.md"));
  assert.equal(result.durability.persistence, "working_tree");
});

test("rollback preserves a post-publication external writer and reports the conflict", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  class ConflictingRollbackService extends LiveAuthoringService {
    validationResult(index, candidates) {
      this.calls = (this.calls || 0) + 1;
      if (this.calls === 2) {
        fs.writeFileSync(candidates[0].target.absolutePath, "external writer\n", "utf8");
        return { valid: false, diagnostics: [{ code: "injected" }], errors: [], warnings: [] };
      }
      return super.validationResult(index, candidates);
    }
  }
  const authoring = new ConflictingRollbackService(FileConceptStore.fromRoot(root), {
    actor: "openai/gpt-5.6",
  });
  const result = await authoring.applyChanges({
    changes: [{ op: "create", path: "race/new.md", type: "Reference", title: "New" }],
  });
  assert.equal(result.status, "rollback_conflict");
  assert.equal(result.applied, false);
  assert.equal(result.filesChanged, true);
  assert.equal(result.rollback.complete, false);
  assert.equal(result.rollback.conflicts[0].absolutePath, path.join(root, "race/new.md"));
  assert.equal(fs.readFileSync(path.join(root, "race/new.md"), "utf8"), "external writer\n");
});

test("failed Git commit restores only the affected index entry and reports working-tree persistence", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const realSpawnSync = spawnSync;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (args.includes("commit-tree")) {
        return { status: 1, stdout: "", stderr: "simulated commit failure" };
      }
      return realSpawnSync(command, args, options);
    },
  });
  const result = await authoring.applyChanges({
    changes: [{ op: "create", path: "git/uncommitted.md", type: "Reference", title: "Uncommitted" }],
  });
  assert.equal(result.status, "applied_uncommitted");
  assert.equal(result.git.commitState, "not_committed");
  assert.equal(result.git.affectedIndexState, "clean");
  assert.equal(result.git.affectedWorktreeState, "dirty");
  assert.equal(result.git.persistence, "working_tree");
  assert.equal(result.durability.persistence, "working_tree");
  assert.equal(git(root, ["diff", "--cached", "--name-only", "--", "git/uncommitted.md"]), "");
  assert.match(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), /\?\? git\/uncommitted\.md/);
});

test("Git inspection process failures remain operational errors", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const realSpawnSync = spawnSync;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (args.includes("config") && args.includes("user.name")) {
        const error = new Error("simulated config inspection failure");
        error.code = "EIO";
        return { status: null, stdout: "", stderr: "", error };
      }
      return realSpawnSync(command, args, options);
    },
  });
  await assert.rejects(
    authoring.validateChanges({
      changes: [{ op: "create", path: "git/inspect.md", type: "Reference", title: "Inspect" }],
    }),
    /Could not inspect Git user\.name: simulated config inspection failure/,
  );
  assert.equal(fs.existsSync(path.join(root, "git/inspect.md")), false);
});

test("an edit after the CAS commit stays visible while HEAD retains validated bytes", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const realSpawnSync = spawnSync;
  const target = path.join(root, "git/snapshot.md");
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (args.includes("update-ref")) {
        const updated = realSpawnSync(command, args, options);
        fs.writeFileSync(target, "external after commit\n", "utf8");
        return updated;
      }
      return realSpawnSync(command, args, options);
    },
  });
  const result = await authoring.applyChanges({
    changes: [{ op: "create", path: "git/snapshot.md", type: "Reference", title: "Snapshot" }],
  });
  assert.equal(result.git.committed, true);
  assert.match(git(root, ["show", "HEAD:git/snapshot.md"]), /title: Snapshot/);
  assert.equal(fs.readFileSync(target, "utf8"), "external after commit\n");
  assert.equal(result.git.affectedWorktreeState, "dirty");
  assert.equal(result.status, "applied_worktree_diverged");
  assert.equal(result.readyToApply, false);
});

test("a commit that succeeds before a timeout is classified from HEAD and tree", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const realSpawnSync = spawnSync;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (args.includes("update-ref")) {
        const committed = realSpawnSync(command, args, options);
        assert.equal(committed.status, 0);
        const timeout = new Error("simulated timeout");
        timeout.code = "ETIMEDOUT";
        return { status: null, signal: "SIGTERM", stdout: "", stderr: "", error: timeout };
      }
      return realSpawnSync(command, args, options);
    },
  });
  const result = await authoring.applyChanges({
    changes: [{ op: "create", path: "git/observed.md", type: "Reference", title: "Observed" }],
  });
  assert.equal(result.status, "applied");
  assert.equal(result.git.committed, true);
  assert.equal(result.git.commitState, "observed_committed");
  assert.match(result.git.commitSha, /^[0-9a-f]{40}$/);
});

test("a shared-index rewrite cannot replace the validated commit candidate", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const realSpawnSync = spawnSync;
  const target = path.join(root, "git", "protected.md");
  let injected = false;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (!injected && args.includes("write-tree") && options.env.GIT_INDEX_FILE) {
        injected = true;
        fs.writeFileSync(target, "external invalid bytes\n", "utf8");
        git(root, ["add", "--", "git/protected.md"]);
      }
      return realSpawnSync(command, args, options);
    },
  });
  const result = await authoring.applyChanges({
    changes: [{ op: "create", path: "git/protected.md", type: "Reference", title: "Protected" }],
  });
  assert.equal(result.applied, false);
  assert.equal(result.status, "post_publication_conflict");
  assert.equal(result.filesChanged, true);
  assert.equal(result.git.committed, false);
  assert.equal(result.git.targetState, "conflict");
  assert.equal(result.durability.state, "partial_filesystem_state");
  assert.equal(fs.readFileSync(target, "utf8"), "external invalid bytes\n");
  assert.equal(git(root, ["ls-tree", "--name-only", "HEAD", "--", "git/protected.md"]), "");
});

test("a concurrent unrelated index entry is excluded from the exact committed tree", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "outside.txt", "baseline\n");
  initializeGit(root);
  const realSpawnSync = spawnSync;
  let injected = false;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (!injected && args.includes("update-ref")) {
        injected = true;
        fs.writeFileSync(path.join(root, "outside.txt"), "external staged change\n", "utf8");
        git(root, ["add", "--", "outside.txt"]);
      }
      return realSpawnSync(command, args, options);
    },
  });
  const result = await authoring.applyChanges({
    changes: [{ op: "create", path: "git/exact.md", type: "Reference", title: "Exact" }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.git.committed, true);
  assert.equal(result.git.indexState, "dirty");
  assert.match(git(root, ["show", "HEAD:git/exact.md"]), /title: Exact/);
  assert.equal(git(root, ["show", "HEAD:outside.txt"]), "baseline");
  assert.equal(git(root, ["diff", "--cached", "--name-only"]), "outside.txt");
});

test("a concurrent affected-path index entry is preserved after the exact commit", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const realSpawnSync = spawnSync;
  const target = path.join(root, "git", "affected-index.md");
  let injected = false;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (!injected && args.includes("update-ref")) {
        const updated = realSpawnSync(command, args, options);
        assert.equal(updated.status, 0);
        fs.writeFileSync(target, "external staged bytes\n", "utf8");
        git(root, ["add", "--", "git/affected-index.md"]);
        injected = true;
        return updated;
      }
      return realSpawnSync(command, args, options);
    },
  });
  const result = await authoring.applyChanges({
    changes: [{
      op: "create",
      path: "git/affected-index.md",
      type: "Reference",
      title: "Affected Index",
    }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.git.committed, true);
  assert.equal(result.git.indexSynchronization, "skipped_affected_index_changed");
  assert.equal(result.git.affectedIndexState, "dirty");
  assert.match(git(root, ["show", "HEAD:git/affected-index.md"]), /title: Affected Index/);
  assert.equal(git(root, ["show", ":git/affected-index.md"]), "external staged bytes");
  assert.equal(fs.readFileSync(target, "utf8"), "external staged bytes\n");
});

test("the standard index lock closes the affected-path guard/reset race", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const realSpawnSync = spawnSync;
  const target = path.join(root, "git", "locked-index.md");
  let injected = false;
  let competingAdd;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      const lockedIndex = options.env.GIT_INDEX_FILE;
      if (!injected
        && args.includes("diff")
        && args.includes("--cached")
        && args.includes("git/locked-index.md")
        && lockedIndex
        && lockedIndex.endsWith("index.lock")) {
        const inspected = realSpawnSync(command, args, options);
        assert.equal(inspected.status, 0);
        fs.writeFileSync(target, "external in guard/reset gap\n", "utf8");
        competingAdd = realSpawnSync(
          "git",
          ["-C", root, "add", "--", "git/locked-index.md"],
          { encoding: "utf8", shell: false },
        );
        injected = true;
        return inspected;
      }
      return realSpawnSync(command, args, options);
    },
  });
  const result = await authoring.applyChanges({
    changes: [{
      op: "create",
      path: "git/locked-index.md",
      type: "Reference",
      title: "Locked Index",
    }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.git.committed, true);
  assert.equal(result.git.indexSynchronization, "synchronized");
  assert.equal(result.status, "applied_worktree_diverged");
  assert.ok(competingAdd);
  assert.notEqual(competingAdd.status, 0);
  assert.match(competingAdd.stderr, /index\.lock|another git process/i);
  assert.match(git(root, ["show", "HEAD:git/locked-index.md"]), /title: Locked Index/);
  assert.match(git(root, ["show", ":git/locked-index.md"]), /title: Locked Index/);
  assert.equal(fs.readFileSync(target, "utf8"), "external in guard/reset gap\n");
});

test("a lock owned by another Git writer is never removed", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const lockPath = path.join(root, ".git", "index.lock");
  const sentinel = Buffer.from("external git writer lock\n", "utf8");
  fs.writeFileSync(lockPath, sentinel, { flag: "wx" });
  const result = await service(root, { gitCommit: true }).applyChanges({
    changes: [{
      op: "create",
      path: "git/locked-by-other.md",
      type: "Reference",
      title: "Locked By Other",
    }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.git.committed, true);
  assert.equal(result.git.indexSynchronization, "skipped_index_locked");
  assert.deepEqual(fs.readFileSync(lockPath), sentinel);
  fs.unlinkSync(lockPath);
  assert.match(git(root, ["show", "HEAD:git/locked-by-other.md"]), /title: Locked By Other/);
});

test("clean filters including reserved-looking driver names block before configured code runs", async (t) => {
  const root = makeRoot();
  const helperRoot = fs.mkdtempSync(path.join(os.tmpdir(), "okf-filter-helper-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(helperRoot, { recursive: true, force: true }));
  const marker = path.join(helperRoot, "executed");
  const filter = path.join(helperRoot, "filter.sh");
  fs.writeFileSync(filter, `#!/bin/sh\ntouch '${marker}'\ncat\n`, "utf8");
  fs.chmodSync(filter, 0o755);
  write(root, ".gitattributes", "filtered.md filter=unspecified\n");
  initializeGit(root);
  git(root, ["config", "filter.unspecified.clean", filter]);
  git(root, ["config", "filter.unspecified.smudge", filter]);
  const authoring = service(root, { gitCommit: true });
  const input = {
    changes: [{ op: "create", path: "filtered.md", type: "Reference", title: "Filtered" }],
  };
  const preview = await authoring.validateChanges(input);
  assert.equal(preview.valid, true);
  assert.equal(preview.readyToApply, false);
  assert.equal(preview.status, "blocked");
  assert.equal(preview.git.diagnostics[0].code, "git_filter_attribute_unsupported");
  assert.equal(fs.existsSync(marker), false);
  await assert.rejects(authoring.applyChanges(input), /Git filter attributes|repository-configured filters/);
  assert.equal(fs.existsSync(path.join(root, "filtered.md")), false);
  assert.equal(fs.existsSync(marker), false);
});

test("read-only Git validation disables a configured fsmonitor hook", async (t) => {
  const root = makeRoot();
  const helperRoot = fs.mkdtempSync(path.join(os.tmpdir(), "okf-fsmonitor-helper-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(helperRoot, { recursive: true, force: true }));
  const marker = path.join(helperRoot, "executed");
  const monitor = path.join(helperRoot, "monitor.sh");
  fs.writeFileSync(monitor, `#!/bin/sh\ntouch '${marker}'\nprintf '0\\n'\n`, "utf8");
  fs.chmodSync(monitor, 0o755);
  initializeGit(root);
  git(root, ["config", "core.fsmonitor", monitor]);
  const preview = await service(root, { gitCommit: true }).validateChanges({
    changes: [{ op: "create", path: "git/monitor.md", type: "Reference", title: "Monitor" }],
  });
  assert.equal(preview.valid, true);
  assert.equal(preview.readyToApply, true);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.join(root, "git", "monitor.md")), false);
});

test("Git replace refs cannot substitute the preflight or committed parent tree", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "outside.txt", "baseline\n");
  initializeGit(root);
  const head = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "outside.txt"), "replacement bytes\n", "utf8");
  git(root, ["add", "--", "outside.txt"]);
  git(root, ["commit", "--quiet", "-m", "replacement fixture"]);
  const replacement = git(root, ["rev-parse", "HEAD"]);
  git(root, ["replace", head, replacement]);
  git(root, ["reset", "--hard", "--quiet", head]);
  assert.equal(fs.readFileSync(path.join(root, "outside.txt"), "utf8"), "replacement bytes\n");

  const authoring = service(root, { gitCommit: true });
  const input = {
    changes: [{ op: "create", path: "git/replace-safe.md", type: "Reference", title: "Replace Safe" }],
  };
  const preview = await authoring.validateChanges(input);
  assert.equal(preview.valid, true);
  assert.equal(preview.readyToApply, false);
  assert.equal(preview.status, "blocked");
  assert.ok(preview.git.diagnostics.some((entry) => entry.code === "git_worktree_dirty"));
  await assert.rejects(authoring.applyChanges(input), /worktree must be completely clean/);
  assert.equal(fs.existsSync(path.join(root, "git", "replace-safe.md")), false);

  const raw = spawnSync("git", ["-C", root, "show", `${head}:outside.txt`], {
    encoding: "utf8",
    shell: false,
    env: Object.assign({}, process.env, { GIT_NO_REPLACE_OBJECTS: "1" }),
  });
  assert.equal(raw.status, 0);
  assert.equal(raw.stdout, "baseline\n");
});

test("assume-unchanged and skip-worktree flags cannot hide user bytes from preflight", async (t) => {
  for (const fixture of [
    { argument: "--assume-unchanged", flag: "assume-unchanged" },
    { argument: "--skip-worktree", flag: "skip-worktree" },
  ]) {
    const root = makeRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    initializeGit(root);
    git(root, ["update-index", fixture.argument, "alpha.md"]);
    const alpha = path.join(root, "alpha.md");
    fs.appendFileSync(alpha, "\nHIDDEN USER BODY\n", "utf8");
    assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
    const authoring = service(root, { gitCommit: true });
    const input = {
      changes: [{
        op: "update",
        uri: `okf://${path.basename(root)}/alpha`,
        tags: { add: ["agent"] },
      }],
    };
    const preview = await authoring.validateChanges(input);
    assert.equal(preview.valid, true);
    assert.equal(preview.readyToApply, false);
    assert.equal(preview.status, "blocked");
    assert.equal(preview.changes[0].effects.bodyChanged, false);
    const diagnostic = preview.git.diagnostics.find(
      (entry) => entry.code === "git_index_flag_unsupported",
    );
    assert.ok(diagnostic);
    assert.equal(diagnostic.paths[0].flag, fixture.flag);
    await assert.rejects(
      authoring.applyChanges(input),
      /assume-unchanged and skip-worktree Git index flags/,
    );
    assert.match(fs.readFileSync(alpha, "utf8"), /HIDDEN USER BODY/);
    assert.doesNotMatch(git(root, ["show", "HEAD:alpha.md"]), /HIDDEN USER BODY/);
  }
});

test("core.filemode false cannot make a metadata update absorb a hidden chmod", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  git(root, ["config", "core.filemode", "false"]);
  fs.chmodSync(path.join(root, "alpha.md"), 0o755);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
  const result = await service(root, { gitCommit: true }).applyChanges({
    changes: [{
      op: "update",
      uri: `okf://${path.basename(root)}/alpha`,
      tags: { add: ["agent"] },
    }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.git.committed, true);
  assert.equal(result.changes[0].effects.bodyChanged, false);
  assert.equal(git(root, ["ls-tree", "HEAD", "--", "alpha.md"]).split(" ")[0], "100644");
  assert.equal(fs.statSync(path.join(root, "alpha.md")).mode & 0o111, 0o111);
});

test("a same-SHA checkout switch cannot redirect the automatic commit", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const originalRef = git(root, ["symbolic-ref", "HEAD"]);
  const originalHead = git(root, ["rev-parse", "HEAD"]);
  git(root, ["branch", "other", originalHead]);
  const realSpawnSync = spawnSync;
  let switched = false;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      if (!switched && args.includes("update-ref")) {
        switched = true;
        git(root, ["switch", "--quiet", "other"]);
      }
      return realSpawnSync(command, args, options);
    },
  });
  const result = await authoring.applyChanges({
    changes: [{ op: "create", path: "git/pinned-ref.md", type: "Reference", title: "Pinned Ref" }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.git.committed, true);
  assert.equal(result.git.indexSynchronization, "skipped_checkout_changed");
  assert.equal(result.git.checkoutState, "changed");
  assert.equal(git(root, ["symbolic-ref", "HEAD"]), "refs/heads/other");
  assert.equal(git(root, ["rev-parse", "other"]), originalHead);
  assert.match(git(root, ["show", `${originalRef}:git/pinned-ref.md`]), /title: Pinned Ref/);
  assert.equal(git(root, ["ls-tree", "--name-only", "other", "--", "git/pinned-ref.md"]), "");
});

test("checkout identity is rechecked while standard HEAD and branch locks are held", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const originalRef = git(root, ["symbolic-ref", "HEAD"]);
  const originalHead = git(root, ["rev-parse", "HEAD"]);
  git(root, ["branch", "other", originalHead]);
  const realSpawnSync = spawnSync;
  let refPublished = false;
  let switched = false;
  const authoring = service(root, {
    gitCommit: true,
    spawnSync(command, args, options) {
      const result = realSpawnSync(command, args, options);
      if (args.includes("update-ref") && result.status === 0) {
        refPublished = true;
      } else if (refPublished
        && !switched
        && args.includes("symbolic-ref")
        && args.includes("HEAD")) {
        const changed = realSpawnSync(
          "git",
          ["-C", root, "symbolic-ref", "HEAD", "refs/heads/other"],
          { encoding: "utf8", shell: false },
        );
        assert.equal(changed.status, 0);
        switched = true;
      }
      return result;
    },
  });
  const result = await authoring.applyChanges({
    changes: [{
      op: "create",
      path: "git/rechecked-ref.md",
      type: "Reference",
      title: "Rechecked Ref",
    }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.git.committed, true);
  assert.equal(result.git.indexSynchronization, "skipped_checkout_changed");
  assert.equal(result.git.checkoutState, "changed");
  assert.equal(git(root, ["symbolic-ref", "HEAD"]), "refs/heads/other");
  assert.equal(git(root, ["rev-parse", "other"]), originalHead);
  assert.match(git(root, ["show", `${originalRef}:git/rechecked-ref.md`]), /title: Rechecked Ref/);
  assert.equal(git(root, ["ls-tree", "--name-only", "other", "--", "git/rechecked-ref.md"]), "");
});

test("detached HEAD blocks automatic commit planning", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  git(root, ["switch", "--detach", "--quiet"]);
  const authoring = service(root, { gitCommit: true });
  const input = {
    changes: [{ op: "create", path: "git/detached.md", type: "Reference", title: "Detached" }],
  };
  const preview = await authoring.validateChanges(input);
  assert.equal(preview.valid, true);
  assert.equal(preview.readyToApply, false);
  assert.ok(preview.git.diagnostics.some((entry) => entry.code === "git_detached_head_unsupported"));
  await assert.rejects(authoring.applyChanges(input), /symbolic branch|detached HEAD/);
  assert.equal(fs.existsSync(path.join(root, "git", "detached.md")), false);
});

test("unsafe control paths and invalid commit messages are rejected during planning", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeGit(root);
  const authoring = service(root, { gitCommit: true });
  const unsafe = await authoring.validateChanges({
    changes: [{
      op: "create",
      path: ".GIT/refs/heads/poison.md",
      type: "Reference",
      title: "Poison",
    }],
  });
  assert.equal(unsafe.valid, false);
  assert.equal(unsafe.validation.diagnostics[0].code, "unsafe_target_path");
  const invalidMessage = await authoring.validateChanges({
    message: "bad\0message",
    changes: [{ op: "create", path: "git/message.md", type: "Reference", title: "Message" }],
  });
  assert.equal(invalidMessage.valid, false);
  assert.equal(invalidMessage.validation.diagnostics[0].code, "invalid_commit_message");
  assert.equal(fs.existsSync(path.join(root, "git", "message.md")), false);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
});
