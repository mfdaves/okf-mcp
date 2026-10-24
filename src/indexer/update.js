"use strict";

const fs = require("node:fs");
const { isDeepStrictEqual } = require("node:util");
const { collectAssetReferences } = require("../assets");
const { normalizeSlashes, safeRelativePath } = require("../parser");
const { assetKeys, completeIndex, documentKeys, indexRecord } = require("./assemble");
const { attachProject, buildIndex, dayKey, missingRootError, parseEntry } = require("./build");
const {
  bundleAllowsPath,
  documentAbsolutePath,
  documentOverrideKey,
  fileStat,
  sameStat,
  walkMarkdown,
} = require("./paths");

// Above this share of changed documents an update rebuilds the index: the
// bookkeeping of an incremental update no longer pays for itself, and the
// producer and remote-bundle paths, which replace whole bundles, land here.
const DEFAULT_MAX_CHANGE_RATIO = 0.2;

// Derived views over an index, memoised per index object. An index is never
// mutated after it is built, so a WeakMap keyed by the index object is a sound
// cache: a rebuilt or updated index is a new object with a fresh entry, and
// the entry of an index that is garbage-collected goes with it.
const LINK_SETS = new WeakMap();
const EDGES_BY_SOURCE = new WeakMap();

// Outbound and inbound neighbour sets over the index's non-broken edges, keyed
// by concept URI. Filters that ask "linked to" or "linked from" read these.
function linkSets(index) {
  let sets = LINK_SETS.get(index);
  if (sets) {
    return sets;
  }
  const outbound = new Map();
  const inbound = new Map();
  (index.edges || []).forEach((edge) => {
    if (edge.broken) {
      return;
    }
    if (!outbound.has(edge.source)) {
      outbound.set(edge.source, new Set());
    }
    if (!inbound.has(edge.target)) {
      inbound.set(edge.target, new Set());
    }
    outbound.get(edge.source).add(edge.target);
    inbound.get(edge.target).add(edge.source);
  });
  sets = { outbound, inbound };
  LINK_SETS.set(index, sets);
  return sets;
}

// Every edge of the index grouped by its source URI, in index edge order.
function edgesBySource(index) {
  let grouped = EDGES_BY_SOURCE.get(index);
  if (grouped) {
    return grouped;
  }
  grouped = new Map();
  (index.edges || []).forEach((edge) => {
    const list = grouped.get(edge.source);
    if (list) {
      list.push(edge);
    } else {
      grouped.set(edge.source, [edge]);
    }
  });
  EDGES_BY_SOURCE.set(index, grouped);
  return grouped;
}

// What the last build or update of this index did: { mode: "build" |
// "incremental" | "full", changed, total, ratio, derived, documents, ... }.
// Null for an object that did not come out of buildIndex or updateIndex.
function indexUpdateStats(index) {
  const record = indexRecord(index);
  return record ? Object.assign({}, record.stats) : null;
}

// Every input that shaped an index, for a host deciding whether an index
// built elsewhere can stand in for a build of its own: the bundles (id,
// root, remote, include and exclude patterns), the relation types and flags,
// the date (null when it floats with the calendar) and the languages set on
// the index. Null for an object that did not come out of buildIndex.
function indexInputs(index) {
  const record = indexRecord(index);
  if (!record) {
    return null;
  }
  return {
    bundles: record.bundles.map(({ bundle }) => ({
      id: bundle.id,
      root: bundle.root,
      remote: Boolean(bundle.remote),
      include: (bundle.include || []).map(String),
      exclude: (bundle.exclude || []).map(String),
    })),
    relationTypes: Array.from(record.config.edgeConfig.allowedRelationTypes),
    allowCustomRelationTypes: record.config.edgeConfig.allowCustomRelationTypes,
    strictLinks: record.config.strictLinks,
    asOf: record.config.floatingDate ? null : record.config.asOf,
    languages: index.languages === undefined ? null : index.languages,
  };
}

function normalizeRelativePath(value) {
  const relativePath = normalizeSlashes(String(value || "").trim());
  const parts = relativePath.split("/");
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:\//.test(relativePath) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new TypeError(`Index update paths must be safe bundle-relative paths: ${value}`);
  }
  if (!relativePath.toLowerCase().endsWith(".md")) {
    throw new TypeError(`Index update paths must name Markdown documents: ${value}`);
  }
  return relativePath;
}

function isParsedDocument(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.pathUri === "string" &&
    typeof value.bundle === "string" &&
    typeof value.path === "string" &&
    typeof value.text === "string"
  );
}

function targetFromUri(index, uri) {
  const doc = index.byPathUri?.get(uri) || index.byUri?.get(uri) || null;
  return doc ? { bundleId: doc.bundle, relativePath: doc.path } : null;
}

function targetFromEntry(entry, label) {
  const bundleId = String(entry.bundleId || entry.bundle || "");
  if (!bundleId) {
    throw new TypeError(`Index update ${label} entries need a bundleId.`);
  }
  return { bundleId, relativePath: normalizeRelativePath(entry.relativePath || entry.path) };
}

// A deletion names a document by URI (canonical, alias or path form), by
// { bundleId, relativePath }, as a parsed document, or as a bare relative
// path when the index has exactly one local bundle. An unknown URI deletes
// nothing.
function deletionTarget(index, record, entry) {
  if (typeof entry === "string") {
    if (entry.startsWith("okf://")) {
      return targetFromUri(index, entry);
    }
    const locals = record.bundles.filter((bundleRecord) => !bundleRecord.bundle.remote);
    if (locals.length !== 1) {
      throw new TypeError(
        "A bare relative path deletion needs exactly one local bundle; pass { bundleId, relativePath }.",
      );
    }
    return { bundleId: locals[0].bundle.id, relativePath: normalizeRelativePath(entry) };
  }
  if (entry && typeof entry === "object") {
    if (isParsedDocument(entry)) {
      return { bundleId: entry.bundle, relativePath: normalizeRelativePath(entry.path) };
    }
    if (typeof entry.uri === "string" && !entry.bundleId && !entry.relativePath) {
      return targetFromUri(index, entry.uri);
    }
    return targetFromEntry(entry, "deletion");
  }
  throw new TypeError(
    "Index update deletions must be URIs, paths, parsed documents, or { bundleId, relativePath }.",
  );
}

// An upsert is a parsed document, { bundleId, relativePath, text }, or
// { bundleId, relativePath } to read the document back from the bundle root.
function upsertTarget(entry) {
  if (isParsedDocument(entry)) {
    return { bundleId: entry.bundle, relativePath: normalizeRelativePath(entry.path), doc: entry };
  }
  if (!entry || typeof entry !== "object") {
    throw new TypeError(
      "Index update upserts must be parsed documents or { bundleId, relativePath, text? }.",
    );
  }
  const target = targetFromEntry(entry, "upsert");
  target.text = entry.text === undefined ? undefined : String(entry.text);
  return target;
}

function bundleRecordFor(record, bundleId) {
  const found = record.bundles.find((bundleRecord) => bundleRecord.bundle.id === bundleId);
  if (!found) {
    throw new TypeError(`Unknown bundle in index update: ${bundleId}`);
  }
  if (found.bundle.remote) {
    throw new TypeError(`Remote bundles cannot be updated in place: ${bundleId}`);
  }
  return found;
}

// Groups the requested changes per bundle. Deletions apply before upserts, so
// a path in both is an upsert; paths the bundle policy excludes are dropped,
// as a build would drop them; deletions of unknown paths count for nothing.
// `assetsChanged` says the asset files may differ from what the index saw,
// so the registry is rebuilt and the documents that depend on assets are
// re-derived.
function planChanges(index, record, changes) {
  const input = changes || {};
  const plan = { bundles: new Map(), changed: 0, assetsChanged: Boolean(input.assetsChanged) };
  const touch = (bundleId) => {
    let state = plan.bundles.get(bundleId);
    if (!state) {
      const bundleRecord = bundleRecordFor(record, bundleId);
      state = {
        bundleRecord,
        known: new Set(bundleRecord.entries.map((entry) => entry.relativePath)),
        deletions: new Set(),
        upserts: new Map(),
      };
      plan.bundles.set(bundleId, state);
    }
    return state;
  };
  (Array.isArray(input.deletions) ? input.deletions : []).forEach((raw) => {
    const target = deletionTarget(index, record, raw);
    if (!target) {
      return;
    }
    const state = touch(target.bundleId);
    if (state.known.has(target.relativePath)) {
      state.deletions.add(target.relativePath);
    }
  });
  (Array.isArray(input.upserts) ? input.upserts : []).forEach((raw) => {
    const target = upsertTarget(raw);
    const state = touch(target.bundleId);
    if (!bundleAllowsPath(state.bundleRecord.bundle, target.relativePath)) {
      return;
    }
    state.deletions.delete(target.relativePath);
    state.upserts.set(target.relativePath, target);
  });
  plan.bundles.forEach((state) => {
    plan.changed += state.deletions.size + state.upserts.size;
  });
  return plan;
}

// A full build with the same inputs as the index, for the given day. What the
// index holds apart from the files (documents kept as text, documents removed
// while their files remain) and the requested changes are folded into the
// document overrides and deletions of this one build, so the rebuilt index
// describes the same state; the rebuilt record keeps the original options and
// carries the overlay state on its entries and in overlayDeletions, never as
// pins that would outlive the files.
function rebuildIndex(record, plan, stats, asOf) {
  const overrides = new Map(record.config.documentOverrides);
  const deletions = new Set(record.config.documentDeletions);
  const overlayDeletions = new Set(record.overlayDeletions);
  overlayDeletions.forEach((key) => {
    deletions.add(key);
  });
  record.bundles.forEach((bundleRecord) => {
    bundleRecord.entries.forEach((entry) => {
      if (entry.source === "text") {
        overrides.set(documentOverrideKey(bundleRecord.bundle.id, entry.relativePath), entry.text);
      }
    });
  });
  plan.bundles.forEach((state, bundleId) => {
    state.deletions.forEach((relativePath) => {
      const key = documentOverrideKey(bundleId, relativePath);
      overrides.delete(key);
      deletions.add(key);
      if (fs.existsSync(documentAbsolutePath(state.bundleRecord.bundle, relativePath))) {
        overlayDeletions.add(key);
      } else {
        overlayDeletions.delete(key);
      }
    });
    state.upserts.forEach((upsert, relativePath) => {
      const key = documentOverrideKey(bundleId, relativePath);
      deletions.delete(key);
      overlayDeletions.delete(key);
      if (upsert.doc) {
        overrides.set(key, upsert.doc.text);
      } else if (upsert.text !== undefined) {
        overrides.set(key, upsert.text);
      } else {
        overrides.delete(key);
      }
    });
  });
  const rebuilt = buildIndex(
    record.bundleArgs,
    Object.assign({}, record.options, {
      documentOverrides: overrides,
      documentDeletions: deletions,
      asOf,
    }),
  );
  if (record.project) {
    attachProject(rebuilt, record.project);
  }
  const next = indexRecord(rebuilt);
  next.options = record.options;
  next.config = Object.assign({}, record.config, { asOf });
  next.overlayDeletions = overlayDeletions;
  next.stats = Object.assign(stats, { mode: "full" });
  return rebuilt;
}

function insertSorted(entries, entry) {
  let position = 0;
  while (
    position < entries.length &&
    (entries[position] === null || !(entries[position].absolutePath > entry.absolutePath))
  ) {
    position += 1;
  }
  entries.splice(position, 0, entry);
}

// Applies one bundle's deletions and upserts to a copy of its entries. A
// replaced document keeps its position; a new one is inserted where a walk
// would have listed it, after every replacement, because an insertion shifts
// the positions of the entries behind it. Returns the documents that left
// and entered.
function applyBundleChanges(bundleRecord, state, config, changes) {
  const bundle = bundleRecord.bundle;
  if (!fs.existsSync(bundle.root)) {
    bundleRecord.entries.forEach((entry) => {
      if (entry.doc) {
        changes.removed.push({ relativePath: entry.relativePath, entry });
      }
      changes.restored.add(documentOverrideKey(bundle.id, entry.relativePath));
    });
    bundleRecord.entries = [];
    bundleRecord.rootMissing = missingRootError(bundle);
    return;
  }
  bundleRecord.rootMissing = null;
  const entries = bundleRecord.entries;
  const positions = new Map(entries.map((entry, position) => [entry.relativePath, position]));
  state.deletions.forEach((relativePath) => {
    const position = positions.get(relativePath);
    const old = entries[position];
    if (old.doc) {
      changes.removed.push({ relativePath, entry: old });
    }
    entries[position] = null;
    // A document removed while its file remains is an overlay deletion that
    // a later full rebuild has to repeat; one whose file is gone is not.
    const key = documentOverrideKey(bundle.id, relativePath);
    if (fs.existsSync(documentAbsolutePath(bundle, relativePath))) {
      changes.overlayDeleted.add(key);
    } else {
      changes.restored.add(key);
    }
  });
  const inserted = [];
  state.upserts.forEach((upsert, relativePath) => {
    const absolutePath = documentAbsolutePath(bundle, relativePath);
    let entry;
    if (upsert.doc) {
      entry = {
        relativePath,
        absolutePath,
        doc: upsert.doc,
        parseError: null,
        stat: null,
        source: "text",
        text: upsert.doc.text,
        derived: null,
      };
    } else {
      entry = parseEntry(bundle, relativePath, absolutePath, upsert.text, config);
      changes.owned.add(entry);
    }
    const position = positions.get(relativePath);
    if (position !== undefined) {
      const old = entries[position];
      if (old?.doc) {
        changes.removed.push({ relativePath, entry: old });
      }
      entries[position] = entry;
    } else {
      inserted.push(entry);
    }
    changes.added.push({ relativePath, entry });
    changes.restored.add(documentOverrideKey(bundle.id, relativePath));
  });
  inserted.forEach((entry) => {
    insertSorted(entries, entry);
  });
  bundleRecord.entries = entries.filter(Boolean);
}

function assetReferencesChanged(changes) {
  const before = new Map();
  changes.removed.forEach(({ entry }) => {
    before.set(`${entry.doc.bundle}\u0000${entry.relativePath}`, entry.derived.assetReferences);
  });
  const after = new Map();
  changes.added.forEach(({ entry }) => {
    if (entry.doc) {
      after.set(
        `${entry.doc.bundle}\u0000${entry.relativePath}`,
        collectAssetReferences(entry.doc),
      );
    }
  });
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    if (!isDeepStrictEqual(before.get(key) || [], after.get(key) || [])) {
      return true;
    }
  }
  return false;
}

function applyIncrementally(record, plan, stats) {
  const changes = {
    owned: new Set(),
    removed: [],
    added: [],
    overlayDeleted: new Set(),
    restored: new Set(),
  };
  const bundleRecords = record.bundles.map((bundleRecord) => {
    const copy = Object.assign({}, bundleRecord, { entries: bundleRecord.entries.slice() });
    const state = plan.bundles.get(bundleRecord.bundle.id);
    if (state) {
      applyBundleChanges(copy, state, record.config, changes);
    }
    return copy;
  });
  const dirty = new Set();
  const changedUris = new Set();
  changes.removed.forEach(({ entry }) => {
    documentKeys(entry.doc).forEach((key) => {
      dirty.add(key);
    });
    changedUris.add(entry.doc.uri);
  });
  changes.added.forEach(({ entry }) => {
    if (entry.doc) {
      documentKeys(entry.doc).forEach((key) => {
        dirty.add(key);
      });
      changedUris.add(entry.doc.uri);
    }
  });
  const registryChanged = plan.assetsChanged || assetReferencesChanged(changes);
  if (registryChanged) {
    assetKeys(record.assets.byAssetKey, record.assets.byAssetUri).forEach((key) => {
      dirty.add(key);
    });
  }
  const changedEntries = new Set(changes.added.map(({ entry }) => entry));
  const previousDuplicates = record.registration.duplicateErrors.length > 0;
  const overlayDeletions = new Set(record.overlayDeletions);
  changes.restored.forEach((key) => {
    overlayDeletions.delete(key);
  });
  changes.overlayDeleted.forEach((key) => {
    overlayDeletions.add(key);
  });
  const next = {
    bundleArgs: record.bundleArgs,
    options: record.options,
    config: record.config,
    project: record.project,
    duplicateBundleErrors: record.duplicateBundleErrors,
    bundles: bundleRecords,
    registration: null,
    assets: null,
    overlayDeletions,
    stats,
  };
  const selectAffected = ({ registration, assetState, located }) => {
    if (registryChanged) {
      assetKeys(assetState.byAssetKey, assetState.byAssetUri).forEach((key) => {
        dirty.add(key);
      });
    }
    const pooled = previousDuplicates || registration.duplicateErrors.length > 0;
    const affected = [];
    const chosen = new Set();
    // The entry object is shared with the input index; re-derive a copy.
    const rederive = (item) => {
      const copy = Object.assign({}, item.entry);
      item.bundleRecord.entries[item.position] = copy;
      item.entry = copy;
      chosen.add(item);
      affected.push(item);
    };
    located.forEach((item) => {
      if (changedEntries.has(item.entry)) {
        chosen.add(item);
        affected.push(item);
        return;
      }
      const derived = item.entry.derived;
      let hit = pooled && changedUris.has(item.entry.doc.uri);
      if (!hit) {
        for (const key of derived.dependsOn) {
          if (dirty.has(key)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        rederive(item);
      }
    });
    if (pooled) {
      // Readiness pools the edges of every document sharing a canonical URI,
      // so when one owner is re-derived the others are too.
      const affectedUris = new Set(affected.map((item) => item.entry.doc.uri));
      located.forEach((item) => {
        if (!chosen.has(item) && affectedUris.has(item.entry.doc.uri)) {
          rederive(item);
        }
      });
    }
    stats.dependents = affected.length - changes.added.filter(({ entry }) => entry.doc).length;
    return affected;
  };
  stats.mode = "incremental";
  stats.registry = registryChanged ? "rebuilt" : "carried";
  return completeIndex(next, {
    owned: changes.owned,
    assets: registryChanged ? null : record.assets,
    selectAffected,
    pooledReadiness: previousDuplicates,
  });
}

// Settings a host puts on the index object itself rather than through the
// project (root mode sets the stemming `languages` there) travel to the index
// an update produces; a value assembly already took from the project is kept.
function carryIndexSettings(from, to) {
  if (to !== from && to.languages === undefined && from.languages !== undefined) {
    to.languages = from.languages;
  }
  return to;
}

// Returns a new index with the given documents added, replaced or removed.
// The input index is never mutated; unchanged documents, edges and derived
// lists are shared with it. Only the changed documents and the documents
// whose edges resolved through a key the change dirtied are re-derived;
// lookup maps are re-registered in index order (a linear pass); the asset
// registry is carried unless a changed document's asset references changed
// or `changes.assetsChanged` says the asset files did; validation is
// recomputed in full. Above `maxChangeRatio` (changed documents over
// documents in the index, default 0.2) the index is rebuilt instead, and so
// is an index built without an asOf when `options.asOf` (default: now) falls
// on another UTC day than the one its documents were stamped with: one full
// build per day per process, which in the live service runs under the
// writer lock, so the first batch of a day pays a build's latency.
function updateIndex(index, changes, options) {
  const record = indexRecord(index);
  if (!record) {
    throw new TypeError("updateIndex needs an index produced by buildIndex.");
  }
  const config = options || {};
  const maxChangeRatio =
    config.maxChangeRatio === undefined ? DEFAULT_MAX_CHANGE_RATIO : Number(config.maxChangeRatio);
  if (!(maxChangeRatio >= 0)) {
    throw new TypeError("maxChangeRatio must be a non-negative number.");
  }
  const plan = planChanges(index, record, changes);
  const asOf = record.config.floatingDate ? dayKey(config.asOf) : record.config.asOf;
  const dateChanged = asOf !== record.config.asOf;
  if (plan.changed === 0 && !plan.assetsChanged && !dateChanged) {
    return index;
  }
  const total = index.documents.length;
  const ratio = plan.changed / Math.max(1, total);
  const stats = {
    mode: null,
    changed: plan.changed,
    total,
    ratio,
    maxChangeRatio,
    asOf,
    assets: plan.assetsChanged ? "changed" : "unchanged",
  };
  if (dateChanged || ratio > maxChangeRatio) {
    stats.reason = dateChanged ? "date" : "ratio";
    return carryIndexSettings(index, rebuildIndex(record, plan, stats, asOf));
  }
  return carryIndexSettings(index, applyIncrementally(record, plan, stats));
}

// Whether the file on disk is what the entry already describes. A disk-backed
// entry is compared by size and mtime (nanoseconds). An entry held as text is
// compared by content; when the file carries the same text the entry becomes
// disk-backed in place (a cache fill that changes nothing the entry
// describes), so later refreshes need only a stat. A file that vanished
// mid-walk counts as changed and the update records whatever it finds.
//
// Limit: a rewrite that keeps a file's size and mtime is invisible here, for
// documents and (in assetsChangedOnDisk) for assets alike. The write path
// covers the documents a batch targets by comparing content hashes and
// re-reading on a mismatch (live.js, updateCandidate); the dependencies of a
// batch are not re-read. Before the incremental index, the write path built
// from disk every time, so every file was read; now a file whose stat is
// unchanged is trusted.
function fileMatchesEntry(entry, filePath) {
  const stat = fileStat(filePath);
  if (!stat) {
    return false;
  }
  if (entry.source === "disk") {
    return sameStat(entry.stat, stat);
  }
  if (entry.source !== "text") {
    return false;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(filePath));
  } catch {
    return false;
  }
  if (text !== entry.text) {
    return false;
  }
  entry.stat = stat;
  entry.source = "disk";
  return true;
}

// Whether any asset the documents reference was modified, removed or added
// since the index recorded it, judged by size and mtime of the watched paths.
function assetsChangedOnDisk(record) {
  for (const [absolutePath, recorded] of record.assets.watch) {
    if (!sameStat(recorded, fileStat(absolutePath))) {
      return true;
    }
  }
  return false;
}

// Brings an index up to date with its local bundle roots by comparing each
// Markdown file's and each referenced asset's size and mtime with what the
// index recorded, then applying the differences through updateIndex (which
// also notices a changed day; `options` are its options). Returns the same
// index object when nothing changed. Paths pinned by document overrides or
// deletions at build time are left as built.
function refreshIndex(index, options) {
  const record = indexRecord(index);
  if (!record) {
    throw new TypeError("refreshIndex needs an index produced by buildIndex.");
  }
  const upserts = [];
  const deletions = [];
  record.bundles.forEach((bundleRecord) => {
    const bundle = bundleRecord.bundle;
    if (bundle.remote) {
      return;
    }
    const pinned = (key) =>
      record.config.documentOverrides.has(key) || record.config.documentDeletions.has(key);
    const seen = new Set();
    if (fs.existsSync(bundle.root)) {
      const byPath = new Map(bundleRecord.entries.map((entry) => [entry.relativePath, entry]));
      walkMarkdown(bundle.root).forEach((filePath) => {
        const relativePath = safeRelativePath(bundle.root, filePath) || normalizeSlashes(filePath);
        if (!bundleAllowsPath(bundle, relativePath)) {
          return;
        }
        const key = documentOverrideKey(bundle.id, relativePath);
        if (pinned(key)) {
          return;
        }
        seen.add(relativePath);
        const entry = byPath.get(relativePath);
        if (!entry || !fileMatchesEntry(entry, filePath)) {
          upserts.push({ bundleId: bundle.id, relativePath });
        }
      });
    }
    bundleRecord.entries.forEach((entry) => {
      if (
        !seen.has(entry.relativePath) &&
        !pinned(documentOverrideKey(bundle.id, entry.relativePath))
      ) {
        deletions.push({ bundleId: bundle.id, relativePath: entry.relativePath });
      }
    });
  });
  return updateIndex(
    index,
    { upserts, deletions, assetsChanged: assetsChangedOnDisk(record) },
    options,
  );
}

module.exports = {
  DEFAULT_MAX_CHANGE_RATIO,
  edgesBySource,
  indexInputs,
  indexUpdateStats,
  linkSets,
  refreshIndex,
  updateIndex,
};
