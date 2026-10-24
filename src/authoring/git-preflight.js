"use strict";

const path = require("node:path");

const {
  AuthoringOperationalError,
  MAX_EFFECT_ITEMS,
  commandFailure,
  commandOutput,
  commandSucceeded,
  sortedUnique,
} = require("./shared");

function activeGitFilterAttributes(git, repository, candidates) {
  const tracked = git.runGit(repository, ["ls-files", "-z"], { readOnly: true });
  if (!commandSucceeded(tracked)) {
    throw new AuthoringOperationalError(
      `Could not inspect tracked Git paths: ${commandFailure(tracked, "git ls-files failed")}`,
    );
  }
  const paths = sortedUnique(
    String(tracked.stdout || "").split("\0").filter(Boolean)
      .concat(git.repositoryFiles({ repository }, candidates)),
  );
  const active = [];
  for (let offset = 0; offset < paths.length; offset += 200) {
    const chunk = paths.slice(offset, offset + 200);
    const inspected = git.runGit(
      repository,
      ["check-attr", "-z", "--all", "--"].concat(chunk),
      { readOnly: true },
    );
    if (!commandSucceeded(inspected)) {
      throw new AuthoringOperationalError(
        `Could not inspect Git filter attributes: ${commandFailure(inspected, "git check-attr failed")}`,
      );
    }
    const values = String(inspected.stdout || "").split("\0");
    for (let index = 0; index + 2 < values.length; index += 3) {
      const attribute = values[index + 1];
      if (attribute === "filter") {
        active.push({ path: values[index], filter: values[index + 2] || "set" });
      }
    }
  }
  return active;
}

function unsupportedGitIndexFlags(git, repository) {
  const inspected = git.runGit(repository, ["ls-files", "-v", "-z"], { readOnly: true });
  if (!commandSucceeded(inspected)) {
    throw new AuthoringOperationalError(
      `Could not inspect Git index flags: ${commandFailure(inspected, "git ls-files failed")}`,
    );
  }
  return String(inspected.stdout || "").split("\0").filter(Boolean).flatMap((entry) => {
    const tag = entry[0] || "";
    const flagged = tag === "S" || (/[a-z]/.test(tag) && tag === tag.toLowerCase());
    if (!flagged) {
      return [];
    }
    return [{
      path: entry.slice(2),
      flag: tag === "S" ? "skip-worktree" : "assume-unchanged",
    }];
  });
}

function prepareGit(git, bundle, candidates) {
  const preflight = {
    enabled: git.gitCommit,
    repository: null,
    repositoryStatus: git.gitCommit ? "not_git_repository" : "not_inspected",
    repositoryRoot: null,
    headBefore: null,
    headRef: null,
    worktreeClean: null,
    identityConfigured: null,
    ready: !git.gitCommit,
    diagnostics: [],
  };
  if (!git.gitCommit) {
    return preflight;
  }
  const discovered = git.runGit(bundle.root, ["rev-parse", "--show-toplevel"], { readOnly: true });
  if (discovered.error) {
    if (git.gitCommit) {
      throw new AuthoringOperationalError(`Git executable is unavailable: ${discovered.error.message}`);
    }
    return Object.assign(preflight, {
      repositoryStatus: "unavailable",
      inspectionError: discovered.error.message,
    });
  }
  if (discovered.status !== 0) {
    const detail = commandOutput(discovered);
    if (/not a git repository/i.test(detail)) {
      preflight.ready = true;
      return preflight;
    }
    if (git.gitCommit) {
      throw new AuthoringOperationalError(`Could not inspect Git repository: ${detail || `git exited ${discovered.status}`}`);
    }
    return Object.assign(preflight, {
      repositoryStatus: "inspection_failed",
      inspectionError: detail || `git exited ${discovered.status}`,
    });
  }
  const repository = path.resolve(String(discovered.stdout || "").trim());
  preflight.repository = repository;
  preflight.repositoryRoot = repository;
  preflight.repositoryStatus = "detected";
  const symbolicHead = git.runGit(
    repository,
    ["symbolic-ref", "-q", "HEAD"],
    { readOnly: true },
  );
  if (symbolicHead.error || (symbolicHead.status !== 0 && symbolicHead.status !== 1)) {
    throw new AuthoringOperationalError(
      `Could not inspect the checked-out Git ref: ${commandFailure(symbolicHead, "git symbolic-ref failed")}`,
    );
  }
  const headRef = commandSucceeded(symbolicHead)
    ? String(symbolicHead.stdout || "").trim()
    : null;
  preflight.headRef = headRef;
  const headBefore = git.readGitValue(
    repository,
    ["rev-parse", "--verify", headRef || "HEAD"],
    { readOnly: true },
  );
  preflight.headBefore = headBefore;
  const missingIdentity = [];
  for (const key of ["user.name", "user.email"]) {
    const configured = git.runGit(repository, ["config", "--get", key], { readOnly: true });
    if (configured && configured.error) {
      throw new AuthoringOperationalError(
        `Could not inspect Git ${key}: ${configured.error.message}`,
      );
    }
    if (configured && configured.status !== 0 && configured.status !== 1) {
      throw new AuthoringOperationalError(
        `Could not inspect Git ${key}: ${commandFailure(configured, `git config exited ${configured.status}`)}`,
      );
    }
    if (!commandSucceeded(configured) || !String(configured.stdout || "").trim()) {
      missingIdentity.push(key);
    }
  }
  preflight.identityConfigured = missingIdentity.length === 0;
  const unsupportedIndexFlags = unsupportedGitIndexFlags(git, repository);
  preflight.unsupportedIndexFlags = unsupportedIndexFlags.slice(0, MAX_EFFECT_ITEMS);
  const activeFilters = activeGitFilterAttributes(git, repository, candidates);
  preflight.activeFilterAttributes = activeFilters.slice(0, MAX_EFFECT_ITEMS);
  if (!activeFilters.length && !unsupportedIndexFlags.length) {
    const status = git.runGit(
      repository,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { readOnly: true },
    );
    if (!commandSucceeded(status)) {
      throw new AuthoringOperationalError(
        `Could not inspect Git status: ${commandFailure(status, "git status failed")}`,
      );
    }
    preflight.worktreeClean = !String(status.stdout || "").trim();
  }
  preflight.ready = !git.gitCommit || Boolean(
    headBefore
    && headRef
    && preflight.worktreeClean
    && preflight.identityConfigured
    && !activeFilters.length
    && !unsupportedIndexFlags.length,
  );
  if (git.gitCommit && !headBefore) {
    preflight.diagnostics.push({
      code: "git_head_missing",
      message: "Git repository must have an existing HEAD before an automatic OKF commit.",
    });
  }
  if (git.gitCommit && headBefore && !headRef) {
    preflight.diagnostics.push({
      code: "git_detached_head_unsupported",
      message: "Automatic OKF commits require a checked-out symbolic branch; detached HEAD is not supported.",
    });
  }
  if (git.gitCommit && preflight.worktreeClean === false) {
    preflight.diagnostics.push({
      code: "git_worktree_dirty",
      message: "Git worktree must be completely clean before an automatic OKF commit.",
    });
  }
  if (git.gitCommit && missingIdentity.length) {
    preflight.diagnostics.push({
      code: "git_identity_missing",
      message: `Git ${missingIdentity[0]} must be configured before an automatic OKF commit.`,
    });
  }
  if (git.gitCommit && activeFilters.length) {
    preflight.diagnostics.push({
      code: "git_filter_attribute_unsupported",
      message: "Automatic OKF commits reject active Git filter attributes so validation cannot execute repository-configured filters and committed bytes remain exact.",
      paths: activeFilters.slice(0, MAX_EFFECT_ITEMS),
      omitted: Math.max(0, activeFilters.length - MAX_EFFECT_ITEMS),
    });
  }
  if (git.gitCommit && unsupportedIndexFlags.length) {
    preflight.diagnostics.push({
      code: "git_index_flag_unsupported",
      message: "Automatic OKF commits reject assume-unchanged and skip-worktree Git index flags because they can hide user changes from clean-worktree inspection.",
      paths: unsupportedIndexFlags.slice(0, MAX_EFFECT_ITEMS),
      omitted: Math.max(0, unsupportedIndexFlags.length - MAX_EFFECT_ITEMS),
    });
  }
  return preflight;
}

module.exports = {
  prepareGit,
};
