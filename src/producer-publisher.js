"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_NAME = ".okf-producer.json";

class ProducerPublicationError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "ProducerPublicationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function sha256(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeProducedPath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new ProducerPublicationError("Producer paths must be safe bundle-relative Markdown paths.", "invalid_producer_path");
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new ProducerPublicationError("Producer paths cannot contain empty, hidden, dot, or parent segments.", "invalid_producer_path");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new ProducerPublicationError("Producer output files must be Markdown documents.", "invalid_producer_path");
  }
  return normalized;
}

function normalizeProducedFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ProducerPublicationError("Producer generate() must return a non-empty files array.", "invalid_producer_output");
  }
  const seen = new Set();
  return files.map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new ProducerPublicationError("Each producer file must be an object.", "invalid_producer_output");
    }
    const relativePath = normalizeProducedPath(file.path);
    if (seen.has(relativePath)) {
      throw new ProducerPublicationError("Producer output paths must be unique.", "duplicate_producer_path", { path: relativePath });
    }
    seen.add(relativePath);
    if (typeof file.content !== "string") {
      throw new ProducerPublicationError("Producer file content must be a string.", "invalid_producer_content", { path: relativePath });
    }
    return { path: relativePath, content: file.content, sha256: sha256(file.content) };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function assertRegularPath(root, relativePath) {
  let current = root;
  const parts = relativePath.split("/");
  parts.forEach((part, index) => {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new ProducerPublicationError("Producer-managed paths cannot traverse symbolic links.", "producer_path_symlink", { path: parts.slice(0, index + 1).join("/") });
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new ProducerPublicationError("A producer-managed path parent is not a directory.", "producer_path_parent_not_directory", { path: parts.slice(0, index + 1).join("/") });
    }
    if (index === parts.length - 1 && !stat.isFile()) {
      throw new ProducerPublicationError("Producer-managed files must be regular files.", "producer_path_not_file", { path: relativePath });
    }
  });
}

function readManifest(root, producer) {
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return null;
  assertRegularPath(root, MANIFEST_NAME);
  let manifest;
  let content;
  try {
    content = fs.readFileSync(manifestPath);
    manifest = JSON.parse(content.toString("utf8"));
  } catch {
    throw new ProducerPublicationError("The producer ownership manifest is invalid.", "invalid_producer_manifest");
  }
  if (!manifest || manifest.version !== 1 || manifest.producer !== producer.type
    || manifest.bundle !== producer.bundle || !Array.isArray(manifest.files)) {
    throw new ProducerPublicationError("The producer ownership manifest does not match this configured producer.", "invalid_producer_manifest");
  }
  const owned = new Map();
  manifest.files.forEach((entry) => {
    const relativePath = normalizeProducedPath(entry && entry.path);
    if (owned.has(relativePath) || !entry || !/^sha256:[a-f0-9]{64}$/.test(String(entry.sha256 || ""))) {
      throw new ProducerPublicationError("The producer ownership manifest contains an invalid file entry.", "invalid_producer_manifest");
    }
    owned.set(relativePath, String(entry.sha256));
  });
  return { manifest, owned, sha256: sha256(content) };
}

function verifyOwnedFiles(root, owned) {
  owned.forEach((expected, relativePath) => {
    assertRegularPath(root, relativePath);
    const absolutePath = path.join(root, ...relativePath.split("/"));
    if (!fs.existsSync(absolutePath) || sha256(fs.readFileSync(absolutePath)) !== expected) {
      throw new ProducerPublicationError("A producer-owned file changed outside the producer.", "producer_owned_file_modified", { path: relativePath });
    }
  });
}

function inspectPublication(root, producer, files) {
  const manifestState = readManifest(root, producer);
  const owned = manifestState ? manifestState.owned : new Map();
  verifyOwnedFiles(root, owned);
  const generated = new Map(files.map((file) => [file.path, file]));
  const changes = { create: [], update: [], delete: [], unchanged: [] };
  files.forEach((file) => {
    assertRegularPath(root, file.path);
    const absolutePath = path.join(root, ...file.path.split("/"));
    if (fs.existsSync(absolutePath) && !owned.has(file.path)) {
      throw new ProducerPublicationError("Producer output collides with an unowned file.", "producer_unowned_collision", { path: file.path });
    }
    if (!owned.has(file.path)) changes.create.push(file.path);
    else if (owned.get(file.path) === file.sha256) changes.unchanged.push(file.path);
    else changes.update.push(file.path);
  });
  owned.forEach((_digest, relativePath) => {
    if (!generated.has(relativePath)) changes.delete.push(relativePath);
  });
  Object.values(changes).forEach((entries) => entries.sort());
  return {
    changes,
    owned,
    previousManifest: manifestState && manifestState.manifest,
    previousManifestSha256: manifestState && manifestState.sha256,
  };
}

function manifestFor(producer, files) {
  return {
    version: 1,
    producer: producer.type,
    producerVersion: producer.version,
    bundle: producer.bundle,
    files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  };
}

function snapshotFile(absolutePath) {
  if (!fs.existsSync(absolutePath)) return { exists: false };
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ProducerPublicationError("Producer-managed files must be regular files.", "producer_path_not_file");
  }
  return { exists: true, content: fs.readFileSync(absolutePath), mode: stat.mode & 0o777 };
}

function snapshotMatches(absolutePath, expected) {
  try {
    const current = snapshotFile(absolutePath);
    if (current.exists !== expected.exists) return false;
    return !current.exists || current.content.equals(expected.content);
  } catch {
    return false;
  }
}

function assertSnapshotMatches(absolutePath, expected, relativePath) {
  if (!snapshotMatches(absolutePath, expected)) {
    throw new ProducerPublicationError(
      "A producer target changed during publication.",
      "producer_publication_conflict",
      { path: relativePath },
    );
  }
}

function ensureParent(root, absolutePath, createdDirectories) {
  const relative = path.relative(root, path.dirname(absolutePath));
  let current = root;
  relative.split(path.sep).filter(Boolean).forEach((part) => {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current);
      createdDirectories.push(current);
    } else if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
      throw new ProducerPublicationError("Producer output parents must be ordinary directories.", "producer_path_parent_not_directory");
    }
  });
}

function atomicWrite(root, absolutePath, content, createdDirectories) {
  ensureParent(root, absolutePath, createdDirectories);
  const temporaryPath = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, content, { flag: "wx" });
    fs.renameSync(temporaryPath, absolutePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function restoreFiles(root, snapshots, published, createdDirectories) {
  const conflicts = [];
  Array.from(published.entries()).reverse().forEach(([absolutePath, expected]) => {
    const snapshot = snapshots.get(absolutePath);
    if (!snapshotMatches(absolutePath, expected)) {
      conflicts.push(path.relative(root, absolutePath).replace(/\\/g, "/"));
      return;
    }
    if (snapshot.exists) {
      atomicWrite(root, absolutePath, snapshot.content, []);
      fs.chmodSync(absolutePath, snapshot.mode);
    } else if (fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isFile()) {
      fs.unlinkSync(absolutePath);
    }
  });
  createdDirectories.reverse().forEach((directory) => {
    try {
      fs.rmdirSync(directory);
    } catch {
      // Preserve a directory if another file appeared while publication was in progress.
    }
  });
  if (conflicts.length) {
    throw new ProducerPublicationError(
      "Producer publication failed and concurrent replacements were preserved.",
      "producer_rollback_conflict",
      { paths: conflicts.sort().slice(0, 100) },
    );
  }
}

class ProducerPublisher {
  constructor(project, store) {
    this.project = project;
    this.store = store;
  }

  bundleRoot(bundleId) {
    const bundle = this.project.bundles.find((entry) => entry.id === bundleId && !entry.remote);
    if (!bundle) throw new ProducerPublicationError("Configured producer bundle is unavailable.", "unknown_producer_bundle");
    return this.store.resolveWritableBundleRoot(bundle);
  }

  inspect(producer, files) {
    const root = this.bundleRoot(producer.bundle);
    return Object.assign({ root }, inspectPublication(root, producer, files));
  }

  async publish(producer, files, validatePersisted) {
    const inspection = this.inspect(producer, files);
    const root = inspection.root;
    const manifestPath = path.join(root, MANIFEST_NAME);
    const manifestContent = `${JSON.stringify(manifestFor(producer, files), null, 2)}\n`;
    const changedPaths = inspection.changes.create
      .concat(inspection.changes.update, inspection.changes.delete);
    if (changedPaths.length === 0 && inspection.previousManifestSha256 === sha256(manifestContent)) {
      if (validatePersisted) await validatePersisted();
      return inspection.changes;
    }
    const touched = new Set(changedPaths.concat(MANIFEST_NAME));
    const snapshots = new Map();
    touched.forEach((relativePath) => snapshots.set(
      path.join(root, ...relativePath.split("/")),
      snapshotFile(path.join(root, ...relativePath.split("/"))),
    ));
    inspection.changes.create.forEach((relativePath) => {
      assertSnapshotMatches(
        path.join(root, ...relativePath.split("/")),
        { exists: false },
        relativePath,
      );
    });
    inspection.changes.update.concat(inspection.changes.delete).forEach((relativePath) => {
      const expectedDigest = inspection.owned.get(relativePath);
      const snapshot = snapshots.get(path.join(root, ...relativePath.split("/")));
      if (!snapshot.exists || sha256(snapshot.content) !== expectedDigest) {
        throw new ProducerPublicationError(
          "A producer-owned file changed during publication.",
          "producer_publication_conflict",
          { path: relativePath },
        );
      }
    });
    const manifestSnapshot = snapshots.get(manifestPath);
    if (inspection.previousManifestSha256) {
      if (!manifestSnapshot.exists || sha256(manifestSnapshot.content) !== inspection.previousManifestSha256) {
        throw new ProducerPublicationError("The producer ownership manifest changed during publication.", "producer_publication_conflict");
      }
    } else if (manifestSnapshot.exists) {
      throw new ProducerPublicationError("The producer ownership manifest changed during publication.", "producer_publication_conflict");
    }
    const createdDirectories = [];
    const published = new Map();
    try {
      inspection.changes.delete.forEach((relativePath) => {
        const absolutePath = path.join(root, ...relativePath.split("/"));
        assertSnapshotMatches(absolutePath, snapshots.get(absolutePath), relativePath);
        fs.unlinkSync(absolutePath);
        published.set(absolutePath, { exists: false });
      });
      const filesByPath = new Map(files.map((file) => [file.path, file]));
      inspection.changes.create.concat(inspection.changes.update).forEach((relativePath) => {
        const file = filesByPath.get(relativePath);
        const absolutePath = path.join(root, ...relativePath.split("/"));
        assertSnapshotMatches(absolutePath, snapshots.get(absolutePath), relativePath);
        atomicWrite(root, absolutePath, file.content, createdDirectories);
        published.set(absolutePath, { exists: true, content: Buffer.from(file.content) });
      });
      assertSnapshotMatches(manifestPath, manifestSnapshot, MANIFEST_NAME);
      atomicWrite(root, manifestPath, manifestContent, createdDirectories);
      published.set(manifestPath, { exists: true, content: Buffer.from(manifestContent) });
      if (validatePersisted) await validatePersisted();
      return inspection.changes;
    } catch (error) {
      try {
        restoreFiles(root, snapshots, published, createdDirectories);
      } catch (rollbackError) {
        if (rollbackError instanceof ProducerPublicationError) throw rollbackError;
        throw new ProducerPublicationError("Producer publication failed and rollback could not be completed.", "producer_rollback_failed");
      }
      throw error;
    }
  }
}

module.exports = {
  MANIFEST_NAME,
  ProducerPublicationError,
  ProducerPublisher,
  manifestFor,
  normalizeProducedFiles,
  normalizeProducedPath,
  sha256,
};
