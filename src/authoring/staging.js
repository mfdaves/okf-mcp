"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { revisionFor } = require("./shared");

function temporaryPath(target) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
}

function restoreFile(target, text, mode) {
  const temporary = temporaryPath(target);
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    if (mode !== null && mode !== undefined) {
      fs.chmodSync(temporary, mode);
    }
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

function ensureParentDirectories(store, candidate, createdDirectories) {
  const bundleRoot = store.resolveWritableBundleRoot(store.getBundle(candidate.bundle));
  const parent = path.dirname(candidate.target.absolutePath);
  const relative = path.relative(bundleRoot, parent);
  let current = bundleRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Concept parent is not a safe directory: ${current}`);
      }
      continue;
    }
    fs.mkdirSync(current);
    createdDirectories.push(current);
  }
}

function cleanupDirectories(createdDirectories) {
  createdDirectories
    .slice()
    .sort((left, right) => right.length - left.length)
    .forEach((directory) => {
      try {
        fs.rmdirSync(directory);
      } catch (error) {
        if (!error || !["ENOENT", "ENOTEMPTY"].includes(error.code)) {
          throw error;
        }
      }
    });
}

function stageCandidates(store, candidates) {
  const staged = [];
  const createdDirectories = [];
  try {
    candidates.forEach((candidate) => {
      ensureParentDirectories(store, candidate, createdDirectories);
      const temporary = temporaryPath(candidate.target.absolutePath);
      fs.writeFileSync(temporary, candidate.markdown, { encoding: "utf8", flag: "wx" });
      const stagedCandidate = Object.assign({}, candidate, { temporary });
      staged.push(stagedCandidate);
      if (candidate.op === "update") {
        fs.chmodSync(temporary, candidate.originalMode);
      }
    });
    return { staged, createdDirectories };
  } catch (error) {
    staged.forEach((entry) => {
      if (fs.existsSync(entry.temporary)) fs.unlinkSync(entry.temporary);
    });
    cleanupDirectories(createdDirectories);
    throw error;
  }
}

function assertRevisions(staged) {
  staged.forEach((candidate) => {
    const exists = fs.existsSync(candidate.target.absolutePath);
    if (candidate.op === "create" && exists) {
      throw new Error(`Concept file appeared during batch preparation: ${candidate.path}`);
    }
    if (candidate.op === "update") {
      if (!exists) {
        throw new Error(`Concept file disappeared during batch preparation: ${candidate.path}`);
      }
      const currentRevision = revisionFor(fs.readFileSync(candidate.target.absolutePath));
      if (currentRevision !== candidate.baseRevision) {
        throw new Error(`Concept changed during batch preparation: ${candidate.path}`);
      }
    }
  });
}

function inspectPublishedTarget(candidate) {
  try {
    const stat = fs.lstatSync(candidate.target.absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { state: "non_regular", revision: null };
    }
    return {
      state: "regular",
      revision: revisionFor(fs.readFileSync(candidate.target.absolutePath)),
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { state: "missing", revision: null };
    }
    throw error;
  }
}

function rollbackCandidate(candidate) {
  const inspected = inspectPublishedTarget(candidate);
  const receipt = {
    op: candidate.op,
    path: candidate.path,
    absolutePath: candidate.target.absolutePath,
    expectedPublishedRevision: candidate.publishedRevision,
    observedRevision: inspected.revision,
  };
  if (candidate.op === "create" && inspected.state === "missing") {
    return Object.assign(receipt, { status: "already_absent", restored: true });
  }
  if (inspected.state !== "regular" || inspected.revision !== candidate.publishedRevision) {
    return Object.assign(receipt, {
      status: "conflict",
      restored: false,
      observedState: inspected.state,
    });
  }
  if (candidate.op === "create") {
    fs.unlinkSync(candidate.target.absolutePath);
    return Object.assign(receipt, { status: "removed", restored: true });
  }
  restoreFile(candidate.target.absolutePath, candidate.originalText, candidate.originalMode);
  const restored = inspectPublishedTarget(candidate);
  if (restored.state !== "regular" || restored.revision !== candidate.baseRevision) {
    return Object.assign(receipt, {
      status: "restore_verification_failed",
      restored: false,
      restoredRevision: restored.revision,
    });
  }
  return Object.assign(receipt, {
    status: "restored",
    restored: true,
    restoredRevision: restored.revision,
  });
}

function rollback(applied, staged, createdDirectories) {
  const failures = [];
  const outcomes = [];
  staged.forEach((candidate) => {
    if (fs.existsSync(candidate.temporary)) {
      try {
        fs.unlinkSync(candidate.temporary);
      } catch (error) {
        failures.push(error);
      }
    }
  });
  applied
    .slice()
    .reverse()
    .forEach((candidate) => {
      try {
        outcomes.push(rollbackCandidate(candidate));
      } catch (error) {
        const failure = {
          op: candidate.op,
          path: candidate.path,
          absolutePath: candidate.target.absolutePath,
          status: "error",
          restored: false,
          error: error && error.message ? error.message : String(error),
        };
        outcomes.push(failure);
        failures.push(failure);
      }
    });
  try {
    cleanupDirectories(createdDirectories || []);
  } catch (error) {
    failures.push({
      status: "directory_cleanup_error",
      error: error && error.message ? error.message : String(error),
    });
  }
  const conflicts = outcomes.filter((outcome) => !outcome.restored);
  return {
    complete: conflicts.length === 0 && failures.length === 0,
    outcomes,
    conflicts,
    failures,
  };
}

module.exports = {
  assertRevisions,
  rollback,
  stageCandidates,
};
