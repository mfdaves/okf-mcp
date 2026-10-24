"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeSlashes,
  parseMarkdownFile,
  parseMarkdownText,
  safeRelativePath,
} = require("../parser");
const { buildAssetRegistry } = require("../assets");
const { DEFAULT_RELATION_TYPES, loadProjectConfig } = require("../project");
const { fetchRemoteBundles } = require("../remote");
const { validateIndex } = require("../validation");
const { assetUri, contractAssetsReady, documentAtPath, documentEdges } = require("./edges");

function sanitizeBundleId(value, fallback) {
  const raw = String(value || fallback || "bundle").trim();
  return raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "bundle";
}

function parseBundleArg(arg, index) {
  if (arg && typeof arg === "object") {
    return {
      id: sanitizeBundleId(arg.id, `bundle-${index + 1}`),
      root: arg.remote ? "" : path.resolve(arg.root),
      remote: Boolean(arg.remote),
      remoteSource: arg.remoteSource || null,
      documents: Array.isArray(arg.documents) ? arg.documents : [],
      assets: Array.isArray(arg.assets) ? arg.assets : [],
      include: Array.isArray(arg.include) ? arg.include : [],
      exclude: Array.isArray(arg.exclude) ? arg.exclude : [],
    };
  }
  const text = String(arg || "");
  const eq = text.indexOf("=");
  if (eq > 0) {
    return {
      id: sanitizeBundleId(text.slice(0, eq), `bundle-${index + 1}`),
      root: path.resolve(text.slice(eq + 1)),
    };
  }
  const root = path.resolve(text);
  return {
    id: sanitizeBundleId(path.basename(root), `bundle-${index + 1}`),
    root,
  };
}

function documentOverrideKey(bundleId, relativePath) {
  return `${bundleId}\u0000${normalizeSlashes(relativePath)}`;
}

function uniqueBundleIds(bundles) {
  return bundles.map((bundle) => {
    const base = sanitizeBundleId(bundle.id);
    return {
      id: base,
      root: bundle.remote ? "" : path.resolve(bundle.root),
      remote: Boolean(bundle.remote),
      remoteSource: bundle.remoteSource || null,
      documents: Array.isArray(bundle.documents) ? bundle.documents : [],
      assets: Array.isArray(bundle.assets) ? bundle.assets : [],
      include: bundle.include || [],
      exclude: bundle.exclude || [],
    };
  });
}

function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function patternToRegex(pattern) {
  const text = normalizeSlashes(pattern);
  let source = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "*") {
      if (text[index + 1] === "*") {
        if (text[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    source += escapeRegex(char);
  }
  return new RegExp(`^${source}$`);
}

function matchesPattern(relativePath, pattern) {
  const normalizedPath = normalizeSlashes(relativePath);
  const normalizedPattern = normalizeSlashes(pattern);
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPath === normalizedPattern) {
    return true;
  }
  if (normalizedPattern.endsWith("/")) {
    return normalizedPath.startsWith(normalizedPattern);
  }
  if (normalizedPattern.includes("*")) {
    return patternToRegex(normalizedPattern).test(normalizedPath);
  }
  return normalizedPath.startsWith(`${normalizedPattern}/`);
}

function bundleAllowsPath(bundle, relativePath) {
  const include = Array.isArray(bundle.include) ? bundle.include : [];
  const exclude = Array.isArray(bundle.exclude) ? bundle.exclude : [];
  if (include.length && !include.some((pattern) => matchesPattern(relativePath, pattern))) {
    return false;
  }
  if (exclude.some((pattern) => matchesPattern(relativePath, pattern))) {
    return false;
  }
  return true;
}

function bundleExcludesPath(bundle, relativePath) {
  const exclude = Array.isArray(bundle?.exclude) ? bundle.exclude : [];
  return exclude.some((pattern) => matchesPattern(relativePath, pattern));
}

function walkMarkdown(root) {
  const out = [];
  if (!fs.existsSync(root)) {
    return out;
  }
  const entries = fs.readdirSync(root, { withFileTypes: true });
  entries.forEach((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push.apply(out, walkMarkdown(full));
      return;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  });
  return out.sort();
}

function registerPortableConceptId(map, ambiguous, key, document) {
  const normalized = normalizeSlashes(String(key || ""))
    .replace(/^\/+/, "")
    .split("#")[0];
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

function buildIndex(bundleArgs, options) {
  const config = options || {};
  const documentOverrides =
    config.documentOverrides instanceof Map ? config.documentOverrides : new Map();
  const documentDeletions =
    config.documentDeletions instanceof Set ? config.documentDeletions : new Set();
  const strictLinks = Boolean(config.strictLinks);
  const requestedBundles = uniqueBundleIds((bundleArgs || []).map(parseBundleArg));
  const allowedRelationTypes = new Set(
    (config.relationTypes || DEFAULT_RELATION_TYPES).map(String),
  );
  const allowCustomRelationTypes = Boolean(config.allowCustomRelationTypes);
  const documents = [];
  const concepts = [];
  const reserved = [];
  const warnings = [];
  const errors = [];
  const externalReferences = new Map();
  const seenBundleIds = new Set();
  const bundles = [];
  requestedBundles.forEach((bundle) => {
    if (seenBundleIds.has(bundle.id)) {
      errors.push({
        code: "duplicate_bundle_id",
        bundle: bundle.id,
        message: "Duplicate bundle id; the later bundle was ignored.",
      });
      return;
    }
    seenBundleIds.add(bundle.id);
    bundles.push(bundle);
  });

  bundles.forEach((bundle) => {
    if (bundle.remote) {
      (bundle.documents || []).forEach((remoteDoc) => {
        const relativePath = normalizeSlashes(remoteDoc.path);
        if (!bundleAllowsPath(bundle, relativePath)) {
          return;
        }
        try {
          const doc = parseMarkdownText(
            bundle,
            relativePath,
            String(remoteDoc.text || ""),
            remoteDoc.source || relativePath,
            { asOf: config.asOf },
          );
          documents.push(doc);
          if (doc.reserved) {
            reserved.push(doc);
          } else if (doc.valid) {
            concepts.push(doc);
          }
          warnings.push.apply(
            warnings,
            doc.warnings.map((warning) => Object.assign({ bundle: doc.bundle }, warning)),
          );
        } catch (error) {
          errors.push({
            code: "parse_error",
            bundle: bundle.id,
            path: relativePath,
            message: error.message,
          });
        }
      });
      return;
    }
    if (!fs.existsSync(bundle.root)) {
      errors.push({
        code: "missing_bundle_root",
        bundle: bundle.id,
        path: bundle.root,
        message: "Bundle root does not exist.",
      });
      return;
    }
    const indexedPaths = new Set();
    const indexLocalDocument = (relativePath, text, source) => {
      indexedPaths.add(relativePath);
      try {
        const doc =
          text === undefined
            ? parseMarkdownFile(bundle, source, { asOf: config.asOf })
            : parseMarkdownText(bundle, relativePath, text, source, { asOf: config.asOf });
        documents.push(doc);
        if (doc.reserved) {
          reserved.push(doc);
        } else if (doc.valid) {
          concepts.push(doc);
        }
        warnings.push.apply(
          warnings,
          doc.warnings.map((warning) => Object.assign({ bundle: doc.bundle }, warning)),
        );
      } catch (error) {
        errors.push({
          code: "parse_error",
          bundle: bundle.id,
          path: relativePath,
          message: error.message,
        });
      }
    };
    walkMarkdown(bundle.root).forEach((filePath) => {
      const relativePath = safeRelativePath(bundle.root, filePath) || normalizeSlashes(filePath);
      if (!bundleAllowsPath(bundle, relativePath)) {
        return;
      }
      const key = documentOverrideKey(bundle.id, relativePath);
      if (documentDeletions.has(key)) {
        return;
      }
      indexLocalDocument(
        relativePath,
        documentOverrides.has(key) ? String(documentOverrides.get(key)) : undefined,
        filePath,
      );
    });
    const prefix = `${bundle.id}\u0000`;
    documentOverrides.forEach((text, key) => {
      if (!String(key).startsWith(prefix)) {
        return;
      }
      const relativePath = normalizeSlashes(String(key).slice(prefix.length));
      if (
        documentDeletions.has(key) ||
        indexedPaths.has(relativePath) ||
        !bundleAllowsPath(bundle, relativePath)
      ) {
        return;
      }
      indexLocalDocument(
        relativePath,
        String(text),
        path.join(bundle.root, ...relativePath.split("/")),
      );
    });
  });

  const byUri = new Map();
  const byPathUri = new Map();
  const byCanonicalUri = new Map();
  const byConceptId = new Map();
  const ambiguousConceptIds = new Set();
  const ambiguousAliases = new Set();
  documents.forEach((doc) => {
    if (!byPathUri.has(doc.pathUri)) {
      byPathUri.set(doc.pathUri, doc);
    }
    if (byCanonicalUri.has(doc.uri)) {
      errors.push({
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

  const localDocuments = documents.filter((doc) => {
    const bundle = bundles.find((entry) => entry.id === doc.bundle);
    return bundle && !bundle.remote;
  });
  const localAssetRegistry = buildAssetRegistry(localDocuments, bundles, {
    maxAssetBytes: config.maxAssetBytes,
    allowResolvedPath: (bundle, relativePath) => !bundleExcludesPath(bundle, relativePath),
    skipResolvedPath: (_bundle, relativePath) => relativePath.toLowerCase().endsWith(".md"),
  });
  warnings.push.apply(warnings, localAssetRegistry.diagnostics);
  const assets = localAssetRegistry.assets.filter(
    (asset) => !documentAtPath(byPathUri, `okf://${asset.bundle}/${asset.path}`),
  );
  bundles
    .filter((bundle) => bundle.remote)
    .forEach((bundle) => {
      const unresolved = bundle.remoteSource?.unresolvedReferences || [];
      warnings.push.apply(
        warnings,
        unresolved.map((entry) =>
          Object.assign(
            {
              severity: "warning",
              layer: "project",
              bundle: bundle.id,
              message: `Referenced remote asset is unavailable: ${entry.resolvedPath || entry.target || "<unknown>"}`,
            },
            entry,
          ),
        ),
      );
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

  assets.forEach((asset) => {
    asset.uri = asset.uri || assetUri(asset.bundle, asset.path);
  });
  const byAssetKey = new Map(assets.map((asset) => [`${asset.bundle}\u0000${asset.path}`, asset]));
  const byAssetUri = new Map(assets.map((asset) => [asset.uri, asset]));
  const aliasOwners = new Map();
  documents.forEach((doc) => {
    (doc.uriAliases || [doc.pathUri]).forEach((alias) => {
      const canonicalOwner = byCanonicalUri.get(alias);
      if (canonicalOwner && canonicalOwner !== doc) {
        errors.push({
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
        errors.push({
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

  const edges = [];
  const lookups = { byPathUri, byUri, byConceptId, byAssetKey, byAssetUri };
  documents.forEach((doc) => {
    const bundle = bundles.find((entry) => entry.id === doc.bundle);
    const derived = documentEdges(doc, bundle, lookups, {
      allowedRelationTypes,
      allowCustomRelationTypes,
    });
    edges.push.apply(edges, derived.edges);
    warnings.push.apply(warnings, derived.warnings);
    errors.push.apply(errors, derived.errors);
    derived.externalReferences.forEach((uri) => {
      externalReferences.set(uri, { uri, kind: "external" });
    });
    derived.customRelationTypes.forEach((type) => {
      allowedRelationTypes.add(type);
    });
  });

  concepts.forEach((doc) => {
    const contract = doc.signals?.computation;
    if (!contract) {
      return;
    }
    const contractEdges = edges.filter(
      (edge) =>
        edge.source === doc.uri && ["computation", "executor", "attester"].includes(edge.kind),
    );
    const assetsReady = contractAssetsReady(contract, contractEdges, byAssetUri);
    contract.structuralReady = Boolean(contract.ready);
    contract.assetsReady = assetsReady;
    contract.ready = Boolean(contract.structuralReady && assetsReady);
    contract.attestationReady = contract.ready;
  });

  const index = {
    bundles,
    documents,
    concepts,
    reserved,
    relationTypes: Array.from(allowedRelationTypes),
    externalReferences: Array.from(externalReferences.values()),
    assets,
    warnings,
    errors,
    edges,
    strictLinks,
    byUri,
    byPathUri,
    byCanonicalUri,
    byConceptId,
    byAssetKey,
    byAssetUri,
    ambiguousAliases,
    ambiguousConceptIds,
  };
  bundles.forEach((bundle) => {
    const rootIndex = documents.find((doc) => doc.bundle === bundle.id && doc.path === "index.md");
    const okfVersion =
      rootIndex?.frontmatter && Object.hasOwn(rootIndex.frontmatter, "okf_version")
        ? rootIndex.frontmatter.okf_version
        : null;
    bundle.okfVersion = okfVersion === null ? null : String(okfVersion);
    bundle.versionStatus =
      bundle.okfVersion === "0.2"
        ? "understood"
        : bundle.okfVersion === "0.1"
          ? "legacy"
          : bundle.okfVersion
            ? "unsupported"
            : "undeclared";
    bundle.documentCount = documents.filter((doc) => doc.bundle === bundle.id).length;
    bundle.assetCount = assets.filter((asset) => asset.bundle === bundle.id).length;
  });
  return attachValidation(index);
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

function attachProject(index, project) {
  if (!project) {
    return index;
  }
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
  return attachValidation(index);
}

function attachValidation(index) {
  const validation = validateIndex(index);
  index.conformant = validation.conformant;
  index.validForProject = validation.validForProject;
  index.valid = validation.valid;
  index.diagnostics = validation.diagnostics;
  return index;
}

module.exports = {
  attachProject,
  attachValidation,
  buildIndex,
  buildProjectIndex,
  buildProjectIndexAsync,
  bundleAllowsPath,
  bundleExcludesPath,
  documentOverrideKey,
  loadProjectBundles,
  parseBundleArg,
  registerPortableConceptId,
  sanitizeBundleId,
  uniqueBundleIds,
  validateIndex,
  walkMarkdown,
};
