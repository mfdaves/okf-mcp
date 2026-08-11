"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeSlashes, parseMarkdownFile, parseMarkdownText, safeRelativePath } = require("./parser");
const {
  buildAssetRegistry,
  collectAssetReferences,
  isExternalReference,
  isLocalAssetReference,
  mimeIsText,
} = require("./assets");
const { DEFAULT_RELATION_TYPES, loadProjectConfig } = require("./project");
const { fetchRemoteBundles } = require("./remote");
const { validateIndex } = require("./validation");

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
  const exclude = Array.isArray(bundle && bundle.exclude) ? bundle.exclude : [];
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

function documentAtPath(documentsByPath, pathUri) {
  if (!documentsByPath || typeof documentsByPath.get !== "function") {
    return null;
  }
  const document = documentsByPath.get(pathUri);
  return document && document.pathUri === pathUri ? document : null;
}

function registerPortableConceptId(map, ambiguous, key, document) {
  const normalized = normalizeSlashes(String(key || "")).replace(/^\/+/, "").split("#")[0];
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

function resolveConcept(index, locator) {
  const raw = String(locator || "").trim();
  if (!raw || !index) {
    return null;
  }
  const byUri = index.byUri && index.byUri.get(raw);
  if (byUri) {
    return byUri;
  }
  const normalized = normalizeSlashes(raw).replace(/^\/+/, "").split("#")[0];
  if (!normalized || !index.byConceptId) {
    return null;
  }
  return index.byConceptId.get(normalized)
    || index.byConceptId.get(normalized.replace(/\.md$/i, ""))
    || index.byConceptId.get(`${normalized}.md`)
    || null;
}

function resolveIndexedLink(bundleId, resolved, href, documentsByPath) {
  if (!documentsByPath || typeof documentsByPath.get !== "function") {
    return resolved;
  }
  const directTarget = documentAtPath(documentsByPath, resolved.uri);
  if (directTarget) {
    return Object.assign({}, resolved, { uri: directTarget.uri });
  }
  const clean = String(href || "").split("#")[0];
  if (!clean.endsWith("/") && path.posix.extname(resolved.path)) {
    return resolved;
  }
  const indexPath = normalizeSlashes(path.posix.join(resolved.path, "index.md"));
  const indexTarget = documentAtPath(documentsByPath, `okf://${bundleId}/${indexPath}`);
  if (!indexTarget) {
    return resolved;
  }
  return Object.assign({}, resolved, {
    path: indexPath,
    uri: indexTarget.uri,
  });
}

function resolveLinkPath(bundle, fromPath, href, documentsByPath) {
  const clean = String(href || "").split("#")[0];
  if (!clean || clean.startsWith("http://") || clean.startsWith("https://") || clean.startsWith("mailto:")) {
    return null;
  }
  if (bundle.remote) {
    const normalizedPath = clean.startsWith("/")
      ? path.posix.normalize(clean.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), clean));
    const resolvedPath = normalizedPath === "." ? "" : normalizedPath.replace(/\/+$/g, "");
    if (resolvedPath.startsWith("../") || resolvedPath === "..") {
      return {
        outsideRoot: true,
        path: normalizeSlashes(clean),
        uri: null,
      };
    }
    return resolveIndexedLink(bundle.id, {
      outsideRoot: false,
      path: resolvedPath,
      uri: `okf://${bundle.id}/${resolvedPath}`,
    }, clean, documentsByPath);
  }
  const base = clean.startsWith("/")
    ? path.join(bundle.root, clean.slice(1))
    : path.resolve(path.dirname(path.join(bundle.root, fromPath)), clean);
  const relativePath = safeRelativePath(bundle.root, base);
  if (relativePath === null) {
    return {
      outsideRoot: true,
      path: normalizeSlashes(clean),
      uri: null,
    };
  }
  return resolveIndexedLink(bundle.id, {
    outsideRoot: false,
    path: relativePath,
    uri: `okf://${bundle.id}/${relativePath}`,
  }, clean, documentsByPath);
}

function relationFrom(value, doc) {
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/);
    if (parts.length === 1) {
      return { type: "related_to", target: parts[0], source: doc.uri };
    }
    return { type: parts[0], target: parts.slice(1).join(" "), source: doc.uri };
  }
  if (value && typeof value === "object") {
    return {
      type: value.type || value.kind || "related_to",
      target: value.target || value.to || "",
      source: doc.uri,
      label: value.label || value.text || "",
      description: value.description || "",
    };
  }
  return { type: "related_to", target: "", source: doc.uri };
}

function assetUri(bundle, relativePath) {
  return `okf-asset://${bundle}/${normalizeSlashes(relativePath).split("/").map(encodeURIComponent).join("/")}`;
}

function relativeReferencePath(fromPath, reference) {
  const raw = normalizeSlashes(String(reference || "").trim()).split("#")[0];
  if (!raw || isExternalReference(raw)) {
    return null;
  }
  const relative = raw.startsWith("/")
    ? path.posix.normalize(raw.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), raw));
  if (!relative || relative === "." || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    return null;
  }
  return normalizeSlashes(relative);
}

function semanticReferences(doc) {
  const frontmatter = doc.frontmatter || {};
  const references = [];
  function add(kind, field, value, metadata) {
    if (typeof value === "string" && value.trim()) {
      references.push({ kind, field, value: value.trim(), metadata: metadata || null });
    }
  }
  add("resource", "resource", frontmatter.resource);
  const sources = doc.signals && Array.isArray(doc.signals.sources)
    ? doc.signals.sources
    : Array.isArray(frontmatter.sources)
      ? frontmatter.sources
      : [];
  sources.forEach((source, index) => {
    if (source && typeof source === "object" && !Array.isArray(source)) {
      add("source", `sources[${index}].resource`, source.resource, source);
    }
  });
  add("computation", "computation", frontmatter.computation);
  if (frontmatter.executor && typeof frontmatter.executor === "object" && !Array.isArray(frontmatter.executor)) {
    add("executor", "executor.resource", frontmatter.executor.resource);
  }
  if (frontmatter.attester && typeof frontmatter.attester === "object" && !Array.isArray(frontmatter.attester)) {
    add("attester", "attester.resource", frontmatter.attester.resource);
  }
  return references;
}

function buildIndex(bundleArgs, options) {
  const config = options || {};
  const strictLinks = Boolean(config.strictLinks);
  const requestedBundles = uniqueBundleIds((bundleArgs || []).map(parseBundleArg));
  const allowedRelationTypes = new Set((config.relationTypes || DEFAULT_RELATION_TYPES).map(String));
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
      errors.push({ code: "duplicate_bundle_id", bundle: bundle.id, message: "Duplicate bundle id; the later bundle was ignored." });
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
          warnings.push.apply(warnings, doc.warnings.map((warning) => Object.assign({ bundle: doc.bundle }, warning)));
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
      errors.push({ code: "missing_bundle_root", bundle: bundle.id, path: bundle.root, message: "Bundle root does not exist." });
      return;
    }
    walkMarkdown(bundle.root).forEach((filePath) => {
      const relativePath = safeRelativePath(bundle.root, filePath) || normalizeSlashes(filePath);
      if (!bundleAllowsPath(bundle, relativePath)) {
        return;
      }
      try {
        const doc = parseMarkdownFile(bundle, filePath, { asOf: config.asOf });
        documents.push(doc);
        if (doc.reserved) {
          reserved.push(doc);
        } else if (doc.valid) {
          concepts.push(doc);
        }
        warnings.push.apply(warnings, doc.warnings.map((warning) => Object.assign({ bundle: doc.bundle }, warning)));
      } catch (error) {
        errors.push({
          code: "parse_error",
          bundle: bundle.id,
          path: relativePath,
          message: error.message,
        });
      }
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
      errors.push({ code: "duplicate_concept_id", uri: doc.uri, message: "Duplicate canonical OKF Concept ID." });
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
  const assets = localAssetRegistry.assets.filter((asset) => (
    !documentAtPath(byPathUri, `okf://${asset.bundle}/${asset.path}`)
  ));
  bundles.filter((bundle) => bundle.remote).forEach((bundle) => {
    const unresolved = bundle.remoteSource && bundle.remoteSource.unresolvedReferences || [];
    warnings.push.apply(warnings, unresolved.map((entry) => Object.assign({
      severity: "warning",
      layer: "project",
      bundle: bundle.id,
      message: `Referenced remote asset is unavailable: ${entry.resolvedPath || entry.target || "<unknown>"}`,
    }, entry)));
    (bundle.assets || []).forEach((asset) => {
      assets.push(Object.assign({}, asset, {
        bundle: bundle.id,
        uri: asset.uri || assetUri(bundle.id, asset.path),
        remote: true,
      }));
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
          message: "Compatibility URI alias conflicts with another canonical Concept ID; the canonical target wins.",
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
  documents.forEach((doc) => {
    const bundle = bundles.find((entry) => entry.id === doc.bundle);
    doc.links.forEach((link) => {
      const resolved = resolveLinkPath(bundle, doc.path, link.href, byPathUri);
      if (!resolved) {
        return;
      }
      if (resolved.outsideRoot) {
        warnings.push({
          code: "link_outside_root",
          bundle: doc.bundle,
          path: doc.path,
          href: link.href,
          message: "Markdown link resolves outside bundle root.",
        });
        return;
      }
      const target = documentAtPath(byPathUri, `okf://${doc.bundle}/${resolved.path}`);
      const edge = {
        source: doc.uri,
        target: target ? target.uri : resolved.uri,
        kind: "markdown_link",
        text: link.text || "",
        href: link.href,
        broken: !target,
      };
      edges.push(edge);
      if (!target) {
        warnings.push({
          code: "broken_link",
          bundle: doc.bundle,
          path: doc.path,
          href: link.href,
          target: resolved.path,
          message: "Markdown link target does not exist in bundle.",
        });
      }
    });
    doc.relations.map((relation) => relationFrom(relation, doc)).forEach((relation) => {
      const type = String(relation.type || "related_to");
      const targetUri = String(relation.target || "").trim();
      if (!targetUri) {
        errors.push({ code: "missing_relation_target", bundle: doc.bundle, path: doc.path, relationType: type, message: "Relation has no target." });
        return;
      }
      const safeCustomType = /^[A-Za-z0-9_.-]+$/.test(type);
      if (!allowedRelationTypes.has(type) && !(allowCustomRelationTypes && safeCustomType)) {
        errors.push({ code: "invalid_relation_type", bundle: doc.bundle, path: doc.path, relationType: type, message: `Unsupported relation type: ${type}` });
      } else if (allowCustomRelationTypes && safeCustomType) {
        allowedRelationTypes.add(type);
      }
      let targetDocument = byUri.get(targetUri) || null;
      let internalTarget = targetUri.startsWith("okf://");
      if (!targetDocument && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(targetUri)) {
        internalTarget = true;
        const resolved = resolveLinkPath(bundle, doc.path, targetUri, byPathUri);
        if (resolved && !resolved.outsideRoot) {
          targetDocument = documentAtPath(byPathUri, `okf://${doc.bundle}/${resolved.path}`);
          if (!targetDocument && !path.posix.extname(resolved.path)) {
            targetDocument = documentAtPath(byPathUri, `okf://${doc.bundle}/${resolved.path}.md`);
          }
        }
        if (!targetDocument) {
          const normalizedTarget = normalizeSlashes(targetUri).replace(/^\/+/, "").replace(/\.md$/i, "");
          const portableTarget = byConceptId.get(normalizedTarget);
          if (portableTarget && portableTarget.bundle === doc.bundle) {
            targetDocument = portableTarget;
          }
        }
      }
      const target = targetDocument && !targetDocument.reserved && targetDocument.valid
        ? targetDocument
        : null;
      const isExternal = !internalTarget;
      if (isExternal) {
        externalReferences.set(targetUri, { uri: targetUri, kind: "external" });
      }
      if (internalTarget && !target) {
        errors.push({ code: "broken_relation", bundle: doc.bundle, path: doc.path, target: targetUri, relationType: type, message: "Relation target does not resolve to a valid concept." });
      }
      edges.push({
        source: doc.uri,
        target: target ? target.uri : targetUri,
        kind: "relation",
        relationType: type,
        text: relation.label || type,
        description: relation.description || "",
        broken: internalTarget && !target,
        external: isExternal,
      });
    });
    semanticReferences(doc).forEach((reference) => {
      const rawTarget = reference.value;
      let target = null;
      let external = false;
      let broken = false;
      let resolvedAs = "opaque";
      if (rawTarget.startsWith("okf://")) {
        const targetDoc = byUri.get(rawTarget);
        target = targetDoc ? targetDoc.uri : rawTarget;
        const validTarget = Boolean(targetDoc && !targetDoc.reserved && targetDoc.valid);
        broken = !validTarget;
        resolvedAs = validTarget ? "concept" : targetDoc ? "invalid_concept" : "unresolved";
        if (!validTarget) {
          warnings.push({
            code: "broken_semantic_reference",
            severity: "warning",
            layer: "project",
            bundle: doc.bundle,
            path: doc.path,
            field: reference.field,
            target: rawTarget,
            edgeKind: reference.kind,
            message: targetDoc
              ? "Standard OKF semantic reference targets an invalid or reserved document."
              : "Standard OKF semantic reference targets an unknown internal concept.",
          });
        }
      } else if (isExternalReference(rawTarget)) {
        target = rawTarget;
        external = true;
        resolvedAs = "external";
      } else {
        const targetPath = relativeReferencePath(doc.path, rawTarget);
        const targetDoc = targetPath
          ? documentAtPath(byPathUri, `okf://${doc.bundle}/${targetPath}`)
            || byUri.get(`okf://${doc.bundle}/${targetPath.replace(/\.md$/i, "")}`)
          : null;
        const targetAsset = targetPath ? byAssetKey.get(`${doc.bundle}\u0000${targetPath}`) : null;
        if (targetDoc && !targetDoc.reserved && targetDoc.valid) {
          target = targetDoc.uri;
          resolvedAs = "concept";
        } else if (targetDoc) {
          target = targetDoc.uri;
          broken = true;
          resolvedAs = "invalid_concept";
        } else if (targetAsset) {
          target = targetAsset.uri;
          resolvedAs = "asset";
        } else {
          target = rawTarget;
          const opaqueSource = reference.kind === "source" && !isLocalAssetReference(rawTarget, { allowBare: false });
          external = opaqueSource;
          broken = !opaqueSource;
          resolvedAs = opaqueSource ? "opaque" : "unresolved";
        }
      }
      if (broken && !rawTarget.startsWith("okf://")) {
        warnings.push({
          code: "broken_semantic_reference",
          severity: "warning",
          layer: "project",
          bundle: doc.bundle,
          path: doc.path,
          field: reference.field,
          target: rawTarget,
          edgeKind: reference.kind,
          message: "Standard OKF semantic reference does not resolve to a valid local concept or indexed asset.",
        });
      }
      if (external) {
        externalReferences.set(target, { uri: target, kind: "external" });
      }
      edges.push({
        source: doc.uri,
        target,
        kind: reference.kind,
        field: reference.field,
        reference: rawTarget,
        sourceEntry: reference.kind === "source" ? reference.metadata : undefined,
        resolvedAs,
        broken,
        external,
      });
    });
  });

  concepts.forEach((doc) => {
    const contract = doc.signals && doc.signals.computation;
    if (!contract) {
      return;
    }
    const contractEdges = edges.filter((edge) => (
      edge.source === doc.uri
      && ["computation", "executor", "attester"].includes(edge.kind)
    ));
    const requiredKinds = contract.computation && contract.computation.mode === "file"
      ? ["computation", "executor", "attester"]
      : ["executor", "attester"];
    const assetsReady = requiredKinds.every((kind) => {
      const edge = contractEdges.find((entry) => entry.kind === kind);
      if (!edge || edge.broken) {
        return false;
      }
      if (kind === "computation") {
        if (edge.resolvedAs !== "asset") {
          return false;
        }
        const asset = byAssetUri.get(edge.target);
        return Boolean(asset && (!mimeIsText(asset.mimeType) || asset.kind === "text"));
      }
      if (edge.resolvedAs === "concept") {
        return true;
      }
      if (edge.resolvedAs !== "asset") {
        return false;
      }
      const asset = byAssetUri.get(edge.target);
      return Boolean(asset && (!mimeIsText(asset.mimeType) || asset.kind === "text"));
    });
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
    const okfVersion = rootIndex
      && rootIndex.frontmatter
      && Object.prototype.hasOwnProperty.call(rootIndex.frontmatter, "okf_version")
      ? rootIndex.frontmatter.okf_version
      : null;
    bundle.okfVersion = okfVersion === null ? null : String(okfVersion);
    bundle.versionStatus = bundle.okfVersion === "0.2"
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
    strictLinks: options && options.strictLinks !== undefined
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
    remoteBundles: project.remoteBundles,
    strictLinks: project.strictLinks,
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

function conceptSignals(doc, detailed) {
  const signals = doc.signals || {};
  const computation = signals.computation;
  const output = {
    status: signals.status,
    staleAfter: signals.staleAfter,
    freshness: signals.freshness,
    asOf: signals.asOf,
    trustTier: signals.trustTier,
    sourceCount: Array.isArray(signals.sources) ? signals.sources.length : 0,
    hasSources: Array.isArray(signals.sources) && signals.sources.length > 0,
    sourcesOrigin: signals.sourcesOrigin,
    generated: signals.generated,
    generatedOrigin: signals.generatedOrigin,
    computation: computation ? {
      runtime: computation.runtime,
      mode: computation.computation && computation.computation.mode,
      attestationReady: Boolean(computation.attestationReady),
      structuralReady: Boolean(computation.structuralReady),
      assetsReady: Boolean(computation.assetsReady),
    } : null,
  };
  if (detailed) {
    output.resource = signals.resource;
    output.sources = signals.sources || [];
    output.usageWindow = signals.usageWindow;
    output.verifiedEvents = signals.verifiedEvents || [];
    output.diagnostics = signals.diagnostics || [];
    if (computation) {
      output.computation = Object.assign({}, computation);
    }
  }
  return output;
}

function conceptSummary(doc) {
  return {
    uri: doc.uri,
    bundle: doc.bundle,
    path: doc.path,
    pathUri: doc.pathUri,
    conceptId: doc.conceptId,
    uriAliases: doc.uriAliases || [],
    type: doc.type,
    title: doc.title,
    description: doc.description,
    tags: doc.tags,
    aliases: doc.aliases,
    signals: conceptSignals(doc, false),
  };
}

module.exports = {
  buildIndex,
  buildProjectIndex,
  buildProjectIndexAsync,
  attachProject,
  conceptSummary,
  conceptSignals,
  bundleAllowsPath,
  bundleExcludesPath,
  loadProjectBundles,
  parseBundleArg,
  resolveLinkPath,
  resolveConcept,
  semanticReferences,
  sanitizeBundleId,
  validateIndex,
};
