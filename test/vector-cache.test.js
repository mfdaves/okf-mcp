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
const POSIX_ONLY =
  process.platform === "win32" ? "symbolic links need privileges on Windows" : false;

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

function dataFiles(dir) {
  return fs.readdirSync(dir).sort();
}

test("round-trips rows through a generation of files and reopens them", (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  assert.deepEqual(cache.opened, { rebuilt: true, reason: "missing", rows: 0 });
  assert.equal(cache.size, 0);
  assert.deepEqual(
    cache.putMany([entry("a", [1, 2, 3, 4]), entry("b", new Float32Array([5, 6, 7, 8]))]),
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
    "updatedAt",
  ]);
  assert.equal(manifest.format, VECTOR_CACHE_FORMAT);
  assert.equal(manifest.formatVersion, VECTOR_CACHE_FORMAT_VERSION);
  assert.equal(manifest.embedderId, EMBEDDER);
  assert.equal(manifest.dimension, 4);
  assert.equal(manifest.count, 2);
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

test("upserts by hash, prunes by hash, keeps earlier views, and collects old generations", (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  cache.putMany([entry("a", [1, 1, 1, 1]), entry("b", [2, 2, 2, 2]), entry("c", [3, 3, 3, 3])]);
  const first = manifestOf(dir).generation;
  const before = cache.get(hash("c"));
  assert.deepEqual(cache.putMany([{ id: "renamed", hash: hash("b"), vector: [9, 9, 9, 9] }]), {
    added: 0,
    replaced: 1,
  });
  const second = manifestOf(dir).generation;
  assert.notEqual(second, first);
  assert.deepEqual(dataFiles(dir), [
    "manifest.json",
    `units.${second}.json`,
    `vectors.${second}.f32`,
  ]);
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
  assert.equal(dataFiles(dir).length, 3);
});

test("starts empty and says why on any mismatch, corruption or tampering", (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  open(dir).putMany([entry("a", [1, 2, 3, 4]), entry("b", [5, 6, 7, 8])]);
  assert.equal(
    open(dir, { embedderId: "openai:api.example.com:other:4" }).opened.reason,
    "embedder_mismatch",
  );
  assert.equal(open(dir, { dimension: 8 }).opened.reason, "dimension_mismatch");
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = manifestOf(dir);
  const writeManifest = (value) => fs.writeFileSync(manifestPath, JSON.stringify(value));

  writeManifest({ ...manifest, formatVersion: 99 });
  assert.equal(open(dir).opened.reason, "format_mismatch");
  fs.writeFileSync(manifestPath, "{ not json");
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  writeManifest({ ...manifest, count: "1" });
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  writeManifest({ ...manifest, files: { ...manifest.files, units: "../units.json" } });
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  writeManifest({ ...manifest, digests: undefined });
  assert.equal(open(dir).opened.reason, "manifest_corrupt");
  writeManifest(manifest);
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

  // A rebuilt cache leaves only its own generation behind on its first write.
  const rebuilt = open(dir);
  rebuilt.putMany([entry("fresh", [4, 3, 2, 1])]);
  assert.deepEqual(
    open(dir)
      .all()
      .map((row) => row.id),
    ["fresh"],
  );
  assert.equal(dataFiles(dir).length, 3);
});

test("an interrupted write never pairs rows of one generation with vectors of another", (t) => {
  const dir = path.join(tempDir(t, "okf-vector-cache-"), "cache");
  const cache = open(dir);
  cache.putMany([entry("a", [1, 1, 1, 1]), entry("b", [2, 2, 2, 2])]);
  const committed = manifestOf(dir);

  // Data files of a newer generation landed, the manifest did not: the
  // committed generation is what opens, and the orphans go on the next write.
  const orphan = "zzzzzzzz-deadbeef";
  fs.writeFileSync(
    path.join(dir, `units.${orphan}.json`),
    JSON.stringify([
      { id: "a", hash: hash("a") },
      { id: "c", hash: hash("c") },
    ]),
  );
  const newer = Buffer.alloc(2 * 4 * 4);
  for (let index = 0; index < 8; index += 1) newer.writeFloatLE(9, index * 4);
  fs.writeFileSync(path.join(dir, `vectors.${orphan}.f32`), newer);
  const reopened = open(dir);
  assert.deepEqual(reopened.opened, { rebuilt: false, reason: null, rows: 2 });
  assert.deepEqual(
    reopened.all().map((row) => [row.id, Array.from(row.vector)]),
    [
      ["a", [1, 1, 1, 1]],
      ["b", [2, 2, 2, 2]],
    ],
  );
  reopened.putMany([entry("d", [4, 4, 4, 4])]);
  const current = manifestOf(dir);
  assert.deepEqual(dataFiles(dir), [
    "manifest.json",
    `units.${current.generation}.json`,
    `vectors.${current.generation}.f32`,
  ]);

  // The reverse: a manifest for a generation whose files never landed.
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      ...committed,
      generation: orphan,
      files: { units: `units.${orphan}.json`, vectors: `vectors.${orphan}.f32` },
    }),
  );
  assert.equal(open(dir).opened.reason, "units_corrupt");

  // And a manifest whose digests describe other bytes than the files hold.
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ ...current, digests: committed.digests }),
  );
  assert.equal(open(dir).opened.reason, "integrity_mismatch");
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
});

test("refuses a symlinked cache directory, resolves linked ancestors, never follows linked files", {
  skip: POSIX_ONLY,
}, (t) => {
  const base = tempDir(t, "okf-vector-cache-");
  const real = path.join(base, "real");
  fs.mkdirSync(real);
  open(real).putMany([entry("a", [1, 2, 3, 4])]);

  // The directory itself must not be a link, whether it opens or writes.
  const link = path.join(base, "link");
  fs.symlinkSync(real, link);
  assert.throws(
    () => open(link),
    (error) => error.code === "invalid_cache_dir",
  );
  const live = open(path.join(base, "later"));
  fs.symlinkSync(real, path.join(base, "later"));
  assert.throws(
    () => live.putMany([entry("b", [5, 6, 7, 8])]),
    (error) => error.code === "invalid_cache_dir",
  );
  assert.equal(open(real).size, 1, "nothing was written through the link");

  // Ancestors may be links; the store works on the real location.
  const parentLink = path.join(base, "parent-link");
  fs.symlinkSync(base, parentLink);
  const viaParent = open(path.join(parentLink, "nested", "cache"));
  assert.equal(viaParent.dir, path.join(base, "nested", "cache"));
  viaParent.putMany([entry("c", [1, 1, 1, 1])]);
  assert.equal(open(path.join(base, "nested", "cache")).size, 1);

  // A linked manifest is treated as missing and replaced by a regular file.
  const outside = path.join(base, "outside.json");
  fs.copyFileSync(path.join(real, "manifest.json"), outside);
  fs.unlinkSync(path.join(real, "manifest.json"));
  fs.symlinkSync(outside, path.join(real, "manifest.json"));
  const cache = open(real);
  assert.equal(cache.opened.reason, "manifest_missing");
  cache.putMany([entry("b", [5, 6, 7, 8])]);
  assert.equal(fs.lstatSync(path.join(real, "manifest.json")).isSymbolicLink(), false);
  assert.equal(JSON.parse(fs.readFileSync(outside, "utf8")).count, 1);
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
