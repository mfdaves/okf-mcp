"use strict";

const { buildAssetRegistry, collectAssetReferences, resolveBundleAssetPath } = require("../assets");
const { normalizeSlashes } = require("../parser");
const { validateIndex } = require("../validation");
const { assetUri, contractAssetsReady, documentAtPath, documentEdges } = require("./edges");
const { bundleExcludesPath, fileStat } = require("./paths");

// Build state that is not part of the index object: the inputs the index was
// built from and, per document entry, the derived state together with the
// lookup keys that derivation consulted. updateIndex reads it to recompute
// only what a change can reach. A WeakMap keeps it out of the index's
// enumerable shape, so deep-equality comparisons ignore it, and lets it die
// with the index.
//
// A record holds { bundleArgs, options, config, project, duplicateBundleErrors,
// bundles: [{ bundle, rootMissing, entries, remoteWarnings }], registration,
// assets, stats }. An entry holds { relativePath, absolutePath, doc,
// parseError, stat, derived }; derived holds the entry's edges, warnings,
// errors, external references, custom relation types, asset references and
// the dependsOn key set. Index order is bundle order, then entry order.
const INDEX_RECORDS = new WeakMap();

const CONTRACT_EDGE_KINDS = ["computation", "executor", "attester"];

function indexRecord(index) {
  return (index && INDEX_RECORDS.get(index)) || null;
}

function pushAll(target, items) {
  for (let position = 0; position < items.length; position += 1) {
    target.push(items[position]);
  }
}

function portableConceptKey(value) {
  return normalizeSlashes(String(value || ""))
    .replace(/^\/+/, "")
    .split("#")[0];
}

function registerPortableConceptId(map, ambiguous, key, document) {
  const normalized = portableConceptKey(key);
  if (!normalized || ambiguous.has(normalized)) {
    return;
  }
  const owner = map.get(normalized);
  if (owner && owner !== document) {
    map.delete(normalized);
    ambiguous.add(normalized);
    return;
  }
  map.set(normalized, document);
}

// Registers every document in index order. Conflict resolution is order
// dependent (the first document wins a canonical URI, a contested alias is
// withdrawn from both claimants), so registration always runs over the full
// list; it is a linear pass of map inserts.
function registerDocuments(documents) {
  const byUri = new Map();
  const byPathUri = new Map();
  const byCanonicalUri = new Map();
  const byConceptId = new Map();
  const ambiguousConceptIds = new Set();
  const ambiguousAliases = new Set();
  const duplicateErrors = [];
  const aliasErrors = [];
  documents.forEach((doc) => {
    if (!byPathUri.has(doc.pathUri)) {
      byPathUri.set(doc.pathUri, doc);
    }
    if (byCanonicalUri.has(doc.uri)) {
      duplicateErrors.push({
        code: "duplicate_concept_id",
        uri: doc.uri,
        message: "Duplicate canonical OKF Concept ID.",
      });
      return;
    }
    byCanonicalUri.set(doc.uri, doc);
    byUri.set(doc.uri, doc);
    registerPortableConceptId(byConceptId, ambiguousConceptIds, doc.conceptId, doc);
    registerPortableConceptId(byConceptId, ambiguousConceptIds, doc.path, doc);
  });
  const aliasOwners = new Map();
  documents.forEach((doc) => {
    (doc.uriAliases || [doc.pathUri]).forEach((alias) => {
      const canonicalOwner = byCanonicalUri.get(alias);
      if (canonicalOwner && canonicalOwner !== doc) {
        aliasErrors.push({
          code: "uri_alias_conflicts_canonical",
          uri: alias,
          bundle: doc.bundle,
          path: doc.path,
          message:
            "Compatibility URI alias conflicts with another canonical Concept ID; the canonical target wins.",
        });
        return;
      }
      const aliasOwner = aliasOwners.get(alias);
      if (aliasOwner && aliasOwner !== doc) {
        ambiguousAliases.add(alias);
        byUri.delete(alias);
        aliasErrors.push({
          code: "ambiguous_uri_alias",
          uri: alias,
          bundle: doc.bundle,
          path: doc.path,
          message: "Compatibility URI alias resolves to more than one document.",
        });
        return;
      }
      if (!ambiguousAliases.has(alias)) {
        aliasOwners.set(alias, doc);
        byUri.set(alias, doc);
      }
    });
  });
  return {
    byUri,
    byPathUri,
    byCanonicalUri,
    byConceptId,
    ambiguousConceptIds,
    ambiguousAliases,
    duplicateErrors,
    aliasErrors,
  };
}

// Map-like views that record every key they are asked for. Edge derivation
// resolves targets only through these, so the recorded set is exactly the set
// of index keys whose change could alter the document's derived state.
function trackedLookups(maps, dependsOn) {
  const tracked = (prefix, map) => ({
    get(key) {
      dependsOn.add(prefix + key);
      return map.get(key);
    },
  });
  return {
    byPathUri: tracked("p:", maps.byPathUri),
    byUri: tracked("u:", maps.byUri),
    byConceptId: tracked("c:", maps.byConceptId),
    byAssetKey: tracked("a:", maps.byAssetKey),
    byAssetUri: tracked("au:", maps.byAssetUri),
  };
}

// The lookup keys under which other documents can reach this one. Adding,
// replacing or removing the document dirties exactly these keys.
function documentKeys(doc) {
  const keys = [`p:${doc.pathUri}`, `u:${doc.uri}`];
  (doc.uriAliases || []).forEach((alias) => {
    keys.push(`u:${alias}`);
  });
  [doc.conceptId, doc.path].forEach((value) => {
    const key = portableConceptKey(value);
    if (key) {
      keys.push(`c:${key}`);
    }
  });
  return keys;
}

function assetKeys(byAssetKey, byAssetUri) {
  const keys = [];
  byAssetKey.forEach((_asset, key) => {
    keys.push(`a:${key}`);
  });
  byAssetUri.forEach((_asset, uri) => {
    keys.push(`au:${uri}`);
  });
  return keys;
}

function buildLocalAssetRegistry(documents, bundles, config) {
  const localIds = new Set(bundles.filter((bundle) => !bundle.remote).map((bundle) => bundle.id));
  const registry = buildAssetRegistry(
    documents.filter((doc) => localIds.has(doc.bundle)),
    bundles,
    {
      maxAssetBytes: config.maxAssetBytes,
      allowResolvedPath: (bundle, relativePath) => !bundleExcludesPath(bundle, relativePath),
      skipResolvedPath: (_bundle, relativePath) => relativePath.toLowerCase().endsWith(".md"),
    },
  );
  registry.assets.forEach((asset) => {
    asset.uri = asset.uri || assetUri(asset.bundle, asset.path);
  });
  return registry;
}

// The index's asset list: local assets that are not also documents, then the
// remote bundles' assets. Both lookup maps are built from the final list.
function assetMaps(registry, byPathUri, bundles) {
  const assets = registry.assets.filter(
    (asset) => !documentAtPath(byPathUri, `okf://${asset.bundle}/${asset.path}`),
  );
  bundles
    .filter((bundle) => bundle.remote)
    .forEach((bundle) => {
      (bundle.assets || []).forEach((asset) => {
        assets.push(
          Object.assign({}, asset, {
            bundle: bundle.id,
            uri: asset.uri || assetUri(bundle.id, asset.path),
            remote: true,
          }),
        );
      });
    });
  return {
    assets,
    byAssetKey: new Map(assets.map((asset) => [`${asset.bundle}\u0000${asset.path}`, asset])),
    byAssetUri: new Map(assets.map((asset) => [asset.uri, asset])),
  };
}

// The asset paths the local documents reference, each with the size and
// mtime found now (null where no regular file exists), so a refresh can tell
// whether a referenced asset was modified, removed or added without reading
// any of them. Documents and policy-excluded paths are left out: the first
// are tracked as documents, the second carry a fixed diagnostic.
function watchAssets(record) {
  const watch = new Map();
  record.bundles.forEach((bundleRecord) => {
    const bundle = bundleRecord.bundle;
    if (bundle.remote) {
      return;
    }
    bundleRecord.entries.forEach((entry) => {
      if (!entry.doc) {
        return;
      }
      entry.derived.assetReferences.forEach((reference) => {
        let resolved;
        try {
          resolved = resolveBundleAssetPath(bundle.root, reference.fromPath, reference.value);
        } catch {
          return;
        }
        if (
          resolved.path.toLowerCase().endsWith(".md") ||
          bundleExcludesPath(bundle, resolved.path) ||
          watch.has(resolved.absolutePath)
        ) {
          return;
        }
        watch.set(resolved.absolutePath, fileStat(resolved.absolutePath));
      });
    });
  });
  return watch;
}

function lookupMaps(registration, assetState) {
  return {
    byPathUri: registration.byPathUri,
    byUri: registration.byUri,
    byConceptId: registration.byConceptId,
    byAssetKey: assetState.byAssetKey,
    byAssetUri: assetState.byAssetUri,
  };
}

function deriveEntry(entry, bundle, maps, config) {
  const doc = entry.doc;
  const dependsOn = new Set();
  const lookups = trackedLookups(maps, dependsOn);
  const derived = documentEdges(doc, bundle, lookups, config.edgeConfig);
  return {
    parseWarnings: doc.warnings.map((warning) => Object.assign({ bundle: doc.bundle }, warning)),
    edges: derived.edges,
    warnings: derived.warnings,
    errors: derived.errors,
    externalReferences: derived.externalReferences,
    customRelationTypes: derived.customRelationTypes,
    assetReferences: collectAssetReferences(doc),
    dependsOn,
    byAssetUri: lookups.byAssetUri,
  };
}

function contractReadiness(contract, contractEdges, byAssetUri) {
  // A freshly parsed contract carries the parser's structural verdict in
  // `ready`; once indexed, `ready` also folds in asset readiness, so the
  // structural verdict is kept separately and read back from there.
  const structuralReady = Object.hasOwn(contract, "structuralReady")
    ? Boolean(contract.structuralReady)
    : Boolean(contract.ready);
  const assetsReady = contractAssetsReady(contract, contractEdges, byAssetUri);
  const ready = Boolean(structuralReady && assetsReady);
  return { structuralReady, assetsReady, ready, attestationReady: ready };
}

// Applies computed readiness to the entry's document. A document this
// operation parsed is updated in place; one shared with another index is
// replaced by a shallow clone so that index never changes under its holder.
function applyReadiness(entry, readiness, owned) {
  const contract = entry.doc.signals.computation;
  if (Object.keys(readiness).every((key) => contract[key] === readiness[key])) {
    return false;
  }
  if (owned.has(entry)) {
    Object.assign(contract, readiness);
    return false;
  }
  entry.doc = Object.assign({}, entry.doc, {
    signals: Object.assign({}, entry.doc.signals, {
      computation: Object.assign({}, contract, readiness),
    }),
  });
  return true;
}

// Readiness for the concept entries just derived. When two documents share a
// canonical URI (a duplicate_concept_id error) the contract edges of both are
// pooled in index order, as a full build sees them.
function applyReadinessPass(items, located, pooled, owned) {
  let pool = null;
  if (pooled) {
    pool = new Map();
    located.forEach((item) => {
      const uri = item.entry.doc.uri;
      const list = pool.get(uri);
      if (list) {
        pushAll(list, item.entry.derived.edges);
      } else {
        pool.set(uri, item.entry.derived.edges.slice());
      }
    });
  }
  let cloned = false;
  items.forEach((item) => {
    const doc = item.entry.doc;
    if (doc.reserved || !doc.valid) {
      return;
    }
    const contract = doc.signals?.computation;
    if (!contract) {
      return;
    }
    const edges = pool ? pool.get(doc.uri) || [] : item.entry.derived.edges;
    const contractEdges = edges.filter((edge) => CONTRACT_EDGE_KINDS.includes(edge.kind));
    const readiness = contractReadiness(contract, contractEdges, item.entry.derived.byAssetUri);
    if (applyReadiness(item.entry, readiness, owned)) {
      cloned = true;
    }
  });
  return cloned;
}

function bundleMetadata(bundle, documents, assets) {
  const rootIndex = documents.find((doc) => doc.bundle === bundle.id && doc.path === "index.md");
  const okfVersion =
    rootIndex?.frontmatter && Object.hasOwn(rootIndex.frontmatter, "okf_version")
      ? rootIndex.frontmatter.okf_version
      : null;
  const version = okfVersion === null ? null : String(okfVersion);
  return Object.assign({}, bundle, {
    okfVersion: version,
    versionStatus:
      version === "0.2"
        ? "understood"
        : version === "0.1"
          ? "legacy"
          : version
            ? "unsupported"
            : "undeclared",
    documentCount: documents.filter((doc) => doc.bundle === bundle.id).length,
    assetCount: assets.filter((asset) => asset.bundle === bundle.id).length,
  });
}

function applyProject(index, project) {
  index.errors.unshift.apply(index.errors, project.errors || []);
  index.project = {
    name: project.project,
    path: project.path,
    root: project.root,
    plugins: project.plugins,
    producers: project.producers,
    remoteBundles: project.remoteBundles,
    strictLinks: project.strictLinks,
    languages: project.languages,
  };
  index.strictLinks = Boolean(index.strictLinks || project.strictLinks);
}

function attachValidation(index) {
  const validation = validateIndex(index);
  index.conformant = validation.conformant;
  index.validForProject = validation.validForProject;
  index.valid = validation.valid;
  index.diagnostics = validation.diagnostics;
  return index;
}

// Builds the index object from a record whose entries are all derived. Every
// list keeps the order a full build produces: documents in bundle then entry
// order; errors as duplicate bundle ids, then per bundle a missing root or its
// parse errors, then duplicate concept ids, alias conflicts and relation
// errors; warnings as parse warnings, asset diagnostics, remote bundle
// notices and link warnings.
function assembleIndex(record, documents, registration, assetState) {
  const { config } = record;
  const derivedList = [];
  record.bundles.forEach((bundleRecord) => {
    bundleRecord.entries.forEach((entry) => {
      if (entry.doc) {
        derivedList.push(entry.derived);
      }
    });
  });
  const concepts = [];
  const reserved = [];
  documents.forEach((doc) => {
    if (doc.reserved) {
      reserved.push(doc);
    } else if (doc.valid) {
      concepts.push(doc);
    }
  });

  const errors = record.duplicateBundleErrors.slice();
  record.bundles.forEach((bundleRecord) => {
    if (bundleRecord.rootMissing) {
      errors.push(bundleRecord.rootMissing);
      return;
    }
    bundleRecord.entries.forEach((entry) => {
      if (entry.parseError) {
        errors.push(entry.parseError);
      }
    });
  });
  pushAll(errors, registration.duplicateErrors);
  pushAll(errors, registration.aliasErrors);
  derivedList.forEach((derived) => {
    pushAll(errors, derived.errors);
  });

  const warnings = [];
  derivedList.forEach((derived) => {
    pushAll(warnings, derived.parseWarnings);
  });
  pushAll(warnings, record.assets.registry.diagnostics);
  record.bundles.forEach((bundleRecord) => {
    if (bundleRecord.bundle.remote) {
      pushAll(warnings, bundleRecord.remoteWarnings);
    }
  });
  derivedList.forEach((derived) => {
    pushAll(warnings, derived.warnings);
  });

  const edges = [];
  derivedList.forEach((derived) => {
    pushAll(edges, derived.edges);
  });

  const externalReferences = new Map();
  derivedList.forEach((derived) => {
    derived.externalReferences.forEach((uri) => {
      if (!externalReferences.has(uri)) {
        externalReferences.set(uri, { uri, kind: "external" });
      }
    });
  });

  const relationTypes = new Set(config.edgeConfig.allowedRelationTypes);
  derivedList.forEach((derived) => {
    derived.customRelationTypes.forEach((type) => {
      relationTypes.add(type);
    });
  });

  const index = {
    bundles: record.bundles.map((bundleRecord) =>
      bundleMetadata(bundleRecord.bundle, documents, assetState.assets),
    ),
    documents,
    concepts,
    reserved,
    relationTypes: Array.from(relationTypes),
    externalReferences: Array.from(externalReferences.values()),
    assets: assetState.assets,
    warnings,
    errors,
    edges,
    strictLinks: config.strictLinks,
    byUri: registration.byUri,
    byPathUri: registration.byPathUri,
    byCanonicalUri: registration.byCanonicalUri,
    byConceptId: registration.byConceptId,
    byAssetKey: assetState.byAssetKey,
    byAssetUri: assetState.byAssetUri,
    ambiguousAliases: registration.ambiguousAliases,
    ambiguousConceptIds: registration.ambiguousConceptIds,
  };
  if (record.project) {
    applyProject(index, record.project);
  }
  INDEX_RECORDS.set(index, record);
  return attachValidation(index);
}

// Finishes an index from a record whose entries are loaded: registers the
// documents, settles the asset registry, derives the entries the operation
// selects (all of them for a build), applies computation readiness, and
// assembles the index object. `operation` carries `owned` (entries whose
// documents this operation parsed and may mutate), an optional carried
// `assets` state (registry and watch list), an optional `selectAffected`
// narrowing derivation, and `pooledReadiness` when duplicate canonical URIs
// exist on either side.
function completeIndex(record, operation) {
  const bundles = record.bundles.map((bundleRecord) => bundleRecord.bundle);
  const located = [];
  record.bundles.forEach((bundleRecord) => {
    bundleRecord.entries.forEach((entry, position) => {
      if (entry.doc) {
        located.push({ entry, bundleRecord, position });
      }
    });
  });
  let documents = located.map((item) => item.entry.doc);
  let registration = registerDocuments(documents);
  const registry = operation.assets
    ? operation.assets.registry
    : buildLocalAssetRegistry(documents, bundles, record.config);
  let assetState = assetMaps(registry, registration.byPathUri, bundles);
  const maps = lookupMaps(registration, assetState);
  const affected = operation.selectAffected
    ? operation.selectAffected({ registration, assetState, located })
    : located;
  affected.forEach((item) => {
    item.entry.derived = deriveEntry(item.entry, item.bundleRecord.bundle, maps, record.config);
  });
  const pooled = registration.duplicateErrors.length > 0 || Boolean(operation.pooledReadiness);
  if (applyReadinessPass(affected, located, pooled, operation.owned)) {
    // A shared document was replaced by a clone; the maps must point at it.
    documents = located.map((item) => item.entry.doc);
    registration = registerDocuments(documents);
    assetState = assetMaps(registry, registration.byPathUri, bundles);
  }
  record.registration = registration;
  record.assets = Object.assign(
    { registry, watch: operation.assets ? operation.assets.watch : watchAssets(record) },
    assetState,
  );
  record.stats.documents = documents.length;
  record.stats.derived = affected.length;
  return assembleIndex(record, documents, registration, assetState);
}

module.exports = {
  applyProject,
  assetKeys,
  attachValidation,
  completeIndex,
  documentKeys,
  indexRecord,
};
