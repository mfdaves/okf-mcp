"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  VECTOR_CACHE_FORMAT,
  VECTOR_CACHE_FORMAT_VERSION,
  VectorCache,
  VectorCacheError,
  openVectorCache,
  resolveCacheDir,
} = require("../src/cache/store");

const EMBEDDER = "openai:https://api.example.com/v1/embeddings:model:4:32000";
const POSIX_ONLY =
  process.platform === "win32" ? "symbolic links need privileges on Windows" : false;
const UNPRIVILEGED_POSIX_ONLY =
  process.platform === "win32"
    ? "POSIX permissions"
    : typeof process.getuid === "function" && process.getuid() === 0
      ? "root bypasses permissions"
      : false;
const MINUTES = 60 * 1000;

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function tempDir(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function open(dir, overrides) {
  return openVectorCache(dir, { embedderId: EMBEDDER, dimension: 4, ...(overrides || {}) });
}

function entry(id, values) {
  return { id, hash: hash(id), vector: values };
}

function manifestOf(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
}

function dataFiles(dir) {
  return fs.readdirSync(dir).sort();
}

function ageFile(target, ms) {
  const when = new Date(Date.now() - ms);
  fs.utimesSync(target, when, when);
}

function ago(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function writeGeneration(dir, generation, rows, floats) {
  const unitBytes = Buffer.from(`${JSON.stringify(rows)}\n`);
  const vectorBytes = Buffer.alloc(floats.length * 4);
  floats.forEach((value, index) => {
    vectorBytes.writeFloatLE(value, index * 4);
  });
  fs.writeFileSync(path.join(dir, `units.${generation}.json`), unitBytes);
  fs.writeFileSync(path.join(dir, `vectors.${generation}.f32`), vectorBytes);
  return { units: sha256(unitBytes), vectors: sha256(vectorBytes) };
}

function writeLock(dir, content) {
  fs.writeFileSync(path.join(dir, "lock"), content);
}

function readLockFile(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "lock"), "utf8"));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("round-trips rows through a generation of files and reopens them", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  assert.deepEqual(cache.opened, { rebuilt: true, reason: "missing", rows: 0 });
  assert.equal(cache.size, 0);
  assert.deepEqual(
    await cache.putMany([entry("a", [1, 2, 3, 4]), entry("b", new Float32Array([5, 6, 7, 8]))]),
    { added: 2, replaced: 0 },
  );

  const manifest = manifestOf(dir);
  assert.deepEqual(Object.keys(manifest).sort(), [
    "count",
    "digests",
    "dimension",
    "embedderId",
    "files",
    "format",
    "formatVersion",
    "generation",
    "retired",
    "updatedAt",
  ]);
  assert.equal(manifest.format, VECTOR_CACHE_FORMAT);
  assert.equal(manifest.formatVersion, VECTOR_CACHE_FORMAT_VERSION);
  assert.equal(manifest.embedderId, EMBEDDER);
  assert.equal(manifest.dimension, 4);
  assert.equal(manifest.count, 2);
  assert.deepEqual(manifest.retired, []);
  assert.match(manifest.generation, /^[0-9a-z]{1,16}-[0-9a-f]{8}$/);
  assert.deepEqual(manifest.files, {
    units: `units.${manifest.generation}.json`,
    vectors: `vectors.${manifest.generation}.f32`,
  });
  assert.deepEqual(dataFiles(dir), ["manifest.json", manifest.files.units, manifest.files.vectors]);
  const unitBytes = fs.readFileSync(path.join(dir, manifest.files.units));
  const vectorBytes = fs.readFileSync(path.join(dir, manifest.files.vectors));
  assert.deepEqual(manifest.digests, { units: sha256(unitBytes), vectors: sha256(vectorBytes) });
  assert.deepEqual(JSON.parse(unitBytes.toString("utf8")), [
    { id: "a", hash: hash("a") },
    { id: "b", hash: hash("b") },
  ]);
  assert.equal(vectorBytes.length, 2 * 4 * 4);
  assert.equal(vectorBytes.readFloatLE(0), 1);
  assert.equal(vectorBytes.readFloatLE(7 * 4), 8);

  const reopened = open(dir);
  assert.deepEqual(reopened.opened, { rebuilt: false, reason: null, rows: 2 });
  assert.equal(reopened.generation, manifest.generation);
  assert.equal(reopened.has(hash("a")), true);
  assert.equal(reopened.has(hash("zzz")), false);
  assert.deepEqual(Array.from(reopened.get(hash("b"))), [5, 6, 7, 8]);
  assert.equal(reopened.get(hash("zzz")), null);
  assert.deepEqual(
    reopened.all().map((row) => [row.id, row.hash, Array.from(row.vector)]),
    [
      ["a", hash("a"), [1, 2, 3, 4]],
      ["b", hash("b"), [5, 6, 7, 8]],
    ],
  );
});

test("upserts by hash, prunes by hash, keeps earlier views, and drops its own old generations", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await cache.putMany([
    entry("a", [1, 1, 1, 1]),
    entry("b", [2, 2, 2, 2]),
    entry("c", [3, 3, 3, 3]),
  ]);
  const first = manifestOf(dir).generation;
  const before = cache.get(hash("c"));
  assert.deepEqual(
    await cache.putMany([{ id: "renamed", hash: hash("b"), vector: [9, 9, 9, 9] }]),
    { added: 0, replaced: 1 },
  );
  const second = manifestOf(dir);
  assert.notEqual(second.generation, first);
  assert.deepEqual(dataFiles(dir), [
    "manifest.json",
    `units.${second.generation}.json`,
    `vectors.${second.generation}.f32`,
  ]);
  assert.deepEqual(second.retired, [], "own generations are collected at once, never retired");
  assert.equal(cache.size, 3);
  assert.deepEqual(
    cache.all().map((row) => row.id),
    ["a", "renamed", "c"],
  );
  assert.equal(await cache.prune(new Set([hash("a"), hash("c")])), 1);
  assert.equal(await cache.prune([hash("a"), hash("c")]), 0);
  assert.deepEqual(
    cache.all().map((row) => [row.id, Array.from(row.vector)]),
    [
      ["a", [1, 1, 1, 1]],
      ["c", [3, 3, 3, 3]],
    ],
  );
  assert.deepEqual(Array.from(before), [3, 3, 3, 3]);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["a", "c"],
  );
  assert.deepEqual(manifestOf(dir).retired, [], "retired entries without files are dropped");
  assert.deepEqual(await cache.putMany([]), { added: 0, replaced: 0 });
  for (const bad of [
    { id: "x", hash: "nothex", vector: [1, 2, 3, 4] },
    { id: "", hash: hash("x"), vector: [1, 2, 3, 4] },
    null,
  ]) {
    await assert.rejects(
      cache.putMany([bad]),
      (error) => error instanceof VectorCacheError && error.code === "invalid_cache_entry",
    );
  }
  await assert.rejects(cache.putMany("rows"), (error) => error.code === "invalid_cache_entry");
  assert.equal(cache.size, 2);
  assert.equal(dataFiles(dir).length, 3);
});

test("rejects vectors that are not finite float32 values and refuses to load them", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  for (const [vector, reason] of [
    [[1e100, 0, 0, 0], "not_finite_as_float32"],
    [[0, Number.NaN, 0, 0], "not_finite"],
    [[0, Number.POSITIVE_INFINITY, 0, 0], "not_finite"],
    [[1, 2, 3], "wrong_length"],
    [new Float32Array(5), "wrong_length"],
    ["0,0,0,0", "not_a_vector"],
  ]) {
    await assert.rejects(
      cache.putMany([{ id: "x", hash: hash("x"), vector }]),
      (error) =>
        error.code === "invalid_vector" &&
        error.details.position === 0 &&
        error.details.reason === reason,
    );
  }
  assert.equal(cache.size, 0);
  await cache.putMany([entry("a", [3.4e38, -3.4e38, 1e-45, 0])]);
  assert.equal(open(dir).size, 1);

  // A stored file that holds a non-finite value is corrupt even when its
  // digest matches the manifest.
  const manifest = manifestOf(dir);
  const vectorsPath = path.join(dir, manifest.files.vectors);
  for (const poison of [Number.POSITIVE_INFINITY, Number.NaN]) {
    const bytes = fs.readFileSync(vectorsPath);
    bytes.writeFloatLE(poison, 4);
    fs.writeFileSync(vectorsPath, bytes);
    writeManifest(dir, { ...manifest, digests: { ...manifest.digests, vectors: sha256(bytes) } });
    assert.equal(open(dir).opened.reason, "vectors_corrupt");
  }
});

test("starts empty and says why on any mismatch, corruption or tampering", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  await open(dir).putMany([entry("a", [1, 2, 3, 4]), entry("b", [5, 6, 7, 8])]);
  assert.equal(
    open(dir, { embedderId: "openai:https://api.example.com/v1/embeddings:other:4:32000" }).opened
      .reason,
    "embedder_mismatch",
  );
  assert.equal(open(dir, { dimension: 8 }).opened.reason, "dimension_mismatch");
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = manifestOf(dir);

  writeManifest(dir, { ...manifest, formatVersion: 99 });
  assert.equal(open(dir).opened.reason, "format_mismatch");
  fs.writeFileSync(manifestPath, "{ not json");
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  writeManifest(dir, { ...manifest, count: "1" });
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  writeManifest(dir, { ...manifest, files: { ...manifest.files, units: "../units.json" } });
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  writeManifest(dir, { ...manifest, digests: undefined });
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  writeManifest(dir, { ...manifest, retired: "junk" });
  assert.equal(open(dir).opened.rebuilt, false, "a malformed retired list is ignored");
  writeManifest(dir, manifest);
  assert.equal(open(dir).opened.rebuilt, false);

  // Tampering in place keeps lengths and counts but not the digests.
  const vectorsPath = path.join(dir, manifest.files.vectors);
  const vectorBytes = fs.readFileSync(vectorsPath);
  const flipped = Buffer.from(vectorBytes);
  flipped.writeFloatLE(42, 0);
  fs.writeFileSync(vectorsPath, flipped);
  assert.equal(open(dir).opened.reason, "integrity_mismatch");
  fs.writeFileSync(vectorsPath, vectorBytes);
  const unitsPath = path.join(dir, manifest.files.units);
  const unitBytes = fs.readFileSync(unitsPath);
  fs.writeFileSync(
    unitsPath,
    JSON.stringify([
      { id: "b", hash: hash("b") },
      { id: "a", hash: hash("a") },
    ]),
  );
  assert.equal(open(dir).opened.reason, "integrity_mismatch");
  fs.writeFileSync(unitsPath, unitBytes);
  assert.equal(open(dir).opened.rebuilt, false);

  fs.truncateSync(vectorsPath, 8);
  assert.equal(open(dir).opened.reason, "integrity_mismatch");
  fs.unlinkSync(vectorsPath);
  assert.equal(open(dir).opened.reason, "vectors_corrupt");
  fs.writeFileSync(vectorsPath, vectorBytes);
  fs.unlinkSync(unitsPath);
  assert.equal(open(dir).opened.reason, "units_corrupt");
  fs.writeFileSync(unitsPath, unitBytes);
  fs.unlinkSync(manifestPath);
  assert.equal(open(dir).opened.reason, "manifest_missing");

  // A rebuilt cache commits its own generation; the stale files were never
  // retired by anyone, so they go only once they are old.
  const rebuilt = open(dir);
  await rebuilt.putMany([entry("fresh", [4, 3, 2, 1])]);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["fresh"],
  );
  assert.equal(dataFiles(dir).length, 5);
  ageFile(unitsPath, 16 * MINUTES);
  ageFile(vectorsPath, 16 * MINUTES);
  await rebuilt.putMany([entry("more", [1, 1, 1, 1])]);
  assert.equal(dataFiles(dir).length, 3);
});

test("an interrupted write never pairs rows of one generation with vectors of another", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await cache.putMany([entry("a", [1, 1, 1, 1]), entry("b", [2, 2, 2, 2])]);
  const committed = manifestOf(dir);

  // Writer X has landed its data files but not yet its manifest.
  const orphan = "zzzzzzzz-deadbeef";
  const xRows = [
    { id: "a", hash: hash("a") },
    { id: "c", hash: hash("c") },
  ];
  const xDigests = writeGeneration(dir, orphan, xRows, [9, 9, 9, 9, 8, 8, 8, 8]);
  const reader = open(dir);
  assert.deepEqual(reader.opened, { rebuilt: false, reason: null, rows: 2 });
  assert.deepEqual(
    reader.all().map((row) => [row.id, Array.from(row.vector)]),
    [
      ["a", [1, 1, 1, 1]],
      ["b", [2, 2, 2, 2]],
    ],
  );

  // Another writer commits meanwhile: its own old generation goes, X's young
  // files stay, and X's manifest then commits a consistent generation.
  await cache.putMany([entry("d", [4, 4, 4, 4])]);
  const current = manifestOf(dir);
  assert.deepEqual(dataFiles(dir), [
    "manifest.json",
    `units.${current.generation}.json`,
    `units.${orphan}.json`,
    `vectors.${current.generation}.f32`,
    `vectors.${orphan}.f32`,
  ]);
  writeManifest(dir, {
    ...committed,
    generation: orphan,
    files: { units: `units.${orphan}.json`, vectors: `vectors.${orphan}.f32` },
    digests: xDigests,
  });
  const afterX = open(dir);
  assert.deepEqual(afterX.opened, { rebuilt: false, reason: null, rows: 2 });
  assert.deepEqual(
    afterX.all().map((row) => [row.id, Array.from(row.vector)]),
    [
      ["a", [9, 9, 9, 9]],
      ["c", [8, 8, 8, 8]],
    ],
  );

  // The reverse: a manifest for a generation whose files never landed.
  writeManifest(dir, {
    ...committed,
    generation: "aaaaaaaa-00000000",
    files: { units: "units.aaaaaaaa-00000000.json", vectors: "vectors.aaaaaaaa-00000000.f32" },
  });
  assert.equal(open(dir).opened.reason, "units_corrupt");

  // And a manifest whose digests describe other bytes than the files hold.
  writeManifest(dir, { ...current, digests: committed.digests });
  assert.equal(open(dir).opened.reason, "integrity_mismatch");
});

test("writers take a tokened lock, wait for a live one, and reclaim a stale one", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir, { lockWaitMs: 60 });
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  assert.equal(fs.existsSync(path.join(dir, "lock")), false, "the lock is released");

  writeLock(dir, JSON.stringify({ token: "other", pid: 424242, createdAt: ago(0) }));
  const started = Date.now();
  await assert.rejects(
    cache.putMany([entry("b", [2, 2, 2, 2])]),
    (error) =>
      error.code === "cache_locked" && error.details.pid === 424242 && error.details.ageMs >= 0,
  );
  assert.ok(Date.now() - started >= 50, "a live lock is waited for");
  assert.equal(readLockFile(dir).token, "other", "a live lock is left alone");
  assert.equal(manifestOf(dir).count, 1);
  fs.unlinkSync(path.join(dir, "lock"));
  assert.equal(cache.size, 2, "the row stays in memory and lands on the next write");
  await cache.putMany([entry("c", [3, 3, 3, 3])]);
  assert.equal(manifestOf(dir).count, 3);

  writeLock(dir, JSON.stringify({ token: "gone", pid: 424242, createdAt: ago(11 * MINUTES) }));
  await cache.putMany([entry("d", [4, 4, 4, 4])]);
  assert.equal(manifestOf(dir).count, 4, "a stale lock is reclaimed");
  assert.deepEqual(
    dataFiles(dir).filter((name) => name.startsWith("lock")),
    [],
    "neither the lock nor the parked stale lock remains",
  );

  writeLock(dir, "not json");
  await assert.rejects(
    cache.putMany([entry("e", [5, 5, 5, 5])]),
    (error) => error.code === "cache_locked" && error.details.pid === null,
  );
  ageFile(path.join(dir, "lock"), 11 * MINUTES);
  await cache.putMany([entry("f", [6, 6, 6, 6])]);
  assert.equal(manifestOf(dir).count, 6, "an unparsable lock is aged by its mtime");

  // lockStaleMs is configurable: a two-minute-old lock is live by default
  // and stale for a writer that allows one minute.
  writeLock(dir, JSON.stringify({ token: "slow", pid: 7, createdAt: ago(2 * MINUTES) }));
  await assert.rejects(
    cache.putMany([entry("g", [7, 7, 7, 7])]),
    (error) => error.code === "cache_locked",
  );
  const impatient = open(dir, { lockWaitMs: 60, lockStaleMs: MINUTES });
  await impatient.putMany([entry("h", [8, 8, 8, 8])]);
  assert.equal(manifestOf(dir).count, 7, "the impatient writer loaded the rows and added its own");
});

test("only one of two reclaimers wins a stale lock and both writers get through", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  await open(dir).putMany([entry("a", [1, 1, 1, 1])]);
  writeLock(dir, JSON.stringify({ token: "gone", pid: 424242, createdAt: ago(11 * MINUTES) }));
  const first = open(dir, { lockWaitMs: 2000 });
  const second = open(dir, { lockWaitMs: 2000 });
  const renames = [];
  for (const cache of [first, second]) {
    cache.renameFile = (from, to) => {
      renames.push(path.basename(to));
      fs.renameSync(from, to);
    };
  }
  await Promise.all([
    first.putMany([entry("b", [2, 2, 2, 2])]),
    second.putMany([entry("c", [3, 3, 3, 3])]),
  ]);
  assert.equal(renames.length, 1, "exactly one reclaim renamed the stale lock");
  assert.match(renames[0], /^lock\.stale\.\d+-[0-9a-f]{16}$/);
  assert.deepEqual(
    dataFiles(dir).filter((name) => name.startsWith("lock")),
    [],
  );
  assert.equal(open(dir).opened.rebuilt, false);
});

test("a late release leaves a successor's lock in place", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  cache.writeFile = async (target, content) => {
    await wait(60);
    VectorCache.prototype.writeFile.call(cache, target, content);
  };
  const pending = cache.putMany([entry("b", [2, 2, 2, 2])]);
  await wait(20);
  const mine = readLockFile(dir);
  assert.match(mine.token, /^\d+-[0-9a-f]{16}$/);
  // Simulate a successor that reclaimed our lock after it went stale.
  writeLock(dir, JSON.stringify({ token: "successor", pid: 1, createdAt: ago(0) }));
  await pending;
  assert.equal(readLockFile(dir).token, "successor", "the successor's lock survived");
  assert.equal(manifestOf(dir).count, 2);
  fs.unlinkSync(path.join(dir, "lock"));
});

test("a failed reclaim respects the deadline instead of spinning", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir, { lockWaitMs: 80 });
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  writeLock(dir, JSON.stringify({ token: "gone", pid: 424242, createdAt: ago(11 * MINUTES) }));
  cache.renameFile = () => {
    const error = new Error("operation not permitted");
    error.code = "EPERM";
    throw error;
  };
  const started = Date.now();
  await assert.rejects(
    cache.putMany([entry("b", [2, 2, 2, 2])]),
    (error) => error.code === "cache_locked" && error.details.pid === 424242,
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 80 && elapsed < 2000, `deadline respected (${elapsed} ms)`);
  assert.equal(readLockFile(dir).token, "gone", "the stale lock is untouched");

  // A reclaim whose unlink fails still gets through; the parked file is
  // collected once it is old.
  delete cache.renameFile;
  cache.removeFile = (target) => {
    if (target.includes(".stale.")) throw new Error("busy");
    fs.unlinkSync(target);
  };
  await cache.putMany([entry("c", [3, 3, 3, 3])]);
  assert.equal(manifestOf(dir).count, 3);
  const parked = dataFiles(dir).filter((name) => name.startsWith("lock.stale."));
  assert.equal(parked.length, 1);
  delete cache.removeFile;
  ageFile(path.join(dir, parked[0]), 16 * MINUTES);
  await cache.putMany([entry("d", [4, 4, 4, 4])]);
  assert.deepEqual(
    dataFiles(dir).filter((name) => name.startsWith("lock")),
    [],
  );
});

test("counts the grace period from retirement, not from file age", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const seed = open(dir);
  await seed.putMany([entry("a", [1, 1, 1, 1])]);
  const base = manifestOf(dir);

  // Writer X committed a generation long ago; its files are old on disk.
  const foreign = "ffffffff-0000cafe";
  const digests = writeGeneration(dir, foreign, [{ id: "x", hash: hash("x") }], [1, 2, 3, 4]);
  ageFile(path.join(dir, `units.${foreign}.json`), 16 * MINUTES);
  ageFile(path.join(dir, `vectors.${foreign}.f32`), 16 * MINUTES);
  writeManifest(dir, {
    ...base,
    generation: foreign,
    files: { units: `units.${foreign}.json`, vectors: `vectors.${foreign}.f32` },
    digests,
    retired: [],
  });

  // Our commit retires it now, so it survives despite its old files.
  const cache = open(dir);
  assert.equal(cache.generation, foreign);
  await cache.putMany([entry("b", [2, 2, 2, 2])]);
  const committed = manifestOf(dir);
  assert.deepEqual(
    committed.retired.map((item) => item.generation),
    [foreign],
  );
  assert.equal(fs.existsSync(path.join(dir, `units.${foreign}.json`)), true);

  // Once its retirement is older than the grace period, it goes.
  writeManifest(dir, {
    ...committed,
    retired: [{ generation: foreign, retiredAt: ago(16 * MINUTES) }],
  });
  await cache.putMany([entry("c", [3, 3, 3, 3])]);
  assert.equal(fs.existsSync(path.join(dir, `units.${foreign}.json`)), false);
  await cache.putMany([entry("d", [4, 4, 4, 4])]);
  assert.deepEqual(manifestOf(dir).retired, [], "an entry whose files are gone drops off next");
});

test("collects never-committed orphans and stale temporary files by age", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  const young = "yyyyyyyy-0000aaaa";
  const old = "oooooooo-0000bbbb";
  writeGeneration(dir, young, [{ id: "y", hash: hash("y") }], [1, 2, 3, 4]);
  writeGeneration(dir, old, [{ id: "o", hash: hash("o") }], [1, 2, 3, 4]);
  ageFile(path.join(dir, `units.${old}.json`), 16 * MINUTES);
  ageFile(path.join(dir, `vectors.${old}.f32`), 16 * MINUTES);
  fs.writeFileSync(path.join(dir, "stale.tmp"), "x");
  ageFile(path.join(dir, "stale.tmp"), 16 * MINUTES);
  fs.writeFileSync(path.join(dir, "fresh.tmp"), "x");
  fs.writeFileSync(path.join(dir, "lock.stale.1-00"), "x");
  ageFile(path.join(dir, "lock.stale.1-00"), 16 * MINUTES);
  await cache.putMany([entry("b", [2, 2, 2, 2])]);
  const current = manifestOf(dir).generation;
  assert.deepEqual(dataFiles(dir), [
    "fresh.tmp",
    "manifest.json",
    `units.${current}.json`,
    `units.${young}.json`,
    `vectors.${current}.f32`,
    `vectors.${young}.f32`,
  ]);
});

test("a reader keeps serving its generation after other writers commit and collect", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  await open(dir).putMany([entry("a", [1, 1, 1, 1]), entry("b", [2, 2, 2, 2])]);
  const first = manifestOf(dir);
  const reader = open(dir);
  assert.equal(reader.generation, first.generation);

  const writer = open(dir);
  await writer.putMany([entry("c", [3, 3, 3, 3])]);
  const afterFirst = manifestOf(dir);
  writeManifest(dir, {
    ...afterFirst,
    retired: afterFirst.retired.map((item) => ({ ...item, retiredAt: ago(16 * MINUTES) })),
  });
  await writer.putMany([entry("d", [4, 4, 4, 4])]);
  assert.equal(fs.existsSync(path.join(dir, first.files.units)), false);
  assert.equal(fs.existsSync(path.join(dir, first.files.vectors)), false);

  assert.deepEqual(Array.from(reader.get(hash("b"))), [2, 2, 2, 2]);
  assert.deepEqual(
    reader.all().map((row) => row.id),
    ["a", "b"],
  );
  await reader.putMany([entry("e", [5, 5, 5, 5])]);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["a", "b", "e"],
  );
});

test("writes of one instance are serialised and all land", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await Promise.all([
    cache.putMany([entry("a", [1, 1, 1, 1])]),
    cache.putMany([entry("b", [2, 2, 2, 2])]),
    cache.putMany([entry("c", [3, 3, 3, 3])]),
  ]);
  assert.equal(manifestOf(dir).count, 3);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["a", "b", "c"],
  );
  assert.equal(dataFiles(dir).length, 3);
});

test("a failed write releases the lock, keeps the previous generation, and recovers", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  const first = manifestOf(dir);
  cache.writeFile = (target, content) => {
    if (target.endsWith(".f32")) throw new Error("disk full");
    return VectorCache.prototype.writeFile.call(cache, target, content);
  };
  await assert.rejects(cache.putMany([entry("b", [2, 2, 2, 2])]), /disk full/);
  assert.equal(fs.existsSync(path.join(dir, "lock")), false, "the lock is released");
  assert.deepEqual(manifestOf(dir), first, "the previous generation stays committed");
  assert.deepEqual(open(dir).opened, { rebuilt: false, reason: null, rows: 1 });
  assert.equal(cache.size, 2, "memory keeps the row");
  assert.equal(dataFiles(dir).length, 4, "the half-written generation is left behind for now");

  delete cache.writeFile;
  await cache.flush();
  assert.equal(manifestOf(dir).count, 2);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["a", "b"],
  );
  assert.equal(dataFiles(dir).length, 3, "its own half-written generation is collected");
});

test("a directory the process cannot write to fails the write without a stale lock", {
  skip: UNPRIVILEGED_POSIX_ONLY,
}, async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  fs.chmodSync(dir, 0o500);
  t.after(() => {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // The temporary directory may already be gone.
    }
  });
  await assert.rejects(
    cache.putMany([entry("b", [2, 2, 2, 2])]),
    (error) => error.code === "cache_write_failed" && error.details.cause === "EACCES",
  );
  fs.chmodSync(dir, 0o700);
  assert.equal(fs.existsSync(path.join(dir, "lock")), false);
  await cache.putMany([entry("c", [3, 3, 3, 3])]);
  assert.equal(manifestOf(dir).count, 3);
});

test("recovers when the directory disappears between two writes", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await cache.putMany([entry("a", [1, 2, 3, 4])]);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(dir), false);
  await cache.putMany([entry("b", [5, 6, 7, 8])]);
  const reopened = open(dir);
  assert.deepEqual(reopened.opened, { rebuilt: false, reason: null, rows: 2 });
  assert.deepEqual(
    reopened.all().map((row) => row.id),
    ["a", "b"],
  );
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(await cache.prune([hash("a")]), 1);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["a"],
  );
});

test("applies path safety to the cache directory and its options", async (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  for (const bad of [
    "relative/cache",
    `${base}/../escape`,
    `${base}/nul/cache`,
    path.parse(base).root,
  ]) {
    assert.throws(
      () => open(bad),
      (error) => error.code === "invalid_cache_dir",
      bad,
    );
  }
  assert.throws(
    () => open(`${base}/with\u0000nul`),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.throws(
    () => open(""),
    (error) => error.code === "invalid_cache_dir",
  );
  fs.writeFileSync(path.join(base, "file"), "x");
  assert.throws(
    () => open(path.join(base, "file")),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.throws(
    () => openVectorCache(path.join(base, "c"), { embedderId: "has space", dimension: 4 }),
    (error) => error.code === "invalid_cache_options" && error.details.field === "embedderId",
  );
  assert.throws(
    () => openVectorCache(path.join(base, "c"), { embedderId: "ok", dimension: 0 }),
    (error) => error.code === "invalid_cache_options" && error.details.field === "dimension",
  );

  // With the root known, open refuses a directory inside it unless told so.
  const root = path.join(base, "bundle");
  fs.mkdirSync(root);
  assert.throws(
    () => open(path.join(root, ".okf-cache"), { root }),
    (error) => error.code === "cache_inside_root",
  );
  assert.equal(open(path.join(root, ".okf-cache"), { root, allowInsideRoot: true }).size, 0);
  const outside = open(path.join(base, "outside"), { root });
  await outside.putMany([entry("a", [1, 1, 1, 1])]);
  assert.equal(outside.size, 1);
});

test("refuses a symlinked cache directory, resolves linked ancestors, never follows linked files", {
  skip: POSIX_ONLY,
}, async (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const real = path.join(base, "real");
  fs.mkdirSync(real);
  await open(real).putMany([entry("a", [1, 2, 3, 4])]);

  // The directory itself must not be a link, whether it opens or writes.
  const link = path.join(base, "link");
  fs.symlinkSync(real, link);
  assert.throws(
    () => open(link),
    (error) => error.code === "invalid_cache_dir",
  );
  const live = open(path.join(base, "later"));
  fs.symlinkSync(real, path.join(base, "later"));
  await assert.rejects(
    live.putMany([entry("b", [5, 6, 7, 8])]),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.equal(open(real).size, 1, "nothing was written through the link");

  // Ancestors may be links; the store works on the real location.
  const parentLink = path.join(base, "parent-link");
  fs.symlinkSync(base, parentLink);
  const viaParent = open(path.join(parentLink, "nested", "cache"));
  assert.equal(viaParent.dir, path.join(base, "nested", "cache"));
  await viaParent.putMany([entry("c", [1, 1, 1, 1])]);
  assert.equal(open(path.join(base, "nested", "cache")).size, 1);

  // A linked manifest is treated as missing and replaced by a regular file.
  const outside = path.join(base, "outside.json");
  fs.copyFileSync(path.join(real, "manifest.json"), outside);
  fs.unlinkSync(path.join(real, "manifest.json"));
  fs.symlinkSync(outside, path.join(real, "manifest.json"));
  const cache = open(real);
  assert.equal(cache.opened.reason, "manifest_missing");
  await cache.putMany([entry("b", [5, 6, 7, 8])]);
  assert.equal(fs.lstatSync(path.join(real, "manifest.json")).isSymbolicLink(), false);
  assert.equal(JSON.parse(fs.readFileSync(outside, "utf8")).count, 1);
});

test("an ancestor link created after open makes the next write fail closed", {
  skip: POSIX_ONLY,
}, async (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const root = path.join(base, "bundle");
  fs.mkdirSync(root);
  const elsewhere = path.join(base, "elsewhere");
  fs.mkdirSync(elsewhere);
  const dir = path.join(base, "parent", "cache");
  const cache = open(dir, { root });
  await cache.putMany([entry("a", [1, 1, 1, 1])]);

  // Re-point the parent into the bundle root: the write must not land there.
  fs.rmSync(path.join(base, "parent"), { recursive: true, force: true });
  fs.symlinkSync(root, path.join(base, "parent"));
  await assert.rejects(
    cache.putMany([entry("b", [2, 2, 2, 2])]),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.deepEqual(fs.readdirSync(root), [], "nothing was written into the root");

  // The same when the parent now points somewhere harmless: the location
  // is no longer the one opened.
  fs.unlinkSync(path.join(base, "parent"));
  fs.symlinkSync(elsewhere, path.join(base, "parent"));
  await assert.rejects(
    cache.putMany([entry("c", [3, 3, 3, 3])]),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test("an ancestor swapped while waiting for the lock fails the wait and writes nothing", {
  skip: POSIX_ONLY,
}, async (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const root = path.join(base, "bundle");
  fs.mkdirSync(root);
  const elsewhere = path.join(base, "elsewhere");
  fs.mkdirSync(elsewhere);
  const dir = path.join(base, "parent", "cache");
  const cache = open(dir, { root, lockWaitMs: 500 });
  await cache.putMany([entry("a", [1, 1, 1, 1])]);

  // Another writer holds the lock; while we wait, the parent is swapped.
  writeLock(dir, JSON.stringify({ token: "other", pid: 424242, createdAt: ago(0) }));
  const pending = cache.putMany([entry("b", [2, 2, 2, 2])]);
  await wait(60);
  fs.renameSync(path.join(base, "parent"), path.join(base, "parent-old"));
  fs.symlinkSync(elsewhere, path.join(base, "parent"));
  await assert.rejects(pending, (error) => error.code === "invalid_cache_dir");
  assert.deepEqual(fs.readdirSync(elsewhere), [], "nothing was placed at the new target");
  assert.equal(
    readLockFile(path.join(base, "parent-old", "cache")).token,
    "other",
    "the other writer's lock is untouched",
  );
});

test("a data file swapped for a link fails closed instead of being read", {
  skip: POSIX_ONLY,
}, async (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const dir = path.join(base, "cache");
  await open(dir).putMany([entry("a", [1, 2, 3, 4])]);
  const manifest = manifestOf(dir);
  for (const [file, reason] of [
    [manifest.files.units, "units_corrupt"],
    [manifest.files.vectors, "vectors_corrupt"],
  ]) {
    const target = path.join(dir, file);
    const copy = path.join(base, `${file}.copy`);
    fs.copyFileSync(target, copy);
    fs.unlinkSync(target);
    fs.symlinkSync(copy, target);
    assert.equal(open(dir).opened.reason, reason, file);
    fs.unlinkSync(target);
    fs.copyFileSync(copy, target);
    assert.equal(open(dir).opened.rebuilt, false);
  }
});

test("a fresh lock that slips in before the reclaim rename is put back or left for its owner", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir, { lockWaitMs: 150 });
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  const lockPath = path.join(dir, "lock");
  const stale = () => JSON.stringify({ token: "gone", pid: 1, createdAt: ago(11 * MINUTES) });
  const fresh = (token) => JSON.stringify({ token, pid: 2, createdAt: ago(0) });

  // The staleness read sees "gone"; before our rename runs, a fresh foreign
  // lock takes the slot. The rename parks that fresh lock, the token check
  // notices, and link() puts it back.
  let interleaved = 0;
  cache.renameFile = (from, to) => {
    if (path.basename(from) === "lock" && interleaved === 0) {
      interleaved += 1;
      writeLock(dir, fresh("fresh"));
    }
    fs.renameSync(from, to);
  };
  writeLock(dir, stale());
  await assert.rejects(
    cache.putMany([entry("b", [2, 2, 2, 2])]),
    (error) => error.code === "cache_locked",
  );
  assert.equal(interleaved, 1);
  assert.equal(readLockFile(dir).token, "fresh", "the fresh lock was restored");
  assert.deepEqual(
    dataFiles(dir).filter((name) => name.startsWith("lock.stale.")),
    [],
    "the parked copy is gone",
  );
  assert.equal(manifestOf(dir).count, 1, "nothing was written");

  // When a third writer takes the slot before the restoring link, the parked
  // copy stays for collection and the slot is treated as busy.
  fs.unlinkSync(lockPath);
  writeLock(dir, stale());
  interleaved = 0;
  cache.linkFile = () => {
    writeLock(dir, fresh("third"));
    const error = new Error("file exists");
    error.code = "EEXIST";
    throw error;
  };
  await assert.rejects(
    cache.putMany([entry("c", [3, 3, 3, 3])]),
    (error) => error.code === "cache_locked",
  );
  assert.equal(readLockFile(dir).token, "third", "the third writer's lock is untouched");
  const parked = dataFiles(dir).filter((name) => name.startsWith("lock.stale."));
  assert.equal(parked.length, 1, "the displaced lock waits for collection");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, parked[0]), "utf8")).token, "fresh");
  assert.equal(manifestOf(dir).count, 1);
});

test("a directory swapped between the two data writes stops before the vectors land", {
  skip: POSIX_ONLY,
}, async (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const elsewhere = path.join(base, "elsewhere");
  fs.mkdirSync(elsewhere);
  const dir = path.join(base, "parent", "cache");
  const cache = open(dir);
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  let swapped = false;
  cache.writeFile = (target, content) => {
    VectorCache.prototype.writeFile.call(cache, target, content);
    if (!swapped && /units\.[^/\\]+\.json$/.test(target)) {
      swapped = true;
      fs.renameSync(path.join(base, "parent"), path.join(base, "parent-old"));
      fs.symlinkSync(elsewhere, path.join(base, "parent"));
    }
  };
  await assert.rejects(
    cache.putMany([entry("b", [2, 2, 2, 2])]),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.equal(swapped, true);
  assert.deepEqual(fs.readdirSync(elsewhere), [], "nothing landed at the new target");
  const old = path.join(base, "parent-old", "cache");
  const names = fs.readdirSync(old);
  assert.equal(names.filter((name) => name.startsWith("vectors.")).length, 1, "no vectors written");
  assert.equal(names.filter((name) => name.startsWith("units.")).length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(old, "manifest.json"), "utf8")).count, 1);
});

test("garbage collection after a swap unlinks nothing", { skip: POSIX_ONLY }, async (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const elsewhere = path.join(base, "elsewhere");
  fs.mkdirSync(elsewhere);
  const dir = path.join(base, "parent", "cache");
  const cache = open(dir);
  await cache.putMany([entry("a", [1, 1, 1, 1])]);
  const first = manifestOf(dir);
  let swapped = false;
  cache.writeFile = (target, content) => {
    VectorCache.prototype.writeFile.call(cache, target, content);
    if (!swapped && target.endsWith("manifest.json")) {
      swapped = true;
      fs.renameSync(path.join(base, "parent"), path.join(base, "parent-old"));
      fs.symlinkSync(elsewhere, path.join(base, "parent"));
    }
  };
  // The commit landed before the swap, so the write succeeds; collection and
  // release find a directory that no longer verifies and touch nothing.
  await cache.putMany([entry("b", [2, 2, 2, 2])]);
  const old = path.join(base, "parent-old", "cache");
  assert.equal(fs.existsSync(path.join(old, first.files.units)), true, "nothing was collected");
  assert.equal(fs.existsSync(path.join(old, first.files.vectors)), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(old, "manifest.json"), "utf8")).count, 2);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test("never forgets a retired generation younger than the grace period", async (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  await cache.putMany([entry("seed", [0, 0, 0, 0])]);
  const foreign = [];
  for (let index = 0; index < 70; index += 1) {
    const generation = `f${index.toString(36).padStart(7, "0")}-${index.toString(16).padStart(8, "0")}`;
    const current = manifestOf(dir);
    const digests = writeGeneration(
      dir,
      generation,
      [{ id: `x${index}`, hash: hash(`x${index}`) }],
      [1, 2, 3, 4],
    );
    // A long-running foreign writer: old files, committed just now.
    ageFile(path.join(dir, `units.${generation}.json`), 16 * MINUTES);
    ageFile(path.join(dir, `vectors.${generation}.f32`), 16 * MINUTES);
    writeManifest(dir, {
      ...current,
      generation,
      files: { units: `units.${generation}.json`, vectors: `vectors.${generation}.f32` },
      digests,
    });
    await cache.putMany([entry(`own${index}`, [1, 1, 1, 1])]);
    foreign.push(generation);
  }
  const final = manifestOf(dir);
  assert.equal(final.retired.length, 70, "every young retirement is still recorded");
  for (const generation of foreign) {
    assert.equal(fs.existsSync(path.join(dir, `units.${generation}.json`)), true, generation);
  }

  // Past the grace period the cap applies and the forgotten entries' files
  // go in the same step as the remembered ones.
  writeManifest(dir, {
    ...final,
    retired: final.retired.map((item) => ({ ...item, retiredAt: ago(16 * MINUTES) })),
  });
  await cache.putMany([entry("last", [2, 2, 2, 2])]);
  for (const generation of foreign) {
    assert.equal(fs.existsSync(path.join(dir, `units.${generation}.json`)), false, generation);
  }
  assert.ok(manifestOf(dir).retired.length <= 64);
  await cache.putMany([entry("after", [3, 3, 3, 3])]);
  assert.deepEqual(manifestOf(dir).retired, []);
});

test("directory fsync swallows only unsupported errors", { skip: POSIX_ONLY }, (t) => {
  const { syncDirectory } = require("../src/cache/files");
  const dir = tempDir(t, "okf-vector-cache-");
  const failing = (code) => () => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };
  for (const code of ["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EPERM", "EISDIR", "EBADF"]) {
    assert.doesNotThrow(() => syncDirectory(dir, { fsync: failing(code) }), code);
  }
  for (const code of ["EIO", "ENOSPC", "EROFS"]) {
    assert.throws(
      () => syncDirectory(dir, { fsync: failing(code) }),
      (error) => error.code === code,
      code,
    );
  }
  syncDirectory(dir);
});

test("resolveCacheDir derives a location outside the root and follows the platform", (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const root = path.join(base, "bundle");
  fs.mkdirSync(root);
  const cacheHome = path.join(base, "xdg");
  const digest = crypto.createHash("sha256").update(root).digest("hex");

  const derived = resolveCacheDir({ root, env: { XDG_CACHE_HOME: cacheHome } });
  assert.equal(derived, path.join(cacheHome, "okf-mcp", digest));
  assert.ok(path.relative(root, derived).startsWith(".."));
  assert.equal(
    resolveCacheDir({ root, env: {}, platform: "linux", homedir: () => "/home/alice" }),
    `/home/alice/.cache/okf-mcp/${digest}`,
  );
  assert.equal(
    resolveCacheDir({
      root,
      env: { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" },
      platform: "win32",
    }),
    `C:\\Users\\alice\\AppData\\Local\\okf-mcp\\${digest}`,
  );
  assert.equal(
    resolveCacheDir({ root, env: {}, platform: "win32", homedir: () => "C:\\Users\\alice" }),
    `C:\\Users\\alice\\AppData\\Local\\okf-mcp\\${digest}`,
  );
  assert.equal(
    resolveCacheDir({ root, env: { XDG_CACHE_HOME: "D:\\cache" }, platform: "win32" }),
    `D:\\cache\\okf-mcp\\${digest}`,
  );
  const byDefault = resolveCacheDir({ root });
  assert.ok(path.isAbsolute(byDefault));
  assert.ok(path.relative(root, byDefault).startsWith(".."));
  assert.equal(path.basename(byDefault), digest);

  assert.throws(
    () => resolveCacheDir({ root, env: { XDG_CACHE_HOME: root } }),
    (error) => error.code === "cache_inside_root",
  );
  assert.throws(
    () => resolveCacheDir({ root, env: { XDG_CACHE_HOME: path.join(root, "nested") } }),
    (error) => error.code === "cache_inside_root",
  );
  assert.throws(
    () => resolveCacheDir({ env: {}, platform: "linux" }),
    (error) => error.code === "cache_root_required",
  );
  assert.throws(
    () => resolveCacheDir({ root, env: {}, platform: "linux", homedir: () => "" }),
    (error) => error.code === "cache_location_unavailable",
  );
});

test("resolveCacheDir contains explicit directories too and compares path segments", (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const root = path.join(base, "bundle");
  fs.mkdirSync(root);
  for (const inside of [".okf-cache", "..cache", "nested/deeper", root, path.join(root, "x")]) {
    assert.throws(
      () => resolveCacheDir({ root, cacheDir: inside }),
      (error) => error.code === "cache_inside_root",
      inside,
    );
  }
  assert.equal(
    resolveCacheDir({ root, cacheDir: ".okf-cache", allowInsideRoot: true }),
    path.join(root, ".okf-cache"),
  );
  assert.equal(
    resolveCacheDir({ root, cacheDir: path.join(base, "elsewhere") }),
    path.join(base, "elsewhere"),
  );
  // A sibling whose name merely starts with the root's name is outside.
  assert.equal(resolveCacheDir({ root, cacheDir: `${root}-cache` }), `${root}-cache`);
  assert.throws(
    () => resolveCacheDir({ root, cacheDir: "../sibling" }),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.throws(
    () => resolveCacheDir({ root, cacheDir: "aux/cache" }),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.throws(
    () => resolveCacheDir({ root, cacheDir: "" }),
    (error) => error.code === "invalid_cache_dir",
  );
});

test("resolveCacheDir judges containment on real paths", { skip: POSIX_ONLY }, (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const root = path.join(base, "bundle");
  fs.mkdirSync(root);
  const digest = crypto.createHash("sha256").update(root).digest("hex");

  // A cache home that is a link into the root is inside the root.
  const intoRoot = path.join(base, "into-root");
  fs.symlinkSync(path.join(root, "hidden"), intoRoot);
  fs.mkdirSync(path.join(root, "hidden"));
  assert.throws(
    () => resolveCacheDir({ root, env: { XDG_CACHE_HOME: intoRoot } }),
    (error) => error.code === "cache_inside_root",
  );
  assert.throws(
    () => resolveCacheDir({ root, cacheDir: path.join(intoRoot, "cache") }),
    (error) => error.code === "cache_inside_root",
  );

  // A cache home that is a link elsewhere resolves to the real location.
  const elsewhere = path.join(base, "elsewhere");
  fs.mkdirSync(elsewhere);
  const linkedHome = path.join(base, "linked-home");
  fs.symlinkSync(elsewhere, linkedHome);
  assert.equal(
    resolveCacheDir({ root, env: { XDG_CACHE_HOME: linkedHome } }),
    path.join(elsewhere, "okf-mcp", digest),
  );

  // A root reached through a link is the same root.
  const rootLink = path.join(base, "root-link");
  fs.symlinkSync(root, rootLink);
  assert.equal(
    resolveCacheDir({ root: rootLink, env: { XDG_CACHE_HOME: elsewhere } }),
    path.join(elsewhere, "okf-mcp", digest),
  );
  assert.throws(
    () => resolveCacheDir({ root: rootLink, cacheDir: path.join(root, "cache") }),
    (error) => error.code === "cache_inside_root",
  );

  // The derived directory itself must not be a link.
  const home = path.join(base, "home");
  fs.mkdirSync(path.join(home, "okf-mcp"), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(home, "okf-mcp", digest));
  assert.throws(
    () => resolveCacheDir({ root, env: { XDG_CACHE_HOME: home } }),
    (error) => error.code === "invalid_cache_dir",
  );
});
