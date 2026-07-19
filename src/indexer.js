"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeSlashes, parseMarkdownFile, parseMarkdownText, safeRelativePath } = require("./parser");
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
        source += ".*";
        index += 1;
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

function buildIndex(bundleArgs, options) {
  const config = options || {};
  const bundles = uniqueBundleIds((bundleArgs || []).map(parseBundleArg));
  const allowedRelationTypes = new Set((config.relationTypes || DEFAULT_RELATION_TYPES).map(String));
  const documents = [];
  const concepts = [];
  const reserved = [];
  const warnings = [];
  const errors = [];
  const externalReferences = new Map();
  const seenBundleIds = new Set();

  bundles.forEach((bundle) => {
    if (seenBundleIds.has(bundle.id)) {
      errors.push({ code: "duplicate_bundle_id", bundle: bundle.id, message: "Duplicate bundle id." });
    }
    seenBundleIds.add(bundle.id);
  });

  bundles.forEach((bundle) => {
    if (bundle.remote) {
      (bundle.documents || []).forEach((remoteDoc) => {
        const relativePath = normalizeSlashes(remoteDoc.path);
        if (!bundleAllowsPath(bundle, relativePath)) {
          return;
        }
        try {
          const doc = parseMarkdownText(bundle, relativePath, String(remoteDoc.text || ""), remoteDoc.source || relativePath);
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
        const doc = parseMarkdownFile(bundle, filePath);
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
  documents.forEach((doc) => {
    if (!byPathUri.has(doc.pathUri)) {
      byPathUri.set(doc.pathUri, doc);
    }
    if (byUri.has(doc.uri)) {
      errors.push({ code: "duplicate_uri", uri: doc.uri, message: "Duplicate OKF URI." });
    }
    byUri.set(doc.uri, doc);
    if (doc.pathUri !== doc.uri) {
      if (byUri.has(doc.pathUri)) {
        errors.push({ code: "duplicate_uri", uri: doc.pathUri, message: "Duplicate OKF path URI." });
      } else {
        byUri.set(doc.pathUri, doc);
      }
    }
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
      if (!allowedRelationTypes.has(type)) {
        errors.push({ code: "invalid_relation_type", bundle: doc.bundle, path: doc.path, relationType: type, message: `Unsupported relation type: ${type}` });
      }
      const target = byUri.get(targetUri);
      const isOkfTarget = targetUri.startsWith("okf://");
      const isExternal = !isOkfTarget;
      if (isExternal) {
        externalReferences.set(targetUri, { uri: targetUri, kind: "external" });
      }
      if (isOkfTarget && !target) {
        errors.push({ code: "broken_relation", bundle: doc.bundle, path: doc.path, target: targetUri, relationType: type, message: "Relation target does not exist." });
      }
      edges.push({
        source: doc.uri,
        target: target ? target.uri : targetUri,
        kind: "relation",
        relationType: type,
        text: relation.label || type,
        description: relation.description || "",
        broken: isOkfTarget && !target,
        external: isExternal,
      });
    });
  });

  const index = {
    bundles,
    documents,
    concepts,
    reserved,
    relationTypes: Array.from(allowedRelationTypes),
    externalReferences: Array.from(externalReferences.values()),
    warnings,
    errors,
    edges,
    byUri,
    byPathUri,
  };
  return attachValidation(index);
}

function buildProjectIndex(projectPath) {
  const project = loadProjectConfig(projectPath);
  const index = buildIndex(project.bundles, { relationTypes: project.relationTypes });
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
  const index = buildIndex(loaded.bundles, { relationTypes: loaded.project.relationTypes });
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
  };
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

function conceptSummary(doc) {
  return {
    uri: doc.uri,
    bundle: doc.bundle,
    path: doc.path,
    pathUri: doc.pathUri,
    type: doc.type,
    title: doc.title,
    description: doc.description,
    tags: doc.tags,
    aliases: doc.aliases,
  };
}

module.exports = {
  buildIndex,
  buildProjectIndex,
  buildProjectIndexAsync,
  attachProject,
  conceptSummary,
  bundleAllowsPath,
  loadProjectBundles,
  parseBundleArg,
  resolveLinkPath,
  sanitizeBundleId,
  validateIndex,
};
