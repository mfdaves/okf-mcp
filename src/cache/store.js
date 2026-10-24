"use strict";

// Vector cache outside the bundle (docs/plan-1.0.md R-9, O-3, S-1, S-2).
// Vectors are derived data: the Markdown files stay the source of truth, so
// the cache can be deleted at any moment and is rebuilt from the content
// hashes of the units. Where it may live is decided in ./paths.js.
//
// Layout of a cache directory:
//
//   manifest.json            { format, formatVersion, embedderId, dimension, count,
//                              generation, files: { units, vectors },
//                              digests: { units, vectors }, updatedAt }
//   units.<generation>.json  [{ id, hash }] in row order; hash = sha256 of the unit text
//   vectors.<generation>.f32 little-endian float32, row-major, count x dimension
//   lock                     { pid, createdAt, generation } while a write is in progress
//
// Rows are keyed by hash: a second unit with identical text shares the row.
// Every write holds the advisory lock, produces a new generation of the two
// data files and then replaces the manifest atomically, so a reader never
// sees rows of one generation paired with vectors of another; the manifest's
// SHA-256 digests are verified on open. A reader loads its generation into
// memory once and never goes back to the files by name. Garbage collection
// after a successful write removes the generations this process wrote
// before, and foreign generations only once they are older than a grace
// period and named by no lock. A different embedder, dimension or format, a
// corrupt or tampered file, or a missing directory opens an empty cache and
// reports why.
//
// Containment is re-checked before every write: the directory must still
// resolve to the real path recorded at open and stay outside the root, so an
// ancestor link created later cannot redirect a write. Every cache file is
// opened with O_NOFOLLOW and checked through its own descriptor, so a link
// swapped in later fails closed (S-1).

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  VectorCacheError,
  assertNotSymlink,
  assertSafeCachePath,
  isInside,
  realCacheDir,
  realpathOfExistingAncestors,
  realpathOrResolve,
  resolveCacheDir,
} = require("./paths");

const VECTOR_CACHE_FORMAT = "okf-vector-cache";
const VECTOR_CACHE_FORMAT_VERSION = 1;
const MANIFEST_FILE = "manifest.json";
const LOCK_FILE = "lock";
const GENERATION_PATTERN = /^[0-9a-z]{1,16}-[0-9a-f]{8}$/;
const GENERATION_FILE = /^(units|vectors)\.([0-9a-z]{1,16}-[0-9a-f]{8})\.(json|f32)$/;
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_WAIT_MS = 2000;
const LOCK_POLL_MS = 25;
const GC_GRACE_MS = 15 * 60 * 1000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_DIMENSION = 65536;
const MIN_CAPACITY_ROWS = 64;
// Absent on Windows, where lstat before open remains the only guard.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

function writeAll(fd, content) {
  let offset = 0;
  while (offset < content.length) {
    offset += fs.writeSync(fd, content, offset, content.length - offset);
  }
}

// Creates the file through a descriptor that never follows a link, writes
// and syncs it, then renames it over the target. Rename replaces whatever
// the target is, a link included, without following it.
function writeAtomic(target, content) {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
      0o600,
    );
    writeAll(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, target);
  } finally {
    if (fd !== null) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Returns the bytes of a regular file inside the cache directory, or null
// when it is missing or is anything other than a regular file. The file is
// opened with O_NOFOLLOW and checked through its own descriptor, so a link
// swapped in between two steps cannot redirect the read (S-1).
function readRegularFile(target) {
  let fd;
  try {
    if (fs.lstatSync(target).isSymbolicLink()) return null;
    fd = fs.openSync(target, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return null;
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function littleEndian(buffer) {
  if (os.endianness() === "LE") return buffer;
  const swapped = Buffer.from(buffer);
  swapped.swap32();
  return swapped;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function newGeneration() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function mtimeBefore(target, cutoff) {
  try {
    return fs.lstatSync(target).mtimeMs < cutoff;
  } catch {
    return false;
  }
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
  const { generation, files, digests } = manifest;
  if (
    manifest.count < 0 ||
    typeof generation !== "string" ||
    !GENERATION_PATTERN.test(generation) ||
    !files ||
    files.units !== `units.${generation}.json` ||
    files.vectors !== `vectors.${generation}.f32` ||
    !digests ||
    !HASH_PATTERN.test(String(digests.units)) ||
    !HASH_PATTERN.test(String(digests.vectors))
  ) {
    return { reason: "manifest_corrupt" };
  }
  return { manifest };
}

function parseUnits(buffer, count) {
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

// Reads a lock file; returns { pid, generation, ageMs } or null when absent.
// An unreadable or unparsable lock is aged by its mtime.
function readLock(lockPath) {
  let stat;
  try {
    stat = fs.lstatSync(lockPath);
  } catch {
    return null;
  }
  let parsed = null;
  const bytes = stat.isFile() ? readRegularFile(lockPath) : null;
  if (bytes) {
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      parsed = null;
    }
  }
  const createdAt =
    parsed && typeof parsed.createdAt === "string" ? Date.parse(parsed.createdAt) : Number.NaN;
  const since = Number.isFinite(createdAt) ? createdAt : stat.mtimeMs;
  return {
    pid: parsed && Number.isSafeInteger(parsed.pid) ? parsed.pid : null,
    generation:
      parsed && typeof parsed.generation === "string" && GENERATION_PATTERN.test(parsed.generation)
        ? parsed.generation
        : null,
    ageMs: Math.max(0, Date.now() - since),
  };
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
  constructor(dir, embedderId, dimension, options) {
    const config = options || {};
    this.dir = dir;
    this.embedderId = embedderId;
    this.dimension = dimension;
    this.realRoot = config.realRoot || null;
    this.allowInsideRoot = config.allowInsideRoot === true;
    this.lockWaitMs = Number.isSafeInteger(config.lockWaitMs) ? config.lockWaitMs : LOCK_WAIT_MS;
    this.generation = null;
    this.ownGenerations = new Set();
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
    if (directory.isSymbolicLink()) {
      throw new VectorCacheError(
        "Cache directory must not be a symbolic link.",
        "invalid_cache_dir",
      );
    }
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
    this.generation = outcome.generation;
    this.byHash = new Map(this.rows.map((row, index) => [row.hash, index]));
    this.opened = { rebuilt: false, reason: null, rows: this.rows.length };
    return this.opened;
  }

  // Everything a reader needs is in memory after this; the files are never
  // consulted again by name, so a later commit by another process cannot
  // pull a generation out from under an open store.
  readFiles() {
    const parsed = parseManifest(
      readRegularFile(path.join(this.dir, MANIFEST_FILE)),
      this.embedderId,
      this.dimension,
    );
    if (parsed.reason) return parsed;
    const { manifest } = parsed;
    const count = manifest.count;
    const unitBytes = readRegularFile(path.join(this.dir, manifest.files.units));
    if (!unitBytes) return { reason: "units_corrupt" };
    if (sha256Hex(unitBytes) !== manifest.digests.units) return { reason: "integrity_mismatch" };
    const rows = parseUnits(unitBytes, count);
    if (!rows) return { reason: "units_corrupt" };
    const bytes = readRegularFile(path.join(this.dir, manifest.files.vectors));
    if (!bytes) return { reason: "vectors_corrupt" };
    if (sha256Hex(bytes) !== manifest.digests.vectors) return { reason: "integrity_mismatch" };
    if (bytes.byteLength !== count * this.dimension * 4) return { reason: "vectors_corrupt" };
    const data = new Float32Array(Math.max(count, MIN_CAPACITY_ROWS) * this.dimension);
    new Uint8Array(data.buffer, 0, bytes.byteLength).set(littleEndian(bytes));
    return { rows, data, generation: manifest.generation };
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

  // The directory must still be the one opened: same real path for its
  // ancestors, not a link itself, and outside the root. An ancestor link
  // created after open would otherwise redirect the write.
  ensureWritableDirectory() {
    const moved = new VectorCacheError(
      "Cache directory no longer resolves to the location it was opened at.",
      "invalid_cache_dir",
    );
    assertNotSymlink(this.dir);
    if (realpathOfExistingAncestors(this.dir) !== this.dir) throw moved;
    fs.mkdirSync(this.dir, { recursive: true });
    assertNotSymlink(this.dir);
    const actual = fs.realpathSync(this.dir);
    if (actual !== this.dir) throw moved;
    if (this.realRoot && !this.allowInsideRoot && isInside(this.realRoot, actual, path)) {
      throw new VectorCacheError(
        "Cache directory resolves inside the bundle root.",
        "cache_inside_root",
      );
    }
  }

  // Advisory lock for one whole write. A live lock held elsewhere is waited
  // for briefly and then reported; a lock older than LOCK_STALE_MS belongs
  // to a process that is gone and is taken over.
  acquireLock(generation) {
    const lockPath = path.join(this.dir, LOCK_FILE);
    const deadline = Date.now() + this.lockWaitMs;
    for (;;) {
      let fd = null;
      try {
        fd = fs.openSync(
          lockPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
          0o600,
        );
        const claim = { pid: process.pid, createdAt: new Date().toISOString(), generation };
        writeAll(fd, Buffer.from(JSON.stringify(claim)));
        return lockPath;
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw new VectorCacheError(
            "The vector cache could not be locked for writing.",
            "cache_write_failed",
            { cause: typeof error?.code === "string" ? error.code : "unknown" },
          );
        }
      } finally {
        if (fd !== null) fs.closeSync(fd);
      }
      const holder = readLock(lockPath);
      if (!holder || holder.ageMs > LOCK_STALE_MS) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Another process may have removed it first; the next attempt tells.
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new VectorCacheError(
          "The vector cache is being written by another process.",
          "cache_locked",
          { pid: holder.pid, ageMs: holder.ageMs },
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  }

  // Seam for tests that inject write failures; production never replaces it.
  writeFile(target, content) {
    writeAtomic(target, content);
  }

  // Writes a new generation of the data files under the lock, then replaces
  // the manifest atomically as the commit point, then collects garbage.
  // Recreates the directory when it was deleted underneath a running process.
  flush() {
    this.ensureWritableDirectory();
    const generation = newGeneration();
    const lockPath = this.acquireLock(generation);
    try {
      this.ownGenerations.add(generation);
      const count = this.rows.length;
      const files = { units: `units.${generation}.json`, vectors: `vectors.${generation}.f32` };
      const unitBytes = Buffer.from(`${JSON.stringify(this.rows)}\n`, "utf8");
      const vectorBytes = littleEndian(
        Buffer.from(this.data.buffer, this.data.byteOffset, count * this.dimension * 4),
      );
      this.writeFile(path.join(this.dir, files.units), unitBytes);
      this.writeFile(path.join(this.dir, files.vectors), vectorBytes);
      const manifest = {
        format: VECTOR_CACHE_FORMAT,
        formatVersion: VECTOR_CACHE_FORMAT_VERSION,
        embedderId: this.embedderId,
        dimension: this.dimension,
        count,
        generation,
        files,
        digests: { units: sha256Hex(unitBytes), vectors: sha256Hex(vectorBytes) },
        updatedAt: new Date().toISOString(),
      };
      this.writeFile(
        path.join(this.dir, MANIFEST_FILE),
        Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      );
      this.generation = generation;
      this.collectGarbage();
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // The lock may already be gone after a takeover; nothing to release.
      }
    }
  }

  // Generations this process wrote earlier go at once: nothing else can
  // reference them, and readers hold their rows in memory. Foreign
  // generations are another writer's possible work in progress and go only
  // once older than the grace period and named by no lock. Best effort; a
  // failure here never fails the write that just completed.
  collectGarbage() {
    let entries;
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      return;
    }
    const locked = readLock(path.join(this.dir, LOCK_FILE))?.generation || null;
    const cutoff = Date.now() - GC_GRACE_MS;
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const target = path.join(this.dir, entry.name);
      const match = GENERATION_FILE.exec(entry.name);
      let remove = false;
      if (match) {
        const generation = match[2];
        if (generation === this.generation || generation === locked) continue;
        remove = this.ownGenerations.has(generation) || mtimeBefore(target, cutoff);
      } else if (entry.name.endsWith(".tmp")) {
        remove = mtimeBefore(target, cutoff);
      }
      if (!remove) continue;
      try {
        fs.unlinkSync(target);
      } catch {
        // Another process may have removed it first; the next write retries.
      }
    }
  }
}

// options: embedderId, dimension (required); root (containment is checked at
// open and before every write), allowInsideRoot, lockWaitMs.
function openVectorCache(dir, options) {
  const config = options || {};
  const resolvedDir = realCacheDir(assertSafeCachePath(dir, path));
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
  const realRoot =
    typeof config.root === "string" && config.root.trim() ? realpathOrResolve(config.root) : null;
  if (realRoot && config.allowInsideRoot !== true && isInside(realRoot, resolvedDir, path)) {
    throw new VectorCacheError(
      "Cache directory resolves inside the bundle root.",
      "cache_inside_root",
    );
  }
  const cache = new VectorCache(resolvedDir, embedderId, dimension, {
    realRoot,
    allowInsideRoot: config.allowInsideRoot,
    lockWaitMs: config.lockWaitMs,
  });
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
