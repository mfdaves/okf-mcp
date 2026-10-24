"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeSlashes } = require("../parser");

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

// The absolute path of a bundle document in the form walkMarkdown reports it,
// so a document added without a walk sorts and compares like a walked one.
function documentAbsolutePath(bundle, relativePath) {
  return path.join(bundle.root, ...normalizeSlashes(relativePath).split("/"));
}

// Size and mtime of a regular file at nanosecond precision, or null when
// there is no such file. A refresh compares these to tell a changed file
// from an unchanged one without reading it.
function fileStat(absolutePath) {
  try {
    const stat = fs.statSync(absolutePath, { bigint: true });
    return stat.isFile() ? { size: Number(stat.size), mtimeNs: stat.mtimeNs } : null;
  } catch {
    return null;
  }
}

function sameStat(left, right) {
  if (!left || !right) {
    return left === right;
  }
  return left.size === right.size && left.mtimeNs === right.mtimeNs;
}

module.exports = {
  bundleAllowsPath,
  bundleExcludesPath,
  documentAbsolutePath,
  documentOverrideKey,
  fileStat,
  sameStat,
  parseBundleArg,
  sanitizeBundleId,
  uniqueBundleIds,
  walkMarkdown,
};
