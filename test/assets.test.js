"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildAssetRegistry,
  classifyAssetContent,
  collectAssetReferences,
  isLocalAssetReference,
  mimeTypeForPath,
  resolveBundleAssetPath,
} = require("../src/assets");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  return absolutePath;
}

function document(root, frontmatter, extra) {
  return Object.assign({
    bundle: "finance",
    bundleRoot: root,
    path: "metrics/revenue.md",
    uri: "okf://finance/metrics/revenue",
    frontmatter: frontmatter || {},
  }, extra || {});
}

test("collects only explicit bundle-local references with stable roles and fields", () => {
  const references = collectAssetReferences(document("/bundle", {
    resource: "../schemas/revenue.json",
    sources: [
      { resource: "/policies/revenue.md" },
      { resource: "references/dashboard.md" },
      { resource: "https://example.com/policy" },
      { resource: "repo://finance/policy" },
      { resource: "all queries in BigQuery project finance" },
      { resource: "dashboards/exec-revenue" },
    ],
    computation: "../computations/revenue.sql",
    executor: { resource: "../skills/run.md", receipt: ["job_id"] },
    attester: { resource: "../attesters/check.py" },
  }));

  assert.deepEqual(references.map((reference) => [reference.role, reference.field, reference.value]), [
    ["resource", "resource", "../schemas/revenue.json"],
    ["source", "sources[0].resource", "/policies/revenue.md"],
    ["source", "sources[1].resource", "references/dashboard.md"],
    ["computation", "computation", "../computations/revenue.sql"],
    ["executor", "executor.resource", "../skills/run.md"],
    ["attester", "attester.resource", "../attesters/check.py"],
  ]);
  assert.equal(isLocalAssetReference("policy.md", { allowBare: false }), true);
  assert.equal(isLocalAssetReference("artifacts/evidence.parquet", { allowBare: false }), true);
  assert.equal(isLocalAssetReference("dashboards/exec-revenue", { allowBare: false }), false);
  assert.equal(isLocalAssetReference("project.dataset.table", { allowBare: false }), false);
  assert.equal(isLocalAssetReference("all queries in project X", { allowBare: false }), false);
  assert.equal(isLocalAssetReference("https://example.com/a.sql", { allowBare: true }), false);
});

test("collects references from normalized semantic metadata without raw frontmatter", () => {
  const references = collectAssetReferences({
    bundle: "finance",
    path: "metrics/revenue.md",
    uri: "okf://finance/metrics/revenue",
    frontmatter: {
      sources: [{ resource: "../policies/raw.md" }],
    },
    signals: {
      resource: "../schemas/revenue.json",
      sources: [{ resource: "../policies/revenue.md", valid: true }],
      computation: {
        computation: { mode: "file", path: "../computations/revenue.sql" },
        executor: { resource: "../skills/run.md" },
        attester: { resource: "../attesters/check.py" },
      },
    },
  });

  assert.deepEqual(references.map((reference) => reference.role), [
    "resource",
    "source",
    "computation",
    "executor",
    "attester",
  ]);
  assert.equal(references.find((reference) => reference.role === "source").value, "../policies/revenue.md");
});

test("resolves relative and bundle-root paths without permitting traversal", () => {
  const relative = resolveBundleAssetPath("/tmp/bundle", "metrics/revenue.md", "../computations/revenue.sql");
  assert.equal(relative.path, "computations/revenue.sql");
  assert.equal(relative.absolutePath, path.resolve("/tmp/bundle/computations/revenue.sql"));

  const rooted = resolveBundleAssetPath("/tmp/bundle", "metrics/revenue.md", "/references/policy.md");
  assert.equal(rooted.path, "references/policy.md");

  assert.throws(
    () => resolveBundleAssetPath("/tmp/bundle", "metrics/revenue.md", "../../outside.sql"),
    (error) => error.code === "asset_outside_root",
  );
  assert.throws(
    () => resolveBundleAssetPath("/tmp/bundle", "metrics/revenue.md", "https://example.com/query.sql"),
    (error) => error.code === "asset_invalid_reference",
  );
});

test("registers only referenced files and aggregates hashes, roles, and referencers", (t) => {
  const root = fixture(t);
  const sql = "SELECT SUM(amount) AS revenue\n";
  write(root, "computations/revenue.sql", sql);
  write(root, "skills/run.md", "# Run\n");
  write(root, "unreferenced/ignored.py", "raise RuntimeError('must not load')\n");

  const result = buildAssetRegistry([
    document(root, {
      resource: "bigquery://finance/revenue",
      sources: [{ resource: "../computations/revenue.sql" }],
      computation: "../computations/revenue.sql",
      executor: { resource: "../skills/run.md" },
    }),
  ], [{ id: "finance", root }]);

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.assets.map((asset) => asset.path), [
    "computations/revenue.sql",
    "skills/run.md",
  ]);
  const computation = result.byKey.get("finance:computations/revenue.sql");
  assert.ok(computation);
  assert.equal(computation.kind, "text");
  assert.equal(computation.encoding, "utf-8");
  assert.equal(computation.text, sql);
  assert.equal(computation.mimeType, "application/sql");
  assert.equal(computation.size, Buffer.byteLength(sql));
  assert.equal(
    computation.sha256,
    `sha256:${crypto.createHash("sha256").update(sql).digest("hex")}`,
  );
  assert.deepEqual(computation.roles, ["computation", "source"]);
  assert.deepEqual(computation.referencedBy.map((reference) => reference.field), [
    "computation",
    "sources[0].resource",
  ]);
  assert.equal(result.assets.some((asset) => asset.path.includes("unreferenced")), false);
});

test("rejects missing, escaping, and symlinked asset paths without reading them", (t) => {
  const root = fixture(t);
  write(root, "safe/check.py", "print('safe')\n");
  fs.symlinkSync(path.join(root, "safe", "check.py"), path.join(root, "linked.py"));
  fs.symlinkSync(path.join(root, "safe"), path.join(root, "linked-dir"));

  const result = buildAssetRegistry([
    document(root, {
      computation: "../../outside.sql",
      executor: { resource: "../missing/run.md" },
      attester: { resource: "../linked.py" },
      resource: "../linked-dir/check.py",
    }),
  ], [{ id: "finance", root }]);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code).sort();

  assert.deepEqual(result.assets, []);
  assert.deepEqual(codes, [
    "asset_missing",
    "asset_outside_root",
    "asset_symlink",
    "asset_symlink",
  ]);
});

test("enforces byte limits and classifies text with fatal UTF-8 decoding", (t) => {
  const root = fixture(t);
  write(root, "computations/large.sql", "SELECT 12345");
  write(root, "computations/invalid.sql", Buffer.from([0xc3, 0x28]));
  write(root, "images/pixel.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

  const limited = buildAssetRegistry([
    document(root, { computation: "../computations/large.sql" }),
  ], [{ id: "finance", root }], { maxAssetBytes: 4 });
  assert.deepEqual(limited.assets, []);
  assert.equal(limited.diagnostics[0].code, "asset_too_large");

  const classified = buildAssetRegistry([
    document(root, {
      computation: "../computations/invalid.sql",
      resource: "../images/pixel.png",
    }),
  ], [{ id: "finance", root }]);
  assert.equal(classified.assets.length, 2);
  const invalidSql = classified.byKey.get("finance:computations/invalid.sql");
  const png = classified.byKey.get("finance:images/pixel.png");
  assert.equal(invalidSql.kind, "binary");
  assert.equal(invalidSql.text, null);
  assert.equal(png.kind, "binary");
  assert.equal(png.mimeType, "image/png");
  assert.deepEqual(classified.diagnostics.map((diagnostic) => diagnostic.code), ["asset_invalid_utf8"]);

  assert.deepEqual(classifyAssetContent(Buffer.from("plain text"), "application/octet-stream"), {
    kind: "text",
    encoding: "utf-8",
    text: "plain text",
    validUtf8: true,
  });
  const bomBytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);
  const bomText = classifyAssetContent(bomBytes, "text/plain");
  assert.equal(bomText.text, "\ufeffa");
  assert.deepEqual(Buffer.from(bomText.text, "utf8"), bomBytes);
  assert.equal(mimeTypeForPath("query.SQL"), "application/sql");
  assert.throws(
    () => buildAssetRegistry([], [], { maxAssetBytes: 0 }),
    /positive safe integer/,
  );
});

test("external references and opaque source descriptors never trigger loading", () => {
  const result = buildAssetRegistry([
    document("", {
      resource: "https://example.com/schema.json",
      sources: [
        { resource: "all queries in BigQuery project finance" },
        { resource: "urn:finance:policy" },
      ],
      computation: "gs://finance/query.sql",
      executor: { resource: "repo://skills/run" },
      attester: { resource: "https://example.com/check.py" },
    }),
  ], []);

  assert.deepEqual(result.assets, []);
  assert.deepEqual(result.diagnostics, []);
});

test("asset policy excludes referenced paths before content is indexed", (t) => {
  const root = fixture(t);
  write(root, "references/blocked.txt", "blocked");
  const doc = document(root, { type: "Spec", resource: "../references/blocked.txt" });
  const result = buildAssetRegistry([doc], [{ id: "finance", root }], {
    allowResolvedPath: (_bundle, relativePath) => relativePath !== "references/blocked.txt",
  });
  assert.equal(result.assets.length, 0);
  assert.equal(result.diagnostics.some((entry) => entry.code === "asset_excluded"), true);
});
