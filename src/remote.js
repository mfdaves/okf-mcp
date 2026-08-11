"use strict";

const crypto = require("crypto");
const path = require("path");
const {
  collectAssetReferences,
  classifyAssetContent,
  mimeIsText,
  mimeTypeForPath,
} = require("./assets");
const { parseMarkdownText } = require("./parser");

const DEFAULT_REMOTE_LIMITS = {
  maxFiles: 500,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 5 * 1024 * 1024,
  maxInventoryFiles: 5000,
};

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function encodePath(value) {
  return String(value || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function sanitizeRemoteId(value, fallback) {
  const raw = String(value || fallback || "remote").trim();
  return raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "remote";
}

function parseGitHubBundleUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch (error) {
    throw new Error(`Invalid GitHub bundle URL: ${url || "<missing>"}`);
  }
  if (parsed.protocol !== "https:"
    || parsed.hostname !== "github.com"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new Error("Remote OKF v1 supports only https://github.com URLs.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 5 || parts[2] !== "tree") {
    throw new Error("GitHub bundle URL must be a repository tree URL: https://github.com/<owner>/<repo>/tree/<ref>/<path>");
  }
  const owner = parts[0];
  const repo = parts[1];
  const ref = parts[3];
  const bundlePath = normalizeSlashes(parts.slice(4).join("/"));
  if (!owner || !repo || !ref || !bundlePath || bundlePath.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("GitHub bundle URL must include owner, repo, ref, and a safe bundle path.");
  }
  return { owner, repo, ref, path: bundlePath, url: String(parsed) };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "okf-mcp",
    },
  });
  if (!response || !response.ok) {
    const status = response ? `${response.status} ${response.statusText || ""}`.trim() : "no response";
    throw new Error(`GitHub request failed: ${status}`);
  }
  return response.json();
}

async function fetchBytes(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "okf-mcp",
    },
  });
  if (!response || !response.ok) {
    const status = response ? `${response.status} ${response.statusText || ""}`.trim() : "no response";
    throw new Error(`GitHub raw file request failed: ${status}`);
  }
  if (typeof response.arrayBuffer === "function") {
    return Buffer.from(await response.arrayBuffer());
  }
  return Buffer.from(await response.text(), "utf8");
}

function gitBlobSha(content) {
  const header = Buffer.from(`blob ${content.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(content).digest("hex");
}

function patternToRegex(pattern) {
  const text = normalizeSlashes(pattern);
  let source = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "*") {
      if (text[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesPattern(relativePath, pattern) {
  const normalizedPath = normalizeSlashes(relativePath);
  const normalizedPattern = normalizeSlashes(pattern);
  return normalizedPath === normalizedPattern
    || (normalizedPattern.endsWith("/") && normalizedPath.startsWith(normalizedPattern))
    || (normalizedPattern.includes("*") && patternToRegex(normalizedPattern).test(normalizedPath))
    || (!normalizedPattern.includes("*") && normalizedPath.startsWith(`${normalizedPattern}/`));
}

function allowsRemotePath(config, relativePath) {
  const include = Array.isArray(config.include) ? config.include : [];
  const exclude = Array.isArray(config.exclude) ? config.exclude : [];
  return (!include.length || include.some((pattern) => matchesPattern(relativePath, pattern)))
    && !exclude.some((pattern) => matchesPattern(relativePath, pattern));
}

function excludesRemotePath(config, relativePath) {
  const exclude = Array.isArray(config.exclude) ? config.exclude : [];
  return exclude.some((pattern) => matchesPattern(relativePath, pattern));
}

function remoteReferencePath(fromPath, reference) {
  const raw = normalizeSlashes(String(reference || "").trim()).split("#")[0];
  const relative = raw.startsWith("/")
    ? path.posix.normalize(raw.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), raw));
  if (!relative || relative === "." || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

function relativeRemotePath(rootPath, filePath) {
  const root = normalizeSlashes(rootPath).replace(/\/+$/, "");
  const full = normalizeSlashes(filePath);
  if (full === root) {
    return path.posix.basename(full);
  }
  if (!full.startsWith(`${root}/`)) {
    throw new Error(`Remote file path is outside bundle path: ${filePath}`);
  }
  const relative = full.slice(root.length + 1);
  if (!relative || relative.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`Remote file path is unsafe: ${filePath}`);
  }
  return relative;
}

async function fetchGitHubBundle(config, options) {
  const source = parseGitHubBundleUrl(config && config.url);
  const fetchImpl = (options && options.fetch) || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Remote bundle loading requires fetch support.");
  }
  const limits = Object.assign({}, DEFAULT_REMOTE_LIMITS, (options && options.limits) || {});
  const documents = [];
  const assets = [];
  const inventory = new Map();
  const unresolvedReferences = [];
  let totalBytes = 0;

  let commitSha = /^[0-9a-f]{40}$/i.test(source.ref) ? source.ref : null;
  if (!commitSha) {
    const commit = await fetchJson(
      fetchImpl,
      `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref)}`,
    );
    if (!commit || !/^[0-9a-f]{40}$/i.test(String(commit.sha || ""))) {
      throw new Error(`GitHub ref did not resolve to an immutable commit SHA: ${source.ref}`);
    }
    commitSha = String(commit.sha);
  }
  const pinnedRef = commitSha;

  async function walk(apiPath) {
    const apiUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${encodePath(apiPath)}?ref=${encodeURIComponent(pinnedRef)}`;
    const entries = await fetchJson(fetchImpl, apiUrl);
    const list = Array.isArray(entries) ? entries : [entries];
    for (const entry of list) {
      if (entry.type === "dir") {
        await walk(entry.path);
        continue;
      }
      if (entry.type !== "file") {
        continue;
      }
      if (inventory.size >= limits.maxInventoryFiles) {
        throw new Error(`Remote bundle exceeds inventory limit of ${limits.maxInventoryFiles} files.`);
      }
      const relativePath = relativeRemotePath(source.path, entry.path);
      inventory.set(relativePath, entry);
    }
  }

  async function fetchInventoryEntry(entry, relativePath, kind) {
    if (documents.length + assets.length >= limits.maxFiles) {
      throw new Error(`Remote bundle exceeds file limit of ${limits.maxFiles}.`);
    }
      if (Number(entry.size || 0) > limits.maxFileBytes) {
        throw new Error(`Remote file exceeds byte limit: ${entry.path}`);
      }
      if (!entry.download_url) {
        throw new Error(`Remote file has no download URL: ${entry.path}`);
      }
      const content = await fetchBytes(fetchImpl, entry.download_url);
      const bytes = content.length;
      if (bytes > limits.maxFileBytes) {
        throw new Error(`Remote file exceeds byte limit after download: ${entry.path}`);
      }
      totalBytes += bytes;
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error(`Remote bundle exceeds total byte limit of ${limits.maxTotalBytes}.`);
      }
      if (/^[0-9a-f]{40}$/i.test(String(entry.sha || ""))
        && gitBlobSha(content).toLowerCase() !== String(entry.sha).toLowerCase()) {
        throw new Error(`Remote file content does not match its Git blob SHA: ${entry.path}`);
      }
      if (kind === "document") {
        let text;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(content);
        } catch {
          throw new Error(`Remote Markdown document is not valid UTF-8: ${entry.path}`);
        }
        const document = {
          path: relativePath,
          text,
          source: `github://${source.owner}/${source.repo}/${pinnedRef}/${entry.path}`,
          blobSha: entry.sha || null,
        };
        documents.push(document);
        return document;
      }
      return { content, bytes };
  }

  await walk(source.path);
  for (const [relativePath, entry] of inventory) {
    if (!relativePath.toLowerCase().endsWith(".md") || !allowsRemotePath(config, relativePath)) {
      continue;
    }
    await fetchInventoryEntry(entry, relativePath, "document");
  }

  const referenceGroups = new Map();
  const bundleId = sanitizeRemoteId(config.id, path.posix.basename(source.path));
  documents.forEach((document) => {
    let parsed;
    try {
      parsed = parseMarkdownText(
        { id: bundleId, root: "", remote: true },
        document.path,
        document.text,
        document.source,
      );
    } catch {
      return;
    }
    collectAssetReferences(parsed).forEach((reference) => {
      const resolvedPath = remoteReferencePath(document.path, reference.value);
      if (!resolvedPath) {
        unresolvedReferences.push({
          path: document.path,
          field: reference.field,
          target: reference.value,
          code: "asset_outside_root",
        });
        return;
      }
      if (resolvedPath.toLowerCase().endsWith(".md") && inventory.has(resolvedPath)) {
        return;
      }
      if (excludesRemotePath(config, resolvedPath)) {
        unresolvedReferences.push({
          path: document.path,
          field: reference.field,
          target: reference.value,
          resolvedPath,
          code: "asset_excluded",
        });
        return;
      }
      if (!referenceGroups.has(resolvedPath)) {
        referenceGroups.set(resolvedPath, []);
      }
      referenceGroups.get(resolvedPath).push(reference);
    });
  });

  for (const [relativePath, references] of referenceGroups) {
    const entry = inventory.get(relativePath);
    if (!entry) {
      unresolvedReferences.push.apply(unresolvedReferences, references.map((reference) => ({
        path: reference.fromPath,
        field: reference.field,
        target: reference.value,
        resolvedPath: relativePath,
        code: "asset_missing",
      })));
      continue;
    }
    const fetched = await fetchInventoryEntry(entry, relativePath, "asset");
    const mimeType = mimeTypeForPath(relativePath);
    const classification = classifyAssetContent(fetched.content, mimeType);
    if (mimeIsText(mimeType) && !classification.validUtf8) {
      unresolvedReferences.push({
        path: references[0].fromPath,
        field: references[0].field,
        target: references[0].value,
        resolvedPath: relativePath,
        code: "asset_invalid_utf8",
      });
    }
    assets.push({
      path: relativePath,
      size: fetched.bytes,
      sha256: `sha256:${crypto.createHash("sha256").update(fetched.content).digest("hex")}`,
      mimeType,
      kind: classification.kind,
      encoding: classification.encoding,
      text: classification.text,
      ...(classification.kind === "binary" ? { base64: fetched.content.toString("base64") } : {}),
      roles: Array.from(new Set(references.map((reference) => reference.role))).sort(),
      referencedBy: references.map((reference) => ({
        uri: reference.referencedByUri,
        bundle: bundleId,
        path: reference.fromPath,
        field: reference.field,
        role: reference.role,
      })),
      blobSha: entry.sha || null,
    });
  }
  return {
    id: bundleId,
    remote: true,
    root: "",
    documents,
    assets,
    include: Array.isArray(config.include) ? config.include : [],
    exclude: Array.isArray(config.exclude) ? config.exclude : [],
    remoteSource: {
      provider: "github",
      url: source.url,
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      path: source.path,
      fileCount: documents.length,
      documentCount: documents.length,
      assetCount: assets.length,
      totalBytes,
      commitSha,
      revision: pinnedRef,
      unresolvedReferences,
    },
  };
}

async function fetchRemoteBundles(remoteConfigs, options) {
  const out = [];
  for (const config of remoteConfigs || []) {
    const provider = String((config && config.provider) || "github");
    if (provider !== "github") {
      throw new Error(`Unsupported remote bundle provider: ${provider}`);
    }
    out.push(await fetchGitHubBundle(config, options));
  }
  return out;
}

module.exports = {
  DEFAULT_REMOTE_LIMITS,
  fetchGitHubBundle,
  fetchRemoteBundles,
  parseGitHubBundleUrl,
  sanitizeRemoteId,
};
