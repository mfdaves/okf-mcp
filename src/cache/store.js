"use strict";

// Vector cache outside the bundle (docs/plan-1.0.md R-9, O-3, S-1, S-2).
// Vectors are derived data: the Markdown files stay the source of truth, so
// the cache can be deleted at any moment and is rebuilt from the content
// hashes of the units. Where it may live is decided in ./paths.js, the lock
// protocol in ./lock.js, the file primitives in ./files.js.
//
// Layout of a cache directory:
//
//   manifest.json            { format, formatVersion, embedderId, dimension, count,
//                              generation, files: { units, vectors },
//                              digests: { units, vectors },
//                              retired: [{ generation, retiredAt }], updatedAt }
//   units.<generation>.json  [{ id, hash }] in row order; hash = sha256 of the unit text
//   vectors.<generation>.f32 little-endian float32, row-major, count x dimension
//   lock                     { token, pid, createdAt, generation } during a write
//
// Rows are keyed by hash: a second unit with identical text shares the row.
// Every write holds the lock, produces a new generation of the two data files
// and then replaces the manifest atomically, so a reader never sees rows of
// one generation paired with vectors of another; the manifest's SHA-256
// digests and the finiteness of every stored value are verified on open. A
// reader loads its generation into memory once and never goes back to the
// files by name. The manifest records when each superseded generation was
// retired; garbage collection after a committed write removes at once the
// generations this process wrote earlier, retired foreign generations once
// their retirement is older than the grace period, and never-committed
// orphans once their files are. A different embedder, dimension or format, a
// corrupt or tampered file, or a missing directory opens an empty cache and
// reports why.
//
// The directory is re-verified (real path unchanged since open, not a link,
// outside the root) before the lock is attempted, after it is held, and
// before each group of writes, renames and unlinks; Node has no openat, so
// this narrows the window on every platform and cannot close it entirely.
// Writes of one store instance are serialised; across processes the lock
// serialises them, and a crashed writer blocks others until lockStaleMs.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { mtimeBefore, readRegularFile, writeAtomic } = require("./files");
const {
  GENERATION_PATTERN,
  LOCK_FILE,
  acquireLock,
  newLockToken,
  readLock,
  releaseLock,
} = require("./lock");
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
const GENERATION_FILE = /^(units|vectors)\.([0-9a-z]{1,16}-[0-9a-f]{8})\.(json|f32)$/;
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_WAIT_MS = 2000;
const GC_GRACE_MS = 15 * 60 * 1000;
// The retired list keeps every entry younger than the grace period; the cap
// applies only to entries past it, which are collectable anyway. The parse
// bound guards against a pathological manifest, not against young entries.
const MAX_RETIRED = 64;
const MAX_RETIRED_PARSE = 4096;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_DIMENSION = 65536;
const MIN_CAPACITY_ROWS = 64;

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

function parseRetired(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry) =>
        entry &&
        typeof entry.generation === "string" &&
        GENERATION_PATTERN.test(entry.generation) &&
        typeof entry.retiredAt === "string" &&
        Number.isFinite(Date.parse(entry.retiredAt)),
    )
    .map((entry) => ({ generation: entry.generation, retiredAt: entry.retiredAt }))
    .slice(-MAX_RETIRED_PARSE);
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
  return { manifest: { ...manifest, retired: parseRetired(manifest.retired) } };
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

// A vector must have the store's dimension and every value must still be a
// finite number once stored as float32 (1e100 becomes Infinity).
function toVector(value, dimension) {
  const source = value instanceof Float32Array ? value : Array.isArray(value) ? value : null;
  if (!source) return { reason: "not_a_vector" };
  if (source.length !== dimension) return { reason: "wrong_length" };
  const vector = new Float32Array(dimension);
  for (let index = 0; index < dimension; index += 1) {
    const entry = source[index];
    if (typeof entry !== "number" || !Number.isFinite(entry)) return { reason: "not_finite" };
    vector[index] = entry;
    if (!Number.isFinite(vector[index])) return { reason: "not_finite_as_float32" };
  }
  return { vector };
}

function allFinite(data, length) {
  for (let index = 0; index < length; index += 1) {
    if (!Number.isFinite(data[index])) return false;
  }
  return true;
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
    this.lockStaleMs = Number.isSafeInteger(config.lockStaleMs)
      ? config.lockStaleMs
      : LOCK_STALE_MS;
    this.generation = null;
    this.ownGenerations = new Set();
    this.rows = [];
    this.byHash = new Map();
    this.data = new Float32Array(0);
    this.opened = null;
    this.writeQueue = Promise.resolve();
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
    if (!allFinite(data, count * this.dimension)) return { reason: "vectors_corrupt" };
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
  // persists. Resolves to how many rows were added and how many replaced.
  async putMany(entries) {
    if (!Array.isArray(entries)) {
      throw new VectorCacheError("putMany expects an array of entries.", "invalid_cache_entry");
    }
    const prepared = entries.map((entry, position) => {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !entry.id ||
        typeof entry.hash !== "string" ||
        !HASH_PATTERN.test(entry.hash)
      ) {
        throw new VectorCacheError(
          `Cache entry ${position} must carry an id and a sha256 hash.`,
          "invalid_cache_entry",
          { position },
        );
      }
      const converted = toVector(entry.vector, this.dimension);
      if (!converted.vector) {
        throw new VectorCacheError(
          `Cache entry ${position} must carry a vector of ${this.dimension} finite float32 values.`,
          "invalid_vector",
          { position, reason: converted.reason },
        );
      }
      return { id: entry.id, hash: entry.hash, vector: converted.vector };
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
    await this.flush();
    return result;
  }

  // Drops every row whose hash is not in keepHashes; resolves to how many went.
  async prune(keepHashes) {
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
    await this.flush();
    return removed;
  }

  // The directory must still be the one opened: real path unchanged, not a
  // link, outside the root. Cheap enough to run before every operation group.
  verifyLocation() {
    const moved = new VectorCacheError(
      "Cache directory no longer resolves to the location it was opened at.",
      "invalid_cache_dir",
    );
    assertNotSymlink(this.dir);
    let actual;
    try {
      actual = fs.realpathSync(this.dir);
    } catch {
      throw moved;
    }
    if (actual !== this.dir) throw moved;
    if (this.realRoot && !this.allowInsideRoot && isInside(this.realRoot, actual, path)) {
      throw new VectorCacheError(
        "Cache directory resolves inside the bundle root.",
        "cache_inside_root",
      );
    }
  }

  locationIntact() {
    try {
      this.verifyLocation();
      return true;
    } catch {
      return false;
    }
  }

  // Recreates the directory when it was deleted underneath a running process,
  // after checking that its ancestors still lead where they did at open.
  ensureWritableDirectory() {
    assertNotSymlink(this.dir);
    if (realpathOfExistingAncestors(this.dir) !== this.dir) {
      throw new VectorCacheError(
        "Cache directory no longer resolves to the location it was opened at.",
        "invalid_cache_dir",
      );
    }
    fs.mkdirSync(this.dir, { recursive: true });
    this.verifyLocation();
  }

  // Seams for tests that inject failures; production never replaces them.
  writeFile(target, content) {
    writeAtomic(target, content);
  }

  removeFile(target) {
    fs.unlinkSync(target);
  }

  renameFile(from, to) {
    fs.renameSync(from, to);
  }

  linkFile(from, to) {
    fs.linkSync(from, to);
  }

  // Every mutation of the directory goes through these: each verifies the
  // location first, so no call site can skip the check.
  guardedWrite(target, content) {
    this.verifyLocation();
    return this.writeFile(target, content);
  }

  guardedRemove(target) {
    this.verifyLocation();
    this.removeFile(target);
  }

  guardedRename(from, to) {
    this.verifyLocation();
    this.renameFile(from, to);
  }

  guardedLink(from, to) {
    this.verifyLocation();
    this.linkFile(from, to);
  }

  hasGenerationFiles(entry) {
    return (
      fs.existsSync(path.join(this.dir, `units.${entry.generation}.json`)) ||
      fs.existsSync(path.join(this.dir, `vectors.${entry.generation}.f32`))
    );
  }

  // The committed manifest as it is on disk right now, read under the lock,
  // so retirement is recorded for whatever generation this write supersedes.
  committedState() {
    const parsed = parseManifest(
      readRegularFile(path.join(this.dir, MANIFEST_FILE)),
      this.embedderId,
      this.dimension,
    );
    if (parsed.reason) return { generation: null, retired: [] };
    return { generation: parsed.manifest.generation, retired: parsed.manifest.retired };
  }

  // Writes of one instance run one after another.
  flush() {
    const run = this.writeQueue.then(() => this.flushNow());
    this.writeQueue = run.catch(() => {});
    return run;
  }

  // Writes a new generation of the data files under the lock, replaces the
  // manifest atomically as the commit point, then collects garbage.
  async flushNow() {
    this.ensureWritableDirectory();
    const generation = newGeneration();
    const token = newLockToken();
    const io = {
      verify: () => this.verifyLocation(),
      rename: (from, to) => this.guardedRename(from, to),
      remove: (target) => this.guardedRemove(target),
      link: (from, to) => this.guardedLink(from, to),
    };
    const lockPath = await acquireLock(this.dir, {
      token,
      generation,
      waitMs: this.lockWaitMs,
      staleMs: this.lockStaleMs,
      io,
    });
    try {
      this.verifyLocation();
      this.ownGenerations.add(generation);
      const previous = this.committedState();
      const now = new Date().toISOString();
      const cutoff = Date.now() - GC_GRACE_MS;
      const kept = previous.retired.filter(
        (entry) => entry.generation !== generation && this.hasGenerationFiles(entry),
      );
      // Entries younger than the grace period are never forgotten; the cap
      // applies to entries past it, and a forgotten entry's files are
      // collected in this same step.
      const past = kept.filter((entry) => Date.parse(entry.retiredAt) < cutoff);
      const forgotten = past.slice(0, Math.max(0, past.length - MAX_RETIRED));
      const retired = past
        .slice(forgotten.length)
        .concat(kept.filter((entry) => Date.parse(entry.retiredAt) >= cutoff))
        .concat(
          // An own generation is collected right after this commit, so only
          // a foreign one is worth recording.
          previous.generation &&
            previous.generation !== generation &&
            !this.ownGenerations.has(previous.generation)
            ? [{ generation: previous.generation, retiredAt: now }]
            : [],
        );
      const count = this.rows.length;
      const files = { units: `units.${generation}.json`, vectors: `vectors.${generation}.f32` };
      const unitBytes = Buffer.from(`${JSON.stringify(this.rows)}\n`, "utf8");
      const vectorBytes = littleEndian(
        Buffer.from(this.data.buffer, this.data.byteOffset, count * this.dimension * 4),
      );
      await this.guardedWrite(path.join(this.dir, files.units), unitBytes);
      await this.guardedWrite(path.join(this.dir, files.vectors), vectorBytes);
      const manifest = {
        format: VECTOR_CACHE_FORMAT,
        formatVersion: VECTOR_CACHE_FORMAT_VERSION,
        embedderId: this.embedderId,
        dimension: this.dimension,
        count,
        generation,
        files,
        digests: { units: sha256Hex(unitBytes), vectors: sha256Hex(vectorBytes) },
        retired,
        updatedAt: now,
      };
      await this.guardedWrite(
        path.join(this.dir, MANIFEST_FILE),
        Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      );
      this.generation = generation;
      this.collectGarbage(retired.concat(forgotten));
    } finally {
      releaseLock(lockPath, token, io);
    }
  }

  // Generations this process wrote earlier go at once: nothing else can
  // reference them, and readers hold their rows in memory. A retired foreign
  // generation goes once its retirement is older than the grace period; a
  // never-committed orphan, a stale temporary file or a parked stale lock
  // once its files are. Best effort: a failure here never fails the write
  // that just completed, and a directory that no longer verifies stops the
  // collection before anything is unlinked.
  collectGarbage(retired) {
    let entries;
    try {
      this.verifyLocation();
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      return;
    }
    const locked = readLock(path.join(this.dir, LOCK_FILE))?.generation || null;
    const cutoff = Date.now() - GC_GRACE_MS;
    const retiredAt = new Map(
      retired.map((entry) => [entry.generation, Date.parse(entry.retiredAt)]),
    );
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const target = path.join(this.dir, entry.name);
      const match = GENERATION_FILE.exec(entry.name);
      let remove = false;
      if (match) {
        const generation = match[2];
        if (generation === this.generation || generation === locked) continue;
        if (this.ownGenerations.has(generation)) remove = true;
        else if (retiredAt.has(generation)) remove = retiredAt.get(generation) < cutoff;
        else remove = mtimeBefore(target, cutoff);
      } else if (entry.name.endsWith(".tmp") || entry.name.startsWith(`${LOCK_FILE}.stale.`)) {
        remove = mtimeBefore(target, cutoff);
      }
      if (!remove) continue;
      try {
        this.guardedRemove(target);
      } catch (error) {
        if (error instanceof VectorCacheError) return;
        // Another process may have removed it first; the next write retries.
      }
    }
  }
}

// options: embedderId, dimension (required); root (containment is checked at
// open and before every write), allowInsideRoot, lockWaitMs, lockStaleMs.
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
    lockStaleMs: config.lockStaleMs,
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
