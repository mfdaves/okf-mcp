"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync: nodeSpawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");

const gitPreflight = require("./git-preflight");
const {
  AuthoringPolicyError,
  commandFailure,
  commandSucceeded,
  hasOwn,
  revisionFor,
  sortedUnique,
} = require("./shared");

class GitPublisher {
  constructor(options) {
    const config = options || {};
    this.gitCommit = Boolean(config.gitCommit);
    this.spawnSync = config.spawnSync || nodeSpawnSync;
  }

  runGit(directory, args, options) {
    const environment = Object.assign({}, process.env);
    Object.keys(environment)
      .filter((key) => key.startsWith("GIT_"))
      .forEach((key) => {
        delete environment[key];
      });
    if (options && options.environment) {
      Object.assign(environment, options.environment);
    }
    environment.GIT_LITERAL_PATHSPECS = "1";
    environment.GIT_TERMINAL_PROMPT = "0";
    environment.GIT_PAGER = "cat";
    environment.GIT_NO_REPLACE_OBJECTS = "1";
    if (options && options.readOnly) {
      environment.GIT_OPTIONAL_LOCKS = "0";
    }
    const spawnOptions = {
      encoding: "utf8",
      shell: false,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15000,
      env: environment,
    };
    if (options && hasOwn(options, "input")) {
      spawnOptions.input = options.input;
    }
    try {
      return this.spawnSync(
        "git",
        [
          "-C",
          directory,
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "commit.gpgSign=false",
          "-c",
          "diff.external=",
        ].concat(args),
        spawnOptions,
      );
    } catch (error) {
      return { status: null, stdout: "", stderr: "", error };
    }
  }

  readGitValue(repository, args, options) {
    const result = this.runGit(repository, args, options);
    return commandSucceeded(result) ? String(result.stdout || "").trim() : null;
  }

  prepareGit(bundle, candidates) {
    return gitPreflight.prepareGit(this, bundle, candidates);
  }

  repositoryFiles(preflight, candidates) {
    const files = sortedUnique(
      candidates.map((candidate) =>
        path.relative(preflight.repository, candidate.target.absolutePath).replace(/\\/g, "/"),
      ),
    );
    if (
      files.some(
        (file) => !file || file === ".." || file.startsWith("../") || path.isAbsolute(file),
      )
    ) {
      throw new AuthoringPolicyError(
        "An affected concept path is outside the detected Git repository.",
      );
    }
    return files;
  }

  inspectGitState(repository, revision, files) {
    const affected = this.runGit(
      repository,
      ["diff", "--no-ext-diff", "--cached", "--quiet", revision, "--"].concat(files),
    );
    const global = this.runGit(repository, [
      "diff",
      "--no-ext-diff",
      "--cached",
      "--quiet",
      revision,
      "--",
    ]);
    const worktree = this.runGit(
      repository,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"].concat(files),
    );
    const state = (result) => {
      if (result && !result.error && result.status === 0) return "clean";
      if (result && !result.error && result.status === 1) return "dirty";
      return "unknown";
    };
    return {
      affectedIndexState: state(affected),
      indexState: state(global),
      affectedWorktreeState: !commandSucceeded(worktree)
        ? "unknown"
        : String(worktree.stdout || "")
              .split("\0")
              .filter(Boolean)
              .some((entry) => entry.startsWith("??") || (entry.length > 1 && entry[1] !== " "))
          ? "dirty"
          : "clean",
    };
  }

  classifyCommit(preflight, expectedTree) {
    const headAfter = this.readGitValue(preflight.repository, [
      "rev-parse",
      "--verify",
      preflight.headRef || "HEAD",
    ]);
    if (!headAfter) {
      return { commitState: "unknown", committed: null, headAfter: null };
    }
    if (headAfter === preflight.headBefore) {
      return { commitState: "not_committed", committed: false, headAfter };
    }
    const treeAfter = this.readGitValue(preflight.repository, ["rev-parse", `${headAfter}^{tree}`]);
    const parentAfter = this.readGitValue(preflight.repository, ["rev-parse", `${headAfter}^`]);
    if (expectedTree && treeAfter === expectedTree && parentAfter === preflight.headBefore) {
      return {
        commitState: "committed",
        committed: true,
        commitSha: headAfter,
        headAfter,
        treeAfter,
      };
    }
    return {
      commitState: "unknown",
      committed: null,
      headAfter,
      treeAfter,
      parentAfter,
    };
  }

  inspectPublishedTargets(candidates) {
    const checks = candidates.map((candidate) => {
      try {
        const stat = fs.lstatSync(candidate.target.absolutePath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          return {
            path: candidate.path,
            absolutePath: candidate.target.absolutePath,
            expectedRevision: candidate.publishedRevision,
            observedState: "non_regular",
            observedRevision: null,
            matches: false,
          };
        }
        const observedRevision = revisionFor(fs.readFileSync(candidate.target.absolutePath));
        return {
          path: candidate.path,
          absolutePath: candidate.target.absolutePath,
          expectedRevision: candidate.publishedRevision,
          observedState: "regular",
          observedRevision,
          matches: observedRevision === candidate.publishedRevision,
        };
      } catch (error) {
        return {
          path: candidate.path,
          absolutePath: candidate.target.absolutePath,
          expectedRevision: candidate.publishedRevision,
          observedState: error && error.code === "ENOENT" ? "missing" : "unavailable",
          observedRevision: null,
          matches: false,
        };
      }
    });
    const conflicts = checks.filter((check) => !check.matches);
    return {
      targetState: conflicts.length ? "conflict" : "matching",
      validatedFilesPresent: conflicts.length === 0,
      targetChecks: checks,
      targetConflicts: conflicts,
    };
  }

  synchronizeCommittedIndex(preflight, classification, files) {
    const currentHeadRef = this.readGitValue(preflight.repository, ["symbolic-ref", "-q", "HEAD"]);
    if (!preflight.headRef || currentHeadRef !== preflight.headRef) {
      const inspected = this.inspectGitState(preflight.repository, classification.headAfter, files);
      return Object.assign(
        {
          indexSynchronization: "skipped_checkout_changed",
          checkoutState: "changed",
          currentHeadRef,
          indexSynchronizationError:
            "The checked-out Git ref changed before affected index paths could be synchronized.",
        },
        inspected,
      );
    }
    const indexPath = this.gitIndexPath(preflight.repository);
    const headPath = this.gitControlPath(preflight.repository, "HEAD");
    const branchPath = preflight.headRef
      ? this.gitControlPath(preflight.repository, preflight.headRef)
      : null;
    if (!indexPath || !headPath || !branchPath) {
      const inspected = this.inspectGitState(preflight.repository, classification.headAfter, files);
      return Object.assign(
        {
          indexSynchronization: "skipped_index_unavailable",
          indexSynchronizationError: "Could not resolve the Git index path.",
        },
        inspected,
      );
    }
    const lockPath = `${indexPath}.lock`;
    const headLockPath = `${headPath}.lock`;
    const branchLockPath = `${branchPath}.lock`;
    let lockDescriptor = null;
    let lockOwned = false;
    let headLockDescriptor = null;
    let headLockOwned = false;
    let branchLockDescriptor = null;
    let branchLockOwned = false;
    let attemptedLock = "index";
    let published = false;
    try {
      const indexStat = fs.statSync(indexPath);
      lockDescriptor = fs.openSync(lockPath, "wx", indexStat.mode & 0o777);
      lockOwned = true;
      fs.writeFileSync(lockDescriptor, fs.readFileSync(indexPath));
      fs.closeSync(lockDescriptor);
      lockDescriptor = null;
      attemptedLock = "checkout";
      headLockDescriptor = fs.openSync(headLockPath, "wx", 0o666);
      headLockOwned = true;
      fs.closeSync(headLockDescriptor);
      headLockDescriptor = null;
      attemptedLock = "branch";
      branchLockDescriptor = fs.openSync(branchLockPath, "wx", 0o666);
      branchLockOwned = true;
      fs.closeSync(branchLockDescriptor);
      branchLockDescriptor = null;
      const lockedHeadRef = this.readGitValue(preflight.repository, ["symbolic-ref", "-q", "HEAD"]);
      const lockedBranchHead = this.readGitValue(preflight.repository, [
        "rev-parse",
        "--verify",
        preflight.headRef,
      ]);
      if (lockedHeadRef !== preflight.headRef || lockedBranchHead !== classification.headAfter) {
        return {
          indexSynchronization: "skipped_checkout_changed",
          checkoutState: "changed",
          currentHeadRef: lockedHeadRef,
          currentBranchHead: lockedBranchHead,
          indexSynchronizationError:
            "The checked-out Git ref or its commit changed before affected index paths could be synchronized.",
          affectedIndexState: "unknown",
          indexState: "unknown",
          affectedWorktreeState: "unknown",
        };
      }
      const lockedIndex = { environment: { GIT_INDEX_FILE: lockPath } };
      const candidateIndexChanged = this.runGit(
        preflight.repository,
        ["diff", "--no-ext-diff", "--cached", "--quiet", preflight.headBefore, "--"].concat(files),
        lockedIndex,
      );
      if (!commandSucceeded(candidateIndexChanged)) {
        const inspected = this.inspectGitState(
          preflight.repository,
          classification.headAfter,
          files,
        );
        return Object.assign(
          {
            indexSynchronization:
              candidateIndexChanged &&
              !candidateIndexChanged.error &&
              candidateIndexChanged.status === 1
                ? "skipped_affected_index_changed"
                : "skipped_index_unavailable",
            indexSynchronizationError:
              candidateIndexChanged &&
              !candidateIndexChanged.error &&
              candidateIndexChanged.status === 1
                ? "Affected Git index entries changed after preflight and were preserved."
                : commandFailure(
                    candidateIndexChanged,
                    "Could not verify affected Git index entries.",
                  ),
          },
          inspected,
        );
      }
      const reset = this.runGit(
        preflight.repository,
        ["reset", "--quiet", classification.headAfter, "--"].concat(files),
        lockedIndex,
      );
      if (!commandSucceeded(reset)) {
        const inspected = this.inspectGitState(
          preflight.repository,
          classification.headAfter,
          files,
        );
        return Object.assign(
          {
            indexSynchronization: "failed",
            indexSynchronizationError: commandFailure(
              reset,
              "Could not synchronize committed index paths.",
            ),
          },
          inspected,
        );
      }
      const verified = this.runGit(
        preflight.repository,
        ["diff", "--no-ext-diff", "--cached", "--quiet", classification.headAfter, "--"].concat(
          files,
        ),
        lockedIndex,
      );
      if (!commandSucceeded(verified)) {
        const inspected = this.inspectGitState(
          preflight.repository,
          classification.headAfter,
          files,
        );
        return Object.assign(
          {
            indexSynchronization: "failed_verification",
            indexSynchronizationError: commandFailure(
              verified,
              "Synchronized index verification failed.",
            ),
          },
          inspected,
        );
      }
      fs.renameSync(lockPath, indexPath);
      published = true;
      return Object.assign(
        {
          indexSynchronization: "synchronized",
        },
        this.inspectGitState(preflight.repository, classification.headAfter, files),
      );
    } catch (error) {
      const inspected = this.inspectGitState(preflight.repository, classification.headAfter, files);
      return Object.assign(
        {
          indexSynchronization:
            error && error.code === "EEXIST"
              ? attemptedLock === "index"
                ? "skipped_index_locked"
                : attemptedLock === "checkout"
                  ? "skipped_checkout_locked"
                  : "skipped_branch_locked"
              : "failed",
          indexSynchronizationError:
            error && error.code === "EEXIST"
              ? `The Git ${attemptedLock} state is locked by another writer; its state was preserved.`
              : error && error.message
                ? error.message
                : String(error),
        },
        inspected,
      );
    } finally {
      if (lockDescriptor !== null) {
        try {
          fs.closeSync(lockDescriptor);
        } catch {
          // Best-effort descriptor cleanup after a failed synchronization.
        }
      }
      if (headLockDescriptor !== null) {
        try {
          fs.closeSync(headLockDescriptor);
        } catch {
          // Best-effort descriptor cleanup after a failed synchronization.
        }
      }
      if (branchLockDescriptor !== null) {
        try {
          fs.closeSync(branchLockDescriptor);
        } catch {
          // Best-effort descriptor cleanup after a failed synchronization.
        }
      }
      if (lockOwned && !published) {
        for (const target of [lockPath, `${lockPath}.lock`]) {
          try {
            fs.unlinkSync(target);
          } catch (error) {
            if (!error || error.code !== "ENOENT") {
              // The index itself remains untouched; the receipt reports synchronization failure.
            }
          }
        }
      }
      for (const [owned, target] of [
        [branchLockOwned, branchLockPath],
        [headLockOwned, headLockPath],
      ]) {
        if (!owned) continue;
        try {
          fs.unlinkSync(target);
        } catch (error) {
          if (!error || error.code !== "ENOENT") {
            // The receipt already reports the synchronization outcome.
          }
        }
      }
    }
  }

  finalizeGitFailure(preflight, files, failure, expectedTree, candidates) {
    const classification = this.classifyCommit(preflight, expectedTree);
    if (classification.committed === true) {
      const synchronized = this.synchronizeCommittedIndex(preflight, classification, files);
      const targets = this.inspectPublishedTargets(candidates);
      return Object.assign(
        {},
        classification,
        {
          enabled: true,
          repository: true,
          repositoryRoot: preflight.repository,
          commitState: "observed_committed",
          persistence: "git_commit",
          warning: commandFailure(failure, "Git reported failure after the commit became visible."),
        },
        synchronized,
        targets,
      );
    }
    if (classification.committed === false) {
      const inspected = this.inspectGitState(preflight.repository, preflight.headBefore, files);
      const targets = this.inspectPublishedTargets(candidates);
      return Object.assign(
        {
          enabled: true,
          repository: true,
          repositoryRoot: preflight.repository,
          committed: false,
          commitState: "not_committed",
          persistence: targets.validatedFilesPresent ? "working_tree" : "unknown",
          error: commandFailure(failure, "Git commit failed"),
        },
        classification,
        inspected,
        targets,
      );
    }
    const inspected = classification.headAfter
      ? this.inspectGitState(preflight.repository, classification.headAfter, files)
      : { affectedIndexState: "unknown", indexState: "unknown", affectedWorktreeState: "unknown" };
    const targets = this.inspectPublishedTargets(candidates);
    return Object.assign(
      {
        enabled: true,
        repository: true,
        repositoryRoot: preflight.repository,
        committed: null,
        commitState: "unknown",
        persistence: "unknown",
        error: commandFailure(failure, "Git commit outcome could not be determined"),
      },
      classification,
      inspected,
      targets,
    );
  }

  gitControlPath(repository, name) {
    const controlPath = this.readGitValue(repository, ["rev-parse", "--git-path", name], {
      readOnly: true,
    });
    if (!controlPath) {
      return null;
    }
    return path.isAbsolute(controlPath) ? controlPath : path.resolve(repository, controlPath);
  }

  gitIndexPath(repository) {
    return this.gitControlPath(repository, "index");
  }

  temporaryGitIndex(repository) {
    const absoluteIndex = this.gitIndexPath(repository);
    return absoluteIndex
      ? `${absoluteIndex}.okf-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
      : null;
  }

  removeTemporaryGitIndex(indexPath) {
    [indexPath, `${indexPath}.lock`].forEach((target) => {
      try {
        fs.unlinkSync(target);
      } catch (error) {
        if (!error || error.code !== "ENOENT") {
          // A leftover isolated index is inert and must not obscure the commit result.
        }
      }
    });
  }

  buildValidatedGitTree(preflight, candidates, files) {
    const indexPath = this.temporaryGitIndex(preflight.repository);
    if (!indexPath) {
      return { failure: { status: 1, stderr: "Could not allocate an isolated Git index." } };
    }
    const isolated = { environment: { GIT_INDEX_FILE: indexPath } };
    try {
      const seeded = this.runGit(
        preflight.repository,
        ["read-tree", preflight.headBefore],
        isolated,
      );
      if (!commandSucceeded(seeded)) {
        return { failure: seeded };
      }
      for (const candidate of candidates) {
        const hashed = this.runGit(preflight.repository, ["hash-object", "-w", "--stdin"], {
          input: candidate.markdown,
        });
        if (!commandSucceeded(hashed)) {
          return { failure: hashed };
        }
        const objectId = String(hashed.stdout || "").trim();
        let mode = "100644";
        if (candidate.op === "update") {
          const relativePath = path
            .relative(preflight.repository, candidate.target.absolutePath)
            .replace(/\\/g, "/");
          const seededEntry = this.runGit(
            preflight.repository,
            ["ls-files", "-s", "-z", "--", relativePath],
            isolated,
          );
          if (!commandSucceeded(seededEntry)) {
            return { failure: seededEntry };
          }
          const match = String(seededEntry.stdout || "").match(/^([0-7]{6})\s/);
          if (!match) {
            return {
              failure: {
                status: 1,
                stderr: `Could not preserve the pinned Git tree mode for ${relativePath}.`,
              },
            };
          }
          mode = match[1];
        }
        const updated = this.runGit(
          preflight.repository,
          [
            "update-index",
            "--add",
            "--cacheinfo",
            mode,
            objectId,
            path.relative(preflight.repository, candidate.target.absolutePath).replace(/\\/g, "/"),
          ],
          isolated,
        );
        if (!commandSucceeded(updated)) {
          return { failure: updated };
        }
      }
      const written = this.runGit(preflight.repository, ["write-tree"], isolated);
      if (!commandSucceeded(written)) {
        return { failure: written };
      }
      const expectedTree = String(written.stdout || "").trim();
      const changed = this.runGit(preflight.repository, [
        "diff",
        "--no-ext-diff",
        "--name-only",
        "-z",
        preflight.headBefore,
        expectedTree,
        "--",
      ]);
      const changedFiles = commandSucceeded(changed)
        ? String(changed.stdout || "")
            .split("\0")
            .filter(Boolean)
            .sort()
        : null;
      if (!changedFiles || !isDeepStrictEqual(changedFiles, files.slice().sort())) {
        return {
          expectedTree,
          failure: {
            status: 1,
            stderr: commandSucceeded(changed)
              ? "The isolated Git tree did not exactly match the validated OKF batch paths."
              : commandFailure(changed, "Could not inspect the isolated Git tree."),
          },
        };
      }
      return { expectedTree };
    } finally {
      this.removeTemporaryGitIndex(indexPath);
    }
  }

  commitGit(preflight, candidates, message) {
    if (!preflight.enabled) {
      return {
        enabled: false,
        committed: false,
        commitState: "not_requested",
        repository: Boolean(preflight.repository),
        repositoryRoot: preflight.repository,
        persistence: "working_tree",
      };
    }
    if (!preflight.repository) {
      return {
        enabled: true,
        repository: false,
        repositoryRoot: null,
        committed: false,
        commitState: "not_repository",
        persistence: "working_tree",
        reason: "not_git_repository",
      };
    }
    const files = this.repositoryFiles(preflight, candidates);
    let expectedTree = null;
    try {
      const initialTargets = this.inspectPublishedTargets(candidates);
      if (!initialTargets.validatedFilesPresent) {
        return this.finalizeGitFailure(
          preflight,
          files,
          {
            status: 1,
            stderr: "A published concept changed before the Git commit tree was built.",
          },
          null,
          candidates,
        );
      }
      const built = this.buildValidatedGitTree(preflight, candidates, files);
      expectedTree = built.expectedTree || null;
      if (built.failure) {
        return this.finalizeGitFailure(preflight, files, built.failure, expectedTree, candidates);
      }
      const verifiedTargets = this.inspectPublishedTargets(candidates);
      const headRefStillBefore = this.readGitValue(preflight.repository, [
        "symbolic-ref",
        "-q",
        "HEAD",
      ]);
      const refStillBefore = this.readGitValue(preflight.repository, [
        "rev-parse",
        "--verify",
        preflight.headRef,
      ]);
      if (
        !verifiedTargets.validatedFilesPresent ||
        headRefStillBefore !== preflight.headRef ||
        refStillBefore !== preflight.headBefore
      ) {
        return this.finalizeGitFailure(
          preflight,
          files,
          {
            status: 1,
            stderr: !verifiedTargets.validatedFilesPresent
              ? "A published concept changed before the Git ref update."
              : "The checked-out Git ref changed before the validated commit could be published.",
          },
          expectedTree,
          candidates,
        );
      }
      const committed = this.runGit(preflight.repository, [
        "commit-tree",
        expectedTree,
        "-p",
        preflight.headBefore,
        "-m",
        message,
      ]);
      if (!commandSucceeded(committed)) {
        return this.finalizeGitFailure(preflight, files, committed, expectedTree, candidates);
      }
      const commitSha = String(committed.stdout || "").trim();
      const finalTargets = this.inspectPublishedTargets(candidates);
      if (!finalTargets.validatedFilesPresent) {
        return this.finalizeGitFailure(
          preflight,
          files,
          {
            status: 1,
            stderr: "A published concept changed before the validated commit was published.",
          },
          expectedTree,
          candidates,
        );
      }
      const updated = this.runGit(preflight.repository, [
        "update-ref",
        "-m",
        "okf-mcp live authoring",
        preflight.headRef,
        commitSha,
        preflight.headBefore,
      ]);
      const classification = this.classifyCommit(preflight, expectedTree);
      if (!commandSucceeded(updated) || classification.committed !== true) {
        return this.finalizeGitFailure(preflight, files, updated, expectedTree, candidates);
      }
      const synchronized = this.synchronizeCommittedIndex(preflight, classification, files);
      const targets = this.inspectPublishedTargets(candidates);
      return Object.assign(
        {
          enabled: true,
          repository: true,
          repositoryRoot: preflight.repository,
          committed: true,
          commitState: "committed",
          persistence: "git_commit",
        },
        classification,
        synchronized,
        targets,
      );
    } catch (error) {
      return this.finalizeGitFailure(
        preflight,
        files,
        { status: null, stdout: "", stderr: "", error },
        expectedTree,
        candidates,
      );
    }
  }
}

module.exports = {
  GitPublisher,
};
