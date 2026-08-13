"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  DEFAULT_MAX_GIT_SOURCE_BYTES,
  readGitSource,
  readGitSources,
  safeGitPath,
  validateGitSource,
} = require("../src/git-source");

function runGit(repository, args) {
  const result = spawnSync("git", ["-C", repository].concat(args), {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function write(root, relativePath, content) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function repositoryFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "okf-git-source-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const checkout = path.join(fixtureRoot, "checkout");
  const bare = path.join(fixtureRoot, "bare.git");
  fs.mkdirSync(checkout);
  runGit(checkout, ["init", "--quiet"]);
  write(checkout, "src/example.js", "one\nsecond\nthird\nfourth\n");
  write(checkout, "src/$not;executed.txt", "shell characters stay inert\n");
  write(checkout, "src/invalid.txt", Buffer.from([0xc3, 0x28]));
  write(checkout, "src/large.txt", "0123456789");
  fs.symlinkSync("example.js", path.join(checkout, "src", "linked.js"));
  runGit(checkout, ["add", "--all"]);
  runGit(checkout, [
    "-c", "user.name=OKF Test", "-c", "user.email=okf@example.invalid",
    "commit", "--quiet", "-m", "fixture",
  ]);
  const revision = runGit(checkout, ["rev-parse", "HEAD"]);
  const blobOid = runGit(checkout, ["rev-parse", "HEAD:src/example.js"]);
  runGit(fixtureRoot, ["clone", "--quiet", "--bare", checkout, bare]);
  return { fixtureRoot, checkout, bare, revision, blobOid };
}

function source(repositoryConceptId, revision, gitPath, lines) {
  return {
    resource: repositoryConceptId,
    title: "Preserved source metadata is not interpreted by the reader",
    git: {
      revision,
      path: gitPath,
      ...(lines === undefined ? {} : { lines }),
    },
  };
}

function assertCode(expected) {
  return (error) => error && error.code === expected;
}

test("reads immutable UTF-8 blobs from checkout and bare repositories", (t) => {
  const fixture = repositoryFixture(t);
  const repository = "okf://repositories/example";
  const expected = "one\nsecond\nthird\nfourth\n";
  const expectedSha256 = `sha256:${crypto.createHash("sha256").update(expected).digest("hex")}`;

  write(fixture.checkout, "src/example.js", "dirty worktree content\n");
  const checkoutResult = readGitSource(
    source(repository, fixture.revision, "src/example.js"),
    new Map([[repository, fixture.checkout]]),
  );
  const bareResult = readGitSource(
    source(repository, fixture.revision, "src/example.js"),
    { [repository]: { path: fixture.bare } },
  );

  for (const result of [checkoutResult, bareResult]) {
    assert.equal(result.available, true);
    assert.equal(result.content, expected);
    assert.equal(result.blobOid, fixture.blobOid);
    assert.equal(result.sha256, expectedSha256);
    assert.equal(result.metadata.repositoryConceptId, repository);
    assert.equal(result.metadata.revision, fixture.revision);
    assert.equal(result.metadata.path, "src/example.js");
    assert.equal(result.metadata.mode, "100644");
    assert.equal(result.metadata.objectType, "blob");
    assert.equal(result.metadata.size, Buffer.byteLength(expected));
    assert.equal(result.metadata.encoding, "utf-8");
    assert.equal(Object.hasOwn(result.metadata, "repositoryPath"), false);
  }
});

test("applies one-based inclusive line ranges without changing the full blob digest", (t) => {
  const fixture = repositoryFixture(t);
  const repository = "okf://repositories/example";
  const mapping = { [repository]: fixture.checkout };
  const full = readGitSource(source(repository, fixture.revision, "src/example.js"), mapping);
  const selected = readGitSource(
    source(repository, fixture.revision, "src/example.js", { start: 2, end: 3 }),
    mapping,
  );
  const selectedFromList = readGitSource(
    source(repository, fixture.revision, "src/example.js", [4, 4]),
    mapping,
  );

  assert.equal(selected.content, "second\nthird\n");
  assert.deepEqual(selected.metadata.lines, { start: 2, end: 3 });
  assert.equal(selected.sha256, full.sha256);
  assert.equal(selected.blobOid, full.blobOid);
  assert.equal(selectedFromList.content, "fourth\n");
  assert.throws(
    () => readGitSource(source(repository, fixture.revision, "src/example.js", [2, 8]), mapping),
    assertCode("git_source_lines_out_of_range"),
  );
});

test("returns unavailable without invoking Git for unpinned revisions or missing mappings", () => {
  let calls = 0;
  const failIfCalled = () => {
    calls += 1;
    throw new Error("Git must not run");
  };
  const repository = "okf://repositories/example";
  const unpinned = readGitSource(
    source(repository, "main", "src/example.js"),
    { [repository]: "/explicit/repository" },
    { spawnSync: failIfCalled },
  );
  const unmapped = readGitSource(
    source(repository, "a".repeat(40), "src/example.js"),
    {},
    { spawnSync: failIfCalled },
  );

  assert.equal(calls, 0);
  assert.equal(unpinned.available, false);
  assert.equal(unpinned.reason, "revision_unpinned");
  assert.equal(unpinned.metadata.revision, null);
  assert.equal(unmapped.available, false);
  assert.equal(unmapped.reason, "repository_unmapped");
});

test("uses literal process arguments and disables lazy fetches", (t) => {
  const fixture = repositoryFixture(t);
  const repository = "okf://repositories/example";
  const calls = [];
  const observedSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    return spawnSync(command, args, options);
  };
  const result = readGitSource(
    source(repository, fixture.revision, "src/$not;executed.txt"),
    { [repository]: fixture.checkout },
    { spawnSync: observedSpawn },
  );

  assert.equal(result.content, "shell characters stay inert\n");
  assert.ok(calls.length >= 4);
  calls.forEach((call) => {
    assert.equal(call.command, "git");
    assert.equal(call.options.shell, false);
    assert.equal(call.options.env.GIT_ALLOW_PROTOCOL, "");
    assert.equal(call.options.env.GIT_NO_LAZY_FETCH, "1");
    assert.equal(call.options.env.GIT_NO_REPLACE_OBJECTS, "1");
    assert.equal(call.options.env.GIT_LITERAL_PATHSPECS, "1");
    assert.equal(call.args.includes("fetch"), false);
  });
  const lsTree = calls.find((call) => call.args.includes("ls-tree"));
  assert.deepEqual(lsTree.args.slice(-2), ["--", "src/$not;executed.txt"]);
});

test("rejects unsafe paths, invalid ranges, and non-absolute mappings before content reads", () => {
  const repository = "okf://repositories/example";
  const revision = "a".repeat(40);
  for (const unsafe of ["../secret", "/etc/passwd", "src//file", "src/./file", "src\\file", " src/file"]) {
    assert.throws(() => safeGitPath(unsafe), assertCode("git_source_invalid_path"));
  }
  assert.throws(
    () => validateGitSource(source(repository, revision, "src/file", { start: 0, end: 1 })),
    assertCode("git_source_invalid_lines"),
  );
  assert.throws(
    () => readGitSource(source(repository, revision, "src/file"), { [repository]: "relative/repo" }),
    assertCode("git_source_invalid_repository_mapping"),
  );
  assert.throws(
    () => readGitSource(source(repository, revision, "src/file"), { [repository]: "/tmp" }, {
      maxBytes: DEFAULT_MAX_GIT_SOURCE_BYTES + 1,
    }),
    (error) => error instanceof TypeError,
  );
});

test("rejects Git symlinks, gitlinks, oversized blobs, and invalid UTF-8", (t) => {
  const fixture = repositoryFixture(t);
  const repository = "okf://repositories/example";
  const mapping = { [repository]: fixture.checkout };

  assert.throws(
    () => readGitSource(source(repository, fixture.revision, "src/linked.js"), mapping),
    assertCode("git_source_symlink"),
  );
  assert.throws(
    () => readGitSource(source(repository, fixture.revision, "src/large.txt"), mapping, { maxBytes: 4 }),
    (error) => {
      assertCode("git_source_too_large")(error);
      assert.deepEqual(error.details, {
        actualBytes: 10,
        limitBytes: 4,
        maxAllowedBytes: 1024 * 1024,
        retryable: true,
      });
      return true;
    },
  );
  assert.throws(
    () => readGitSource(source(repository, fixture.revision, "src/invalid.txt"), mapping),
    assertCode("git_source_invalid_utf8"),
  );

  runGit(fixture.checkout, [
    "update-index", "--add", "--cacheinfo", `160000,${fixture.revision},vendor/library`,
  ]);
  runGit(fixture.checkout, [
    "-c", "user.name=OKF Test", "-c", "user.email=okf@example.invalid",
    "commit", "--quiet", "-m", "gitlink",
  ]);
  const gitlinkRevision = runGit(fixture.checkout, ["rev-parse", "HEAD"]);
  assert.throws(
    () => readGitSource(source(repository, gitlinkRevision, "vendor/library"), mapping),
    assertCode("git_source_submodule"),
  );
});

test("batch reader selects only sources carrying Git metadata", (t) => {
  const fixture = repositoryFixture(t);
  const repository = "okf://repositories/example";
  const results = readGitSources([
    { resource: "https://example.invalid/policy" },
    source(repository, fixture.revision, "src/example.js", [1, 1]),
  ], { [repository]: fixture.bare });

  assert.equal(results.length, 1);
  assert.equal(results[0].sourceIndex, 1);
  assert.equal(results[0].available, true);
  assert.equal(results[0].content, "one\n");
});
