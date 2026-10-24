"use strict";

const fs = require("node:fs");
const {
  normalizeSlashes,
  parseMarkdownFile,
  parseMarkdownText,
  safeRelativePath,
} = require("../parser");
const { DEFAULT_RELATION_TYPES, loadProjectConfig } = require("../project");
const { fetchRemoteBundles } = require("../remote");
const { validateIndex } = require("../validation");
const { applyProject, attachValidation, completeIndex, indexRecord } = require("./assemble");
const {
  bundleAllowsPath,
  bundleExcludesPath,
  documentAbsolutePath,
  documentOverrideKey,
  parseBundleArg,
  sanitizeBundleId,
  uniqueBundleIds,
  walkMarkdown,
} = require("./paths");

function buildConfig(options) {
  const config = options || {};
  return {
    options: config,
    documentOverrides:
      config.documentOverrides instanceof Map ? config.documentOverrides : new Map(),
    documentDeletions:
      config.documentDeletions instanceof Set ? config.documentDeletions : new Set(),
    strictLinks: Boolean(config.strictLinks),
    asOf: config.asOf,
    maxAssetBytes: config.maxAssetBytes,
    edgeConfig: {
      allowedRelationTypes: new Set((config.relationTypes || DEFAULT_RELATION_TYPES).map(String)),
      allowCustomRelationTypes: Boolean(config.allowCustomRelationTypes),
    },
  };
}

function fileStat(absolutePath) {
  try {
    const stat = fs.statSync(absolutePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

// Parses one document into an index entry. A document given as text is
// parsed from it; otherwise the file is read, after recording its size and
// mtime so a later refresh can tell whether it changed. A parse failure keeps
// the entry, as a parse_error, in the bundle's load order.
function parseEntry(bundle, relativePath, absolutePath, text, config) {
  // `source` records where the entry's bytes came from: "disk" entries carry
  // the file's stat, "text" entries carry the text itself so a later full
  // rebuild can fold them back in as overrides.
  const entry = {
    relativePath,
    absolutePath,
    doc: null,
    parseError: null,
    stat: null,
    source: text === undefined ? "disk" : "text",
    text,
    derived: null,
  };
  try {
    if (text === undefined) {
      entry.stat = fileStat(absolutePath);
      entry.doc = parseMarkdownFile(bundle, absolutePath, { asOf: config.asOf });
    } else {
      entry.doc = parseMarkdownText(bundle, relativePath, text, absolutePath, {
        asOf: config.asOf,
      });
    }
  } catch (error) {
    entry.parseError = {
      code: "parse_error",
      bundle: bundle.id,
      path: relativePath,
      message: error.message,
    };
  }
  return entry;
}

function missingRootError(bundle) {
  return {
    code: "missing_bundle_root",
    bundle: bundle.id,
    path: bundle.root,
    message: "Bundle root does not exist.",
  };
}

function loadLocalBundle(bundle, config) {
  const bundleRecord = { bundle, rootMissing: null, entries: [], remoteWarnings: [] };
  if (!fs.existsSync(bundle.root)) {
    bundleRecord.rootMissing = missingRootError(bundle);
    return bundleRecord;
  }
  const indexedPaths = new Set();
  walkMarkdown(bundle.root).forEach((filePath) => {
    const relativePath = safeRelativePath(bundle.root, filePath) || normalizeSlashes(filePath);
    if (!bundleAllowsPath(bundle, relativePath)) {
      return;
    }
    const key = documentOverrideKey(bundle.id, relativePath);
    if (config.documentDeletions.has(key)) {
      return;
    }
    indexedPaths.add(relativePath);
    bundleRecord.entries.push(
      parseEntry(
        bundle,
        relativePath,
        filePath,
        config.documentOverrides.has(key) ? String(config.documentOverrides.get(key)) : undefined,
        config,
      ),
    );
  });
  const prefix = `${bundle.id}\u0000`;
  config.documentOverrides.forEach((text, key) => {
    if (!String(key).startsWith(prefix)) {
      return;
    }
    const relativePath = normalizeSlashes(String(key).slice(prefix.length));
    if (
      config.documentDeletions.has(key) ||
      indexedPaths.has(relativePath) ||
      !bundleAllowsPath(bundle, relativePath)
    ) {
      return;
    }
    bundleRecord.entries.push(
      parseEntry(
        bundle,
        relativePath,
        documentAbsolutePath(bundle, relativePath),
        String(text),
        config,
      ),
    );
  });
  return bundleRecord;
}

function loadRemoteBundle(bundle, config) {
  const bundleRecord = { bundle, rootMissing: null, entries: [], remoteWarnings: [] };
  (bundle.documents || []).forEach((remoteDoc) => {
    const relativePath = normalizeSlashes(remoteDoc.path);
    if (!bundleAllowsPath(bundle, relativePath)) {
      return;
    }
    const entry = parseEntry(
      bundle,
      relativePath,
      remoteDoc.source || relativePath,
      String(remoteDoc.text || ""),
      config,
    );
    entry.source = "remote";
    bundleRecord.entries.push(entry);
  });
  const unresolved = bundle.remoteSource?.unresolvedReferences || [];
  bundleRecord.remoteWarnings = unresolved.map((entry) =>
    Object.assign(
      {
        severity: "warning",
        layer: "project",
        bundle: bundle.id,
        message: `Referenced remote asset is unavailable: ${entry.resolvedPath || entry.target || "<unknown>"}`,
      },
      entry,
    ),
  );
  return bundleRecord;
}

function buildIndex(bundleArgs, options) {
  const config = buildConfig(options);
  const requestedBundles = uniqueBundleIds((bundleArgs || []).map(parseBundleArg));
  const seenBundleIds = new Set();
  const bundles = [];
  const duplicateBundleErrors = [];
  requestedBundles.forEach((bundle) => {
    if (seenBundleIds.has(bundle.id)) {
      duplicateBundleErrors.push({
        code: "duplicate_bundle_id",
        bundle: bundle.id,
        message: "Duplicate bundle id; the later bundle was ignored.",
      });
      return;
    }
    seenBundleIds.add(bundle.id);
    bundles.push(bundle);
  });
  const record = {
    bundleArgs: (bundleArgs || []).slice(),
    options: config.options,
    config,
    project: null,
    duplicateBundleErrors,
    bundles: bundles.map((bundle) =>
      bundle.remote ? loadRemoteBundle(bundle, config) : loadLocalBundle(bundle, config),
    ),
    registration: null,
    assets: null,
    // Keys of documents removed from the index while their files remain.
    overlayDeletions: new Set(),
    stats: { mode: "build" },
  };
  const owned = new Set();
  record.bundles.forEach((bundleRecord) => {
    bundleRecord.entries.forEach((entry) => {
      owned.add(entry);
    });
  });
  return completeIndex(record, { owned });
}

function buildProjectIndex(projectPath) {
  const project = loadProjectConfig(projectPath);
  const index = buildIndex(project.bundles, {
    relationTypes: project.relationTypes,
    strictLinks: project.strictLinks,
  });
  return attachProject(index, project);
}

async function loadProjectBundles(projectPath, options) {
  const project = loadProjectConfig(projectPath);
  const remoteBundles = await fetchRemoteBundles(project.remoteBundles, options || {});
  return {
    project,
    bundles: project.bundles.concat(remoteBundles),
    remoteBundles,
  };
}

async function buildProjectIndexAsync(projectPath, options) {
  const loaded = await loadProjectBundles(projectPath, options);
  const index = buildIndex(loaded.bundles, {
    relationTypes: loaded.project.relationTypes,
    strictLinks:
      options && options.strictLinks !== undefined
        ? options.strictLinks
        : loaded.project.strictLinks,
  });
  return attachProject(index, loaded.project);
}

// Attaches project configuration to a built index in place, as before, and
// remembers the project on the index's record so an incremental update of
// this index carries it forward.
function attachProject(index, project) {
  if (!project) {
    return index;
  }
  const record = indexRecord(index);
  if (record) {
    record.project = project;
  }
  applyProject(index, project);
  return attachValidation(index);
}

module.exports = {
  attachProject,
  attachValidation,
  buildIndex,
  buildProjectIndex,
  buildProjectIndexAsync,
  bundleAllowsPath,
  bundleExcludesPath,
  loadProjectBundles,
  missingRootError,
  parseBundleArg,
  parseEntry,
  sanitizeBundleId,
  validateIndex,
};
