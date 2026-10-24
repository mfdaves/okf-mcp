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
  VectorCacheError,
  openVectorCache,
  resolveCacheDir,
} = require("../src/cache/store");

const EMBEDDER = "openai:api.example.com:model:4";

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function open(dir, overrides) {
  return openVectorCache(dir, { embedderId: EMBEDDER, dimension: 4, ...(overrides || {}) });
}

function entry(id, values) {
  return { id, hash: hash(id), vector: values };
}

test("round-trips rows through the three files and reopens them", (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  assert.deepEqual(cache.opened, { rebuilt: true, reason: "missing", rows: 0 });
  assert.equal(cache.size, 0);
  assert.deepEqual(
    cache.putMany([entry("a", [1, 2, 3, 4]), entry("b", new Float32Array([5, 6, 7, 8]))]),
    {
      added: 2,
      replaced: 0,
    },
  );
  assert.deepEqual(fs.readdirSync(dir).sort(), ["manifest.json", "units.json", "vectors.f32"]);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), [
    "count",
    "dimension",
    "embedderId",
    "format",
    "formatVersion",
    "updatedAt",
  ]);
  assert.equal(manifest.format, VECTOR_CACHE_FORMAT);
  assert.equal(manifest.formatVersion, VECTOR_CACHE_FORMAT_VERSION);
  assert.equal(manifest.embedderId, EMBEDDER);
  assert.equal(manifest.dimension, 4);
  assert.equal(manifest.count, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "units.json"), "utf8")), [
    { id: "a", hash: hash("a") },
    { id: "b", hash: hash("b") },
  ]);
  const bytes = fs.readFileSync(path.join(dir, "vectors.f32"));
  assert.equal(bytes.length, 2 * 4 * 4);
  assert.equal(bytes.readFloatLE(0), 1);
  assert.equal(bytes.readFloatLE(7 * 4), 8);

  const reopened = open(dir);
  assert.deepEqual(reopened.opened, { rebuilt: false, reason: null, rows: 2 });
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

test("upserts by hash, prunes by hash, and keeps earlier views as snapshots", (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  cache.putMany([entry("a", [1, 1, 1, 1]), entry("b", [2, 2, 2, 2]), entry("c", [3, 3, 3, 3])]);
  const before = cache.get(hash("c"));
  assert.deepEqual(cache.putMany([{ id: "renamed", hash: hash("b"), vector: [9, 9, 9, 9] }]), {
    added: 0,
    replaced: 1,
  });
  assert.equal(cache.size, 3);
  assert.deepEqual(
    cache.all().map((row) => row.id),
    ["a", "renamed", "c"],
  );
  assert.equal(cache.prune(new Set([hash("a"), hash("c")])), 1);
  assert.equal(cache.prune([hash("a"), hash("c")]), 0);
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
  assert.deepEqual(cache.putMany([]), { added: 0, replaced: 0 });
  for (const bad of [
    { id: "x", hash: "nothex", vector: [1, 2, 3, 4] },
    { id: "x", hash: hash("x"), vector: [1, 2, 3] },
    { id: "x", hash: hash("x"), vector: [1, 2, 3, Number.NaN] },
    { id: "", hash: hash("x"), vector: [1, 2, 3, 4] },
    null,
  ]) {
    assert.throws(
      () => cache.putMany([bad]),
      (error) => error instanceof VectorCacheError && error.code === "invalid_cache_entry",
    );
  }
  assert.throws(
    () => cache.putMany("rows"),
    (error) => error.code === "invalid_cache_entry",
  );
  assert.equal(cache.size, 2);
});

test("starts empty and says why on any mismatch or corruption", (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  open(dir).putMany([entry("a", [1, 2, 3, 4])]);
  assert.equal(
    open(dir, { embedderId: "openai:api.example.com:other:4" }).opened.reason,
    "embedder_mismatch",
  );
  assert.equal(open(dir, { dimension: 8 }).opened.reason, "dimension_mismatch");
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, formatVersion: 99 }));
  assert.equal(open(dir).opened.reason, "format_mismatch");
  fs.writeFileSync(manifestPath, "{ not json");
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, count: "1" }));
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(open(dir).opened.rebuilt, false);

  fs.writeFileSync(path.join(dir, "units.json"), JSON.stringify([]));
  assert.equal(open(dir).opened.reason, "units_corrupt");
  fs.writeFileSync(path.join(dir, "units.json"), JSON.stringify([{ id: "a", hash: hash("a") }]));
  fs.truncateSync(path.join(dir, "vectors.f32"), 8);
  assert.equal(open(dir).opened.reason, "vectors_corrupt");
  fs.unlinkSync(manifestPath);
  assert.equal(open(dir).opened.reason, "manifest_missing");

  // A rebuilt cache overwrites the stale files on its first write.
  const rebuilt = open(dir);
  rebuilt.putMany([entry("fresh", [4, 3, 2, 1])]);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["fresh"],
  );
});

test("recovers when the directory disappears between two writes", (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  cache.putMany([entry("a", [1, 2, 3, 4])]);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(dir), false);
  cache.putMany([entry("b", [5, 6, 7, 8])]);
  const reopened = open(dir);
  assert.deepEqual(reopened.opened, { rebuilt: false, reason: null, rows: 2 });
  assert.deepEqual(
    reopened.all().map((row) => row.id),
    ["a", "b"],
  );
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(cache.prune([hash("a")]), 1);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["a"],
  );
});

test("applies path safety to the cache directory and its files", (t) => {
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

  if (process.platform !== "win32") {
    const dir = path.join(base, "linked");
    open(dir).putMany([entry("a", [1, 2, 3, 4])]);
    const outside = path.join(base, "outside.json");
    fs.copyFileSync(path.join(dir, "manifest.json"), outside);
    fs.unlinkSync(path.join(dir, "manifest.json"));
    fs.symlinkSync(outside, path.join(dir, "manifest.json"));
    const cache = open(dir);
    assert.equal(cache.opened.reason, "manifest_missing");
    cache.putMany([entry("b", [5, 6, 7, 8])]);
    assert.equal(fs.lstatSync(path.join(dir, "manifest.json")).isSymbolicLink(), false);
    assert.equal(JSON.parse(fs.readFileSync(outside, "utf8")).count, 1);
  }
});

test("resolveCacheDir derives a location outside the root and follows the platform", (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const root = path.join(base, "bundle");
  fs.mkdirSync(root);
  const cacheHome = path.join(base, "xdg");
  const realRoot = fs.realpathSync(root);
  const digest = crypto.createHash("sha256").update(realRoot).digest("hex");

  const derived = resolveCacheDir({ root, env: { XDG_CACHE_HOME: cacheHome } });
  assert.equal(derived, path.join(cacheHome, "okf-mcp", digest));
  assert.ok(path.relative(realRoot, derived).startsWith(".."));
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
  assert.ok(path.relative(realRoot, byDefault).startsWith(".."));
  assert.equal(path.basename(byDefault), digest);

  assert.throws(
    () => resolveCacheDir({ root, env: { XDG_CACHE_HOME: root } }),
    (error) => error.code === "cache_inside_root",
  );
  assert.throws(
    () =>
      resolveCacheDir({
        root,
        env: { XDG_CACHE_HOME: path.join(root, "nested") },
      }),
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

  // An explicit cacheDir is the operator's choice, inside the root included.
  assert.equal(
    resolveCacheDir({ root, cacheDir: ".okf-cache" }),
    path.join(path.resolve(root), ".okf-cache"),
  );
  assert.equal(
    resolveCacheDir({ root, cacheDir: path.join(base, "elsewhere") }),
    path.join(base, "elsewhere"),
  );
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
