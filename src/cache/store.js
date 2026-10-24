"use strict";

// Vector cache outside the bundle (docs/plan-1.0.md R-9, O-3, S-1, S-2).
// Vectors are derived data: the Markdown files stay the source of truth, so
// the cache can be deleted at any moment and is rebuilt from the content
// hashes of the units. It lives under the user's cache directory, never in the
// bundle, because an untracked file in the worktree blocks git-backed apply.
//
// Layout of a cache directory:
//
//   manifest.json  { format, formatVersion, embedderId, dimension, count, updatedAt }
//   units.json     [{ id, hash }] in row order; hash = sha256 of the unit text
//   vectors.f32    little-endian float32, row-major, count x dimension
//
// Rows are keyed by hash: a second unit with identical text shares the row.
// The manifest is written last and is the commit point; any inconsistency
// between the three files, a different embedder, dimension or format, or a
// missing directory opens an empty cache and reports why.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VECTOR_CACHE_FORMAT = "okf-vector-cache";
const VECTOR_CACHE_FORMAT_VERSION = 1;
const MANIFEST_FILE = "manifest.json";
const UNITS_FILE = "units.json";
const VECTORS_FILE = "vectors.f32";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_DIMENSION = 65536;
const MIN_CAPACITY_ROWS = 64;

class VectorCacheError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "VectorCacheError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function isInside(root, target, platformPath) {
  const relative = platformPath.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !platformPath.isAbsolute(relative));
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
// ~/.cache on POSIX and %LOCALAPPDATA% on Windows. The derived location is
// refused when it would land inside the root (R-9, B-5). `env`, `platform`
// and `homedir` exist for tests.
function resolveCacheDir(options) {
  const config = options || {};
  const platform = config.platform || process.platform;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const env = config.env || process.env;
  const homedir = config.homedir || os.homedir;
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
    const base = config.root ? platformPath.resolve(config.root) : process.cwd();
    return assertSafeCachePath(platformPath.resolve(base, cacheDir), platformPath);
  }
  if (typeof config.root !== "string" || !config.root.trim()) {
    throw new VectorCacheError(
      "A bundle or project root is required to derive the cache location.",
      "cache_root_required",
    );
  }
  const realRoot = realpathOrResolve(config.root);
  const base = defaultCacheBase(env, platform, homedir, platformPath);
  const digest = crypto.createHash("sha256").update(realRoot, "utf8").digest("hex");
  const dir = assertSafeCachePath(platformPath.join(base, "okf-mcp", digest), platformPath);
  if (isInside(realRoot, dir, platformPath)) {
    throw new VectorCacheError(
      "The default cache location falls inside the bundle root; set cacheDir explicitly.",
      "cache_inside_root",
    );
  }
  return dir;
}

function writeAtomic(target, content) {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Returns the bytes of a regular file inside the cache directory, or null
// when it is missing or is anything other than a regular file (a symbolic
// link is never followed, S-1).
function readRegularFile(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  return fs.readFileSync(target);
}

function littleEndian(buffer) {
  if (os.endianness() === "LE") return buffer;
  const swapped = Buffer.from(buffer);
  swapped.swap32();
  return swapped;
}

function parseManifest(buffer, embedderId, dimension) {
  if (!buffer) return { reason: "manifest_missing" };
  let manifest;
  try {
    manifest = JSON.parse(buffer.toString("utf8"));
  } catch {
    return { reason: "manifest_corrupt" };
  }
  if (!manifest || typeof manifest !== "object" || !Number.isSafeInteger(manifest.count)) {
    return { reason: "manifest_corrupt" };
  }
  if (
    manifest.format !== VECTOR_CACHE_FORMAT ||
    manifest.formatVersion !== VECTOR_CACHE_FORMAT_VERSION
  ) {
    return { reason: "format_mismatch" };
  }
  if (manifest.embedderId !== embedderId) return { reason: "embedder_mismatch" };
  if (manifest.dimension !== dimension) return { reason: "dimension_mismatch" };
  if (manifest.count < 0) return { reason: "manifest_corrupt" };
  return { manifest };
}

function parseUnits(buffer, count) {
  if (!buffer) return null;
  let rows;
  try {
    rows = JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length !== count) return null;
  const seen = new Set();
  const parsed = [];
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.hash !== "string" ||
      !HASH_PATTERN.test(row.hash) ||
      seen.has(row.hash)
    ) {
      return null;
    }
    seen.add(row.hash);
    parsed.push({ id: row.id, hash: row.hash });
  }
  return parsed;
}

function toVector(value, dimension) {
  const source = value instanceof Float32Array ? value : Array.isArray(value) ? value : null;
  if (!source || source.length !== dimension) return null;
  const vector = new Float32Array(dimension);
  for (let index = 0; index < dimension; index += 1) {
    const entry = source[index];
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
    vector[index] = entry;
  }
  return vector;
}

class VectorCache {
  constructor(dir, embedderId, dimension) {
    this.dir = dir;
    this.embedderId = embedderId;
    this.dimension = dimension;
    this.rows = [];
    this.byHash = new Map();
    this.data = new Float32Array(0);
    this.opened = null;
  }

  get size() {
    return this.rows.length;
  }

  load() {
    let directory;
    try {
      directory = fs.lstatSync(this.dir);
    } catch {
      this.opened = { rebuilt: true, reason: "missing", rows: 0 };
      return this.opened;
    }
    if (directory.isSymbolicLink()) directory = fs.statSync(this.dir);
    if (!directory.isDirectory()) {
      throw new VectorCacheError("Cache directory path is not a directory.", "invalid_cache_dir");
    }
    let outcome;
    try {
      outcome = this.readFiles();
    } catch {
      outcome = { reason: "unreadable" };
    }
    if (outcome.reason) {
      this.opened = { rebuilt: true, reason: outcome.reason, rows: 0 };
      return this.opened;
    }
    this.rows = outcome.rows;
    this.data = outcome.data;
    this.byHash = new Map(this.rows.map((row, index) => [row.hash, index]));
    this.opened = { rebuilt: false, reason: null, rows: this.rows.length };
    return this.opened;
  }

  readFiles() {
    const parsed = parseManifest(
      readRegularFile(path.join(this.dir, MANIFEST_FILE)),
      this.embedderId,
      this.dimension,
    );
    if (parsed.reason) return parsed;
    const count = parsed.manifest.count;
    const rows = parseUnits(readRegularFile(path.join(this.dir, UNITS_FILE)), count);
    if (!rows) return { reason: "units_corrupt" };
    const bytes = readRegularFile(path.join(this.dir, VECTORS_FILE));
    if (!bytes || bytes.byteLength !== count * this.dimension * 4) {
      return { reason: "vectors_corrupt" };
    }
    const data = new Float32Array(Math.max(count, MIN_CAPACITY_ROWS) * this.dimension);
    new Uint8Array(data.buffer, 0, bytes.byteLength).set(littleEndian(bytes));
    return { rows, data };
  }

  has(hash) {
    return this.byHash.has(hash);
  }

  // A read-only view into the store, valid as a snapshot until the same hash
  // is written again.
  get(hash) {
    const row = this.byHash.get(hash);
    if (row === undefined) return null;
    return this.data.subarray(row * this.dimension, (row + 1) * this.dimension);
  }

  all() {
    return this.rows.map((row, index) => ({
      id: row.id,
      hash: row.hash,
      vector: this.data.subarray(index * this.dimension, (index + 1) * this.dimension),
    }));
  }

  ensureCapacity(additionalRows) {
    const needed = (this.rows.length + additionalRows) * this.dimension;
    if (needed <= this.data.length) return;
    const capacity = Math.max(needed, this.data.length * 2, MIN_CAPACITY_ROWS * this.dimension);
    const grown = new Float32Array(capacity);
    grown.set(this.data.subarray(0, this.rows.length * this.dimension));
    this.data = grown;
  }

  // Validates every entry before touching memory, then upserts by hash and
  // persists. Returns how many rows were added and how many replaced.
  putMany(entries) {
    if (!Array.isArray(entries)) {
      throw new VectorCacheError("putMany expects an array of entries.", "invalid_cache_entry");
    }
    const prepared = entries.map((entry, position) => {
      const vector = entry ? toVector(entry.vector, this.dimension) : null;
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !entry.id ||
        typeof entry.hash !== "string" ||
        !HASH_PATTERN.test(entry.hash) ||
        !vector
      ) {
        throw new VectorCacheError(
          `Cache entry ${position} must carry an id, a sha256 hash and a vector of ${this.dimension} finite numbers.`,
          "invalid_cache_entry",
          { position },
        );
      }
      return { id: entry.id, hash: entry.hash, vector };
    });
    const result = { added: 0, replaced: 0 };
    if (prepared.length === 0) return result;
    this.ensureCapacity(prepared.length);
    for (const entry of prepared) {
      let row = this.byHash.get(entry.hash);
      if (row === undefined) {
        row = this.rows.length;
        this.rows.push({ id: entry.id, hash: entry.hash });
        this.byHash.set(entry.hash, row);
        result.added += 1;
      } else {
        this.rows[row] = { id: entry.id, hash: entry.hash };
        result.replaced += 1;
      }
      this.data.set(entry.vector, row * this.dimension);
    }
    this.flush();
    return result;
  }

  // Drops every row whose hash is not in keepHashes and returns how many went.
  prune(keepHashes) {
    const keep = keepHashes instanceof Set ? keepHashes : new Set(keepHashes || []);
    const survivors = [];
    for (let index = 0; index < this.rows.length; index += 1) {
      if (keep.has(this.rows[index].hash)) survivors.push(index);
    }
    const removed = this.rows.length - survivors.length;
    if (removed === 0) return 0;
    const compacted = new Float32Array(
      Math.max(survivors.length, MIN_CAPACITY_ROWS) * this.dimension,
    );
    const rows = [];
    survivors.forEach((source, target) => {
      compacted.set(
        this.data.subarray(source * this.dimension, (source + 1) * this.dimension),
        target * this.dimension,
      );
      rows.push(this.rows[source]);
    });
    this.rows = rows;
    this.data = compacted;
    this.byHash = new Map(rows.map((row, index) => [row.hash, index]));
    this.flush();
    return removed;
  }

  // Rewrites the three files atomically, manifest last. Recreates the
  // directory when it was deleted underneath a running process.
  flush() {
    fs.mkdirSync(this.dir, { recursive: true });
    const count = this.rows.length;
    const bytes = Buffer.from(this.data.buffer, this.data.byteOffset, count * this.dimension * 4);
    writeAtomic(path.join(this.dir, VECTORS_FILE), littleEndian(bytes));
    writeAtomic(path.join(this.dir, UNITS_FILE), `${JSON.stringify(this.rows)}\n`);
    const manifest = {
      format: VECTOR_CACHE_FORMAT,
      formatVersion: VECTOR_CACHE_FORMAT_VERSION,
      embedderId: this.embedderId,
      dimension: this.dimension,
      count,
      updatedAt: new Date().toISOString(),
    };
    writeAtomic(path.join(this.dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

function openVectorCache(dir, options) {
  const config = options || {};
  const resolvedDir = assertSafeCachePath(dir, path);
  const { embedderId, dimension } = config;
  if (
    typeof embedderId !== "string" ||
    !embedderId.trim() ||
    embedderId.length > 256 ||
    /[\s\p{Cc}]/u.test(embedderId)
  ) {
    throw new VectorCacheError(
      "Vector cache requires the embedder id as a single token.",
      "invalid_cache_options",
      { field: "embedderId" },
    );
  }
  if (!Number.isSafeInteger(dimension) || dimension <= 0 || dimension > MAX_DIMENSION) {
    throw new VectorCacheError(
      "Vector cache requires a positive integer dimension.",
      "invalid_cache_options",
      { field: "dimension" },
    );
  }
  const cache = new VectorCache(resolvedDir, embedderId, dimension);
  cache.load();
  return cache;
}

module.exports = {
  VECTOR_CACHE_FORMAT,
  VECTOR_CACHE_FORMAT_VERSION,
  VectorCache,
  VectorCacheError,
  openVectorCache,
  resolveCacheDir,
};
