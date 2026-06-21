"use strict";

const path = require("path");

const DEFAULT_REMOTE_LIMITS = {
  maxFiles: 500,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 5 * 1024 * 1024,
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
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
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

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "okf-mcp",
    },
  });
  if (!response || !response.ok) {
    const status = response ? `${response.status} ${response.statusText || ""}`.trim() : "no response";
    throw new Error(`GitHub raw file request failed: ${status}`);
  }
  return response.text();
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
  let totalBytes = 0;

  async function walk(apiPath) {
    const apiUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${encodePath(apiPath)}?ref=${encodeURIComponent(source.ref)}`;
    const entries = await fetchJson(fetchImpl, apiUrl);
    const list = Array.isArray(entries) ? entries : [entries];
    for (const entry of list) {
      if (entry.type === "dir") {
        await walk(entry.path);
        continue;
      }
      if (entry.type !== "file" || !String(entry.name || "").toLowerCase().endsWith(".md")) {
        continue;
      }
      if (documents.length >= limits.maxFiles) {
        throw new Error(`Remote bundle exceeds file limit of ${limits.maxFiles}.`);
      }
      if (Number(entry.size || 0) > limits.maxFileBytes) {
        throw new Error(`Remote file exceeds byte limit: ${entry.path}`);
      }
      if (!entry.download_url) {
        throw new Error(`Remote file has no download URL: ${entry.path}`);
      }
      const text = await fetchText(fetchImpl, entry.download_url);
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > limits.maxFileBytes) {
        throw new Error(`Remote file exceeds byte limit after download: ${entry.path}`);
      }
      totalBytes += bytes;
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error(`Remote bundle exceeds total byte limit of ${limits.maxTotalBytes}.`);
      }
      documents.push({
        path: relativeRemotePath(source.path, entry.path),
        text,
        source: `github://${source.owner}/${source.repo}/${source.ref}/${entry.path}`,
      });
    }
  }

  await walk(source.path);
  return {
    id: sanitizeRemoteId(config.id, path.posix.basename(source.path)),
    remote: true,
    root: "",
    documents,
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
      totalBytes,
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
