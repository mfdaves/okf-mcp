"use strict";

// Where the vector cache may live (docs/plan-1.0.md R-9, B-5, S-1).
//
// The directory is an absolute path without parent segments or reserved
// device names, never the filesystem root, and never inside the bundle root:
// an untracked file in the worktree blocks git-backed apply. Containment is
// judged on real paths, so a cache home that is a link into the root is
// caught. The directory itself must not be a symbolic link; its ancestors
// may be (a relocated ~/.cache is common) and are resolved first.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

class VectorCacheError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "VectorCacheError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// Segment-aware containment: "..cache" is inside, ".." and "../x" are not.
function isInside(root, target, platformPath) {
  const relative = platformPath.relative(root, target);
  if (relative === "") return true;
  if (platformPath.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${platformPath.sep}`);
}

function hasUnsafeSegment(value) {
  return String(value)
    .split(/[\\/]+/)
    .some((segment) => segment === ".." || WINDOWS_RESERVED.test(segment));
}

// The same rules bundle paths follow (S-1): a string without control
// characters, absolute once resolved, no parent segments, no reserved device
// names, and never the filesystem root itself.
function assertSafeCachePath(candidate, platformPath) {
  if (typeof candidate !== "string" || !candidate.trim() || /\p{Cc}/u.test(candidate)) {
    throw new VectorCacheError("Cache directory must be a safe path.", "invalid_cache_dir");
  }
  if (!platformPath.isAbsolute(candidate) || hasUnsafeSegment(candidate)) {
    throw new VectorCacheError(
      "Cache directory must be an absolute path without parent segments.",
      "invalid_cache_dir",
    );
  }
  const resolved = platformPath.resolve(candidate);
  if (platformPath.parse(resolved).root === resolved) {
    throw new VectorCacheError(
      "Cache directory must not be the filesystem root.",
      "invalid_cache_dir",
    );
  }
  return resolved;
}

function realpathOrResolve(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

// Real path of the deepest existing ancestor joined with the missing tail, so
// containment is judged on real locations before the directory exists.
function realpathOfExistingAncestors(target) {
  const missing = [];
  let current = target;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return missing.length ? path.join(real, ...missing) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

// The cache directory itself is never a symbolic link (its ancestors may be).
function assertNotSymlink(dir) {
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new VectorCacheError("Cache directory must not be a symbolic link.", "invalid_cache_dir");
  }
}

// Resolves the directory the way the store will use it: ancestors through
// their real paths, the directory itself checked not to be a link.
function realCacheDir(dir) {
  assertNotSymlink(dir);
  return path.join(realpathOfExistingAncestors(path.dirname(dir)), path.basename(dir));
}

function defaultCacheBase(env, platform, homedir, platformPath) {
  const xdg = env.XDG_CACHE_HOME;
  if (typeof xdg === "string" && xdg.trim() && platformPath.isAbsolute(xdg)) {
    return platformPath.resolve(xdg);
  }
  const home = typeof homedir === "function" ? homedir() : homedir;
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    if (typeof local === "string" && local.trim() && platformPath.isAbsolute(local)) {
      return platformPath.resolve(local);
    }
    if (home) return platformPath.join(home, "AppData", "Local");
  } else if (home) {
    return platformPath.join(home, ".cache");
  }
  throw new VectorCacheError(
    "No cache location is available; set cacheDir explicitly.",
    "cache_location_unavailable",
  );
}

// Explicit cacheDir (relative to root) wins; otherwise
// $XDG_CACHE_HOME/okf-mcp/<sha256(realpath root)>/, falling back to
// ~/.cache on POSIX and %LOCALAPPDATA% on Windows. Either location is
// refused inside the root (R-9, B-5) unless the caller passes
// allowInsideRoot: true for an explicit cacheDir and takes responsibility
// for ignoring it in Git. `env`, `platform` and `homedir` exist for tests.
function resolveCacheDir(options) {
  const config = options || {};
  const platform = config.platform || process.platform;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const hostPlatform = platform === process.platform;
  const env = config.env || process.env;
  const homedir = config.homedir || os.homedir;
  const hasRoot = typeof config.root === "string" && config.root.trim() !== "";
  const realRoot = hasRoot ? realpathOrResolve(config.root) : null;
  const realDirOf = (dir) => (hostPlatform ? realCacheDir(dir) : dir);
  if (config.cacheDir !== undefined && config.cacheDir !== null) {
    const cacheDir = config.cacheDir;
    if (
      typeof cacheDir !== "string" ||
      !cacheDir.trim() ||
      /\p{Cc}/u.test(cacheDir) ||
      hasUnsafeSegment(cacheDir)
    ) {
      throw new VectorCacheError("Cache directory must be a safe path.", "invalid_cache_dir");
    }
    const base = hasRoot ? platformPath.resolve(config.root) : process.cwd();
    const dir = realDirOf(assertSafeCachePath(platformPath.resolve(base, cacheDir), platformPath));
    if (realRoot && config.allowInsideRoot !== true && isInside(realRoot, dir, platformPath)) {
      throw new VectorCacheError(
        "The configured cacheDir falls inside the root, where it would dirty the worktree; move it or pass allowInsideRoot.",
        "cache_inside_root",
      );
    }
    return dir;
  }
  if (!hasRoot) {
    throw new VectorCacheError(
      "A bundle or project root is required to derive the cache location.",
      "cache_root_required",
    );
  }
  const base = defaultCacheBase(env, platform, homedir, platformPath);
  const digest = crypto.createHash("sha256").update(realRoot, "utf8").digest("hex");
  const dir = realDirOf(
    assertSafeCachePath(platformPath.join(base, "okf-mcp", digest), platformPath),
  );
  if (isInside(realRoot, dir, platformPath)) {
    throw new VectorCacheError(
      "The default cache location falls inside the bundle root; set cacheDir explicitly.",
      "cache_inside_root",
    );
  }
  return dir;
}

module.exports = {
  VectorCacheError,
  assertNotSymlink,
  assertSafeCachePath,
  isInside,
  realCacheDir,
  realpathOfExistingAncestors,
  realpathOrResolve,
  resolveCacheDir,
};
