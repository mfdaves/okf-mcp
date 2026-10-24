"use strict";

const path = require("node:path");
const { normalizeSlashes, safeRelativePath } = require("../parser");
const { isExternalReference, isLocalAssetReference, mimeIsText } = require("../assets");
const { displayIdentifier } = require("../catalog-text");

function documentAtPath(documentsByPath, pathUri) {
  if (!documentsByPath || typeof documentsByPath.get !== "function") {
    return null;
  }
  const document = documentsByPath.get(pathUri);
  return document && document.pathUri === pathUri ? document : null;
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
  if (
    !clean ||
    clean.startsWith("http://") ||
    clean.startsWith("https://") ||
    clean.startsWith("mailto:")
  ) {
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
    return resolveIndexedLink(
      bundle.id,
      {
        outsideRoot: false,
        path: resolvedPath,
        uri: `okf://${bundle.id}/${resolvedPath}`,
      },
      clean,
      documentsByPath,
    );
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
  return resolveIndexedLink(
    bundle.id,
    {
      outsideRoot: false,
      path: relativePath,
      uri: `okf://${bundle.id}/${relativePath}`,
    },
    clean,
    documentsByPath,
  );
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
  if (
    !relative ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative)
  ) {
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
  const sources =
    doc.signals && Array.isArray(doc.signals.sources)
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
  if (
    frontmatter.executor &&
    typeof frontmatter.executor === "object" &&
    !Array.isArray(frontmatter.executor)
  ) {
    add("executor", "executor.resource", frontmatter.executor.resource);
  }
  if (
    frontmatter.attester &&
    typeof frontmatter.attester === "object" &&
    !Array.isArray(frontmatter.attester)
  ) {
    add("attester", "attester.resource", frontmatter.attester.resource);
  }
  return references;
}

// Derives one document's outbound graph: Markdown link edges, typed relation
// edges, and standard semantic reference edges, with the warnings and errors
// they raise. Resolution goes only through `lookups` (Map-like objects with a
// `get` method keyed like the index maps), so a caller can observe exactly
// which keys a document's edges depend on.
function documentEdges(doc, bundle, lookups, config) {
  const allowedRelationTypes = config.allowedRelationTypes;
  const allowCustomRelationTypes = Boolean(config.allowCustomRelationTypes);
  const { byPathUri, byUri, byConceptId, byAssetKey } = lookups;
  const edges = [];
  const warnings = [];
  const errors = [];
  const externalReferences = [];
  const customRelationTypes = [];
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
  doc.relations
    .map((relation) => relationFrom(relation, doc))
    .forEach((relation) => {
      const type = String(relation.type || "related_to");
      const targetUri = String(relation.target || "").trim();
      if (!targetUri) {
        errors.push({
          code: "missing_relation_target",
          bundle: doc.bundle,
          path: doc.path,
          relationType: type,
          message: "Relation has no target.",
        });
        return;
      }
      const safeCustomType = /^[A-Za-z0-9_.-]+$/.test(type);
      if (!allowedRelationTypes.has(type) && !(allowCustomRelationTypes && safeCustomType)) {
        errors.push({
          code: "invalid_relation_type",
          bundle: doc.bundle,
          path: doc.path,
          relationType: type,
          message: `Unsupported relation type ${displayIdentifier(type)} on ${doc.uri || doc.path}`,
        });
      } else if (allowCustomRelationTypes && safeCustomType) {
        customRelationTypes.push(type);
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
          const normalizedTarget = normalizeSlashes(targetUri)
            .replace(/^\/+/, "")
            .replace(/\.md$/i, "");
          const portableTarget = byConceptId.get(normalizedTarget);
          if (portableTarget && portableTarget.bundle === doc.bundle) {
            targetDocument = portableTarget;
          }
        }
      }
      const target =
        targetDocument && !targetDocument.reserved && targetDocument.valid ? targetDocument : null;
      const isExternal = !internalTarget;
      if (isExternal) {
        externalReferences.push(targetUri);
      }
      if (internalTarget && !target) {
        errors.push({
          code: "broken_relation",
          bundle: doc.bundle,
          path: doc.path,
          target: targetUri,
          relationType: type,
          message: "Relation target does not resolve to a valid concept.",
        });
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
        ? documentAtPath(byPathUri, `okf://${doc.bundle}/${targetPath}`) ||
          byUri.get(`okf://${doc.bundle}/${targetPath.replace(/\.md$/i, "")}`)
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
        const opaqueSource =
          reference.kind === "source" && !isLocalAssetReference(rawTarget, { allowBare: false });
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
        message:
          "Standard OKF semantic reference does not resolve to a valid local concept or indexed asset.",
      });
    }
    if (external) {
      externalReferences.push(target);
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
  return { edges, warnings, errors, externalReferences, customRelationTypes };
}

// Whether every asset or concept an attested computation contract needs is
// present and readable, judged from the contract's own semantic edges.
function contractAssetsReady(contract, contractEdges, byAssetUri) {
  const requiredKinds =
    contract.computation && contract.computation.mode === "file"
      ? ["computation", "executor", "attester"]
      : ["executor", "attester"];
  return requiredKinds.every((kind) => {
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
}

module.exports = {
  assetUri,
  contractAssetsReady,
  documentAtPath,
  documentEdges,
  relationFrom,
  relativeReferencePath,
  resolveLinkPath,
  semanticReferences,
};
