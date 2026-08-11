"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_ASSET_BYTES = 1024 * 1024;

const MIME_TYPES = Object.freeze({
  ".css": "text/css",
  ".csv": "text/csv",
  ".graphql": "application/graphql",
  ".gql": "application/graphql",
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".proto": "text/plain",
  ".py": "text/x-python",
  ".sh": "text/x-shellscript",
  ".sql": "application/sql",
  ".toml": "application/toml",
  ".ts": "text/typescript",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".gif": "image/gif",
  ".gz": "application/gzip",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".zip": "application/zip",
});

const TEXT_APPLICATION_MIME_TYPES = new Set([
  "application/graphql",
  "application/json",
  "application/sql",
  "application/toml",
  "application/xml",
  "application/yaml",
  "image/svg+xml",
]);

const BINARY_MIME_PREFIXES = ["audio/", "video/"];
const BINARY_MIME_TYPES = new Set([
  "application/gzip",
  "application/pdf",
  "application/zip",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

class AssetRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AssetRegistryError";
    this.code = code;
  }
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function assetKey(bundle, relativePath) {
  return `${String(bundle || "")}:${normalizeSlashes(relativePath)}`;
}

function isExternalReference(value) {
  const text = String(value || "").trim();
  return (
    text.startsWith("//")
    || text.startsWith("#")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)
  );
}

function looksLikeExplicitSourcePath(value) {
  const text = normalizeSlashes(String(value || "").trim());
  if (!text || isExternalReference(text) || text.includes("\0")) {
    return false;
  }
  return (
    text.startsWith("/")
    || text.startsWith("./")
    || text.startsWith("../")
    || text.startsWith("references/")
    || (text.includes("/") && Boolean(path.posix.extname(text)))
    || Object.prototype.hasOwnProperty.call(MIME_TYPES, path.posix.extname(text).toLowerCase())
  );
}

function isLocalAssetReference(value, options) {
  if (typeof value !== "string") {
    return false;
  }
  const text = value.trim();
  if (!text || text.includes("\0") || isExternalReference(text)) {
    return false;
  }
  return Boolean(options && options.allowBare) || looksLikeExplicitSourcePath(text);
}

function documentValue(document, key) {
  const layers = [
    document,
    document && document.signals,
    document && document.normalized,
    document && document.v02,
    document && document.frontmatter,
    document && document.metadata,
  ];
  for (const layer of layers) {
    if (layer && Object.prototype.hasOwnProperty.call(layer, key)) {
      return layer[key];
    }
  }
  return undefined;
}

function collectAssetReferences(document) {
  if (!document || typeof document !== "object") {
    return [];
  }
  const bundle = String(document.bundle || "").trim();
  const fromPath = normalizeSlashes(document.path || "");
  const referencedByUri = document.uri || document.pathUri || "";
  const references = [];

  function add(role, field, value, allowBare) {
    if (!isLocalAssetReference(value, { allowBare })) {
      return;
    }
    references.push({
      bundle,
      fromPath,
      referencedByUri,
      role,
      field,
      value: String(value).trim(),
    });
  }

  add("resource", "resource", documentValue(document, "resource"), true);

  const sources = documentValue(document, "sources");
  if (Array.isArray(sources)) {
    sources.forEach((source, index) => {
      if (source && typeof source === "object" && !Array.isArray(source)) {
        add("source", `sources[${index}].resource`, source.resource, false);
      }
    });
  }

  const computation = documentValue(document, "computation");
  if (typeof computation === "string") {
    add("computation", "computation", computation, true);
  } else if (computation && typeof computation === "object" && !Array.isArray(computation)) {
    const fileComputation = computation.mode === "file"
      ? computation
      : computation.computation && computation.computation.mode === "file"
        ? computation.computation
        : null;
    if (fileComputation) {
      add("computation", "computation", fileComputation.path, true);
    }
  }

  const executor = documentValue(document, "executor")
    || (computation && typeof computation === "object" && computation.executor);
  if (executor && typeof executor === "object" && !Array.isArray(executor)) {
    add("executor", "executor.resource", executor.resource, true);
  }

  const attester = documentValue(document, "attester")
    || (computation && typeof computation === "object" && computation.attester);
  if (attester && typeof attester === "object" && !Array.isArray(attester)) {
    add("attester", "attester.resource", attester.resource, true);
  }

  return references;
}

function isInsidePath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveBundleAssetPath(bundleRoot, fromPath, reference) {
  if (!bundleRoot) {
    throw new AssetRegistryError("asset_bundle_root_missing", "Referenced asset has no local bundle root.");
  }
  const raw = normalizeSlashes(String(reference || "").trim());
  if (!raw || raw.includes("\0") || isExternalReference(raw)) {
    throw new AssetRegistryError("asset_invalid_reference", "Referenced asset is not a safe bundle-local path.");
  }

  const root = path.resolve(bundleRoot);
  const relative = raw.startsWith("/")
    ? path.posix.normalize(raw.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(normalizeSlashes(fromPath || "")), raw));
  if (!relative || relative === "." || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    throw new AssetRegistryError("asset_outside_root", `Referenced asset resolves outside bundle root: ${raw}`);
  }

  const absolutePath = path.resolve(root, ...relative.split("/"));
  if (!isInsidePath(root, absolutePath)) {
    throw new AssetRegistryError("asset_outside_root", `Referenced asset resolves outside bundle root: ${raw}`);
  }
  return {
    root,
    path: normalizeSlashes(relative),
    absolutePath,
  };
}

function inspectAssetPath(root, relativePath) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new AssetRegistryError("asset_bundle_root_missing", `Bundle root does not exist: ${root}`);
    }
    throw error;
  }
  if (rootStat.isSymbolicLink()) {
    throw new AssetRegistryError("asset_symlink", "Referenced assets cannot use a symbolic-link bundle root.");
  }
  if (!rootStat.isDirectory()) {
    throw new AssetRegistryError("asset_bundle_root_invalid", `Bundle root is not a directory: ${root}`);
  }

  const segments = normalizeSlashes(relativePath).split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        throw new AssetRegistryError("asset_missing", `Referenced asset does not exist: ${relativePath}`);
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new AssetRegistryError("asset_symlink", `Referenced asset path traverses a symbolic link: ${relativePath}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new AssetRegistryError("asset_path_component_not_directory", `Referenced asset path has a non-directory component: ${relativePath}`);
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      throw new AssetRegistryError("asset_not_file", `Referenced asset is not a regular file: ${relativePath}`);
    }
  }
}

function mimeTypeForPath(relativePath) {
  return MIME_TYPES[path.posix.extname(String(relativePath || "")).toLowerCase()] || "application/octet-stream";
}

function mimeIsDefinitelyBinary(mimeType) {
  return BINARY_MIME_TYPES.has(mimeType) || BINARY_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function mimeIsText(mimeType) {
  return mimeType.startsWith("text/") || TEXT_APPLICATION_MIME_TYPES.has(mimeType);
}

function classifyAssetContent(content, mimeType) {
  if (mimeIsDefinitelyBinary(mimeType) || content.includes(0)) {
    return { kind: "binary", encoding: null, text: null, validUtf8: false };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
    return { kind: "text", encoding: "utf-8", text, validUtf8: true };
  } catch (error) {
    return { kind: "binary", encoding: null, text: null, validUtf8: false };
  }
}

function bundleMapFor(bundles) {
  if (bundles instanceof Map) {
    return bundles;
  }
  const out = new Map();
  if (Array.isArray(bundles)) {
    bundles.forEach((bundle) => {
      if (bundle && bundle.id) {
        out.set(String(bundle.id), bundle);
      }
    });
  } else if (bundles && typeof bundles === "object") {
    Object.entries(bundles).forEach(([id, bundle]) => out.set(id, bundle));
  }
  return out;
}

function diagnosticFor(error, reference, extra) {
  const known = error instanceof AssetRegistryError;
  return Object.assign({
    code: known ? error.code : "asset_read_error",
    severity: "warning",
    layer: "project",
    bundle: reference.bundle,
    path: reference.fromPath,
    field: reference.field,
    target: reference.value,
    message: error && error.message ? error.message : String(error),
  }, extra || {});
}

function publicReference(reference) {
  return {
    uri: reference.referencedByUri,
    bundle: reference.bundle,
    path: reference.fromPath,
    field: reference.field,
    role: reference.role,
  };
}

function buildAssetRegistry(documents, bundles, options) {
  const config = options || {};
  const maxAssetBytes = config.maxAssetBytes === undefined
    ? DEFAULT_MAX_ASSET_BYTES
    : Number(config.maxAssetBytes);
  if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1) {
    throw new TypeError("maxAssetBytes must be a positive safe integer.");
  }

  const bundleById = bundleMapFor(bundles);
  const groups = new Map();
  const diagnostics = [];

  (documents || []).forEach((document) => {
    collectAssetReferences(document).forEach((reference) => {
      const configuredBundle = bundleById.get(reference.bundle);
      const bundleRoot = document.bundleRoot || (configuredBundle && configuredBundle.root);
      let resolved;
      try {
        resolved = resolveBundleAssetPath(bundleRoot, reference.fromPath, reference.value);
      } catch (error) {
        diagnostics.push(diagnosticFor(error, reference));
        return;
      }
      if (typeof config.skipResolvedPath === "function"
        && config.skipResolvedPath(configuredBundle || { id: reference.bundle }, resolved.path, reference)) {
        return;
      }
      if (typeof config.allowResolvedPath === "function"
        && !config.allowResolvedPath(configuredBundle || { id: reference.bundle }, resolved.path, reference)) {
        diagnostics.push(diagnosticFor(
          new AssetRegistryError("asset_excluded", `Referenced asset is excluded by bundle policy: ${resolved.path}`),
          reference,
        ));
        return;
      }
      const groupKey = `${reference.bundle}\u0000${resolved.path}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          bundle: reference.bundle,
          root: resolved.root,
          path: resolved.path,
          absolutePath: resolved.absolutePath,
          references: [],
        });
      }
      groups.get(groupKey).references.push(reference);
    });
  });

  const assets = [];
  Array.from(groups.values())
    .sort((left, right) => left.bundle.localeCompare(right.bundle) || left.path.localeCompare(right.path))
    .forEach((group) => {
      const first = group.references[0];
      let content;
      try {
        inspectAssetPath(group.root, group.path);
        const stat = fs.statSync(group.absolutePath);
        if (stat.size > maxAssetBytes) {
          throw new AssetRegistryError("asset_too_large", `Referenced asset exceeds the ${maxAssetBytes} byte limit: ${group.path}`);
        }
        let descriptor;
        try {
          descriptor = fs.openSync(group.absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
          content = fs.readFileSync(descriptor);
        } finally {
          if (descriptor !== undefined) {
            fs.closeSync(descriptor);
          }
        }
        if (content.length > maxAssetBytes) {
          throw new AssetRegistryError("asset_too_large", `Referenced asset exceeds the ${maxAssetBytes} byte limit: ${group.path}`);
        }
      } catch (error) {
        const normalizedError = error && error.code === "ELOOP"
          ? new AssetRegistryError("asset_symlink", `Referenced asset is a symbolic link: ${group.path}`)
          : error;
        diagnostics.push(diagnosticFor(normalizedError, first, {
          referencedBy: group.references.map(publicReference),
        }));
        return;
      }

      const mimeType = mimeTypeForPath(group.path);
      const classification = classifyAssetContent(content, mimeType);
      const referencedBy = group.references.map(publicReference).sort((left, right) => (
        String(left.uri).localeCompare(String(right.uri)) || left.field.localeCompare(right.field)
      ));
      const roles = Array.from(new Set(group.references.map((reference) => reference.role))).sort();
      const asset = {
        key: assetKey(group.bundle, group.path),
        bundle: group.bundle,
        path: group.path,
        size: content.length,
        sha256: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
        mimeType,
        kind: classification.kind,
        encoding: classification.encoding,
        text: classification.text,
        roles,
        referencedBy,
      };
      Object.defineProperty(asset, "_contentBytes", {
        configurable: false,
        enumerable: false,
        value: content,
        writable: false,
      });
      assets.push(asset);

      if (mimeIsText(mimeType) && !classification.validUtf8) {
        diagnostics.push(diagnosticFor(
          new AssetRegistryError("asset_invalid_utf8", `Text asset is not valid UTF-8: ${group.path}`),
          first,
          { referencedBy },
        ));
      }
    });

  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  return { assets, byKey, diagnostics };
}

module.exports = {
  AssetRegistryError,
  DEFAULT_MAX_ASSET_BYTES,
  assetKey,
  buildAssetRegistry,
  classifyAssetContent,
  collectAssetReferences,
  isExternalReference,
  isLocalAssetReference,
  mimeIsText,
  mimeTypeForPath,
  resolveBundleAssetPath,
};
