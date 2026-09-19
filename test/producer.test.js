"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { isConfiguredGeneratorOutput } = require("../src/authoring");
const { loadProjectConfig } = require("../src/project");
const { ProducerService, loadInstalledProducer } = require("../src/producers");
const { normalizeProducedFiles, sha256 } = require("../src/producer-publisher");
const { FileConceptStore } = require("../src/store");
const { callJson, connectMcp } = require("./mcp-client");

function makeProject(extraConfig) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-producer-host-"));
  const bundle = path.join(root, "okf", "database");
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: Producer fixture",
    "bundles:",
    "  - id: database",
    "    root: okf/database",
    "producers:",
    "  - name: primary-db",
    "    type: postgresql",
    "    package: '@fixture/okf-postgres'",
    "    bundle: database",
    "    config:",
    "      connectionEnv: DATABASE_URL",
    extraConfig || "",
    "",
  ].join("\n"), "utf8");
  return { root, bundle, projectPath: path.join(root, "okf.project.yaml") };
}

function output(title) {
  return [
    {
      path: "index.md",
      content: [
        "---",
        "okf_version: \"0.2\"",
        "---",
        "",
        "# Database catalog",
        "",
        "- [Database](database.md)",
        "",
      ].join("\n"),
    },
    {
      path: "database.md",
      content: [
        "---",
        "type: Database",
        `title: ${title || "Application database"}`,
        "description: PostgreSQL database metadata.",
        "sources:",
        "  - resource: postgresql://catalog/application",
        "generated:",
        "  by: process:okf-postgres/0.1.0",
        "  at: 2026-08-20T10:00:00.000Z",
        "---",
        "",
        `# ${title || "Application database"}`,
        "",
      ].join("\n"),
    },
  ];
}

function moduleFor(generate) {
  return {
    okfProducer: {
      apiVersion: "1",
      okfVersion: "0.2",
      id: "postgresql",
      name: "okf-postgres",
      version: "0.1.0",
      relationTypes: ["contains", "contained_by", "foreign_key_to"],
      validateConfig(config) {
        const keys = Object.keys(config);
        return keys.length === 1 && keys[0] === "connectionEnv"
          ? { valid: true, config }
          : { valid: false, diagnostics: [{ code: "unknown_config_key" }] };
      },
      async generate(context) {
        const result = await generate(context);
        return {
          ...result,
          summary: result.summary || { files: result.files.length },
        };
      },
    },
  };
}

function serviceFor(fixture, generate, options) {
  const project = loadProjectConfig(fixture.projectPath);
  assert.deepEqual(project.errors, []);
  const store = FileConceptStore.fromProject(fixture.projectPath);
  return new ProducerService({
    project,
    store,
    loader: async () => moduleFor(generate),
    env: { DATABASE_URL: "postgresql://secret.invalid/application" },
    now: () => new Date("2026-08-20T10:00:00.000Z"),
    ...(options || {}),
  });
}

test("project config normalizes safe producers and rejects ambiguous or unsafe declarations", (t) => {
  const fixture = makeProject([
    "  - name: duplicate",
    "    type: postgresql",
    "    package: ../local-producer",
    "    bundle: database",
    "    output: somewhere",
  ].join("\n"));
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const project = loadProjectConfig(fixture.projectPath);
  assert.equal(project.producers[0].name, "primary-db");
  for (const code of ["invalid_producer_package", "duplicate_producer_bundle", "unknown_producer_field"]) {
    assert.equal(project.errors.some((entry) => entry.code === code), true, code);
  }
  for (const type of ["contains", "contained_by", "foreign_key_to"]) {
    assert.equal(project.relationTypes.includes(type), true);
  }
});

test("producer packages resolve only from the project node_modules tree", (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const packageRoot = path.join(fixture.root, "node_modules", "@fixture", "okf-postgres");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@fixture/okf-postgres",
    version: "0.1.0",
    main: "index.js",
  }));
  fs.writeFileSync(path.join(packageRoot, "index.js"), "module.exports = { okfProducer: { id: 'postgresql' } };\n");
  const project = loadProjectConfig(fixture.projectPath);
  assert.equal(loadInstalledProducer(project, "@fixture/okf-postgres").okfProducer.id, "postgresql");
  assert.throws(
    () => loadInstalledProducer(project, "../okf-postgres"),
    /not installed|installed npm package/,
  );
});

test("producer preview, apply, ownership checks, and stale deletion are safe and deterministic", async (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let files = output().concat({
    path: "stale.md",
    content: output("Stale metadata")[1].content,
  });
  const service = serviceFor(fixture, async ({ getSecret }) => {
    assert.equal(getSecret("DATABASE_URL"), "postgresql://secret.invalid/application");
    return { files };
  });

  const preview = await service.preview("primary-db");
  assert.equal(preview.valid, true, JSON.stringify(preview.diagnostics));
  assert.deepEqual(preview.counts, { create: 3, update: 0, delete: 0, unchanged: 0 });
  assert.equal(fs.readdirSync(fixture.bundle).length, 0);

  const applied = await service.run("primary-db");
  assert.equal(applied.applied, true);
  assert.equal(fs.existsSync(path.join(fixture.bundle, ".okf-producer.json")), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.bundle, ".okf-producer.json"))).files.length, 3);

  const unchangedPath = path.join(fixture.bundle, "database.md");
  const unchangedBefore = fs.statSync(unchangedPath);
  const repeated = await service.run("primary-db");
  const unchangedAfter = fs.statSync(unchangedPath);
  assert.deepEqual(repeated.counts, { create: 0, update: 0, delete: 0, unchanged: 3 });
  assert.equal(unchangedAfter.ino, unchangedBefore.ino);
  assert.equal(unchangedAfter.mtimeMs, unchangedBefore.mtimeMs);

  const beforeRollback = fs.readFileSync(path.join(fixture.bundle, "database.md"), "utf8");
  await assert.rejects(() => service.publisher.publish(
    { type: "postgresql", bundle: "database", version: "0.1.0" },
    normalizeProducedFiles(output("Must roll back").concat({
      path: "stale.md",
      content: output("Stale metadata")[1].content,
    })),
    async () => { throw new Error("persisted validation failed"); },
  ), /persisted validation failed/);
  assert.equal(fs.readFileSync(path.join(fixture.bundle, "database.md"), "utf8"), beforeRollback);

  files = output();
  const stale = await service.run("primary-db");
  assert.equal(stale.applied, true);
  assert.deepEqual(stale.counts, { create: 0, update: 0, delete: 1, unchanged: 2 });
  assert.equal(fs.existsSync(path.join(fixture.bundle, "stale.md")), false);

  fs.appendFileSync(path.join(fixture.bundle, "index.md"), "manual edit\n");
  const modified = await service.preview("primary-db");
  assert.equal(modified.readyToApply, false);
  assert.deepEqual(modified.diagnostics.map((entry) => entry.code), ["producer_owned_file_modified"]);
});

test("strict OKF 0.2 and secret gates reject output without destination changes", async (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const invalid = serviceFor(fixture, async () => ({
    files: output().map((file) => file.path === "database.md"
      ? { path: file.path, content: file.content.replace("description: PostgreSQL database metadata.\n", "") }
      : file),
  }));
  const invalidReceipt = await invalid.run("primary-db");
  assert.equal(invalidReceipt.applied, false);
  assert.equal(invalidReceipt.diagnostics.some((entry) => entry.code === "producer_missing_description"), true);
  assert.deepEqual(fs.readdirSync(fixture.bundle), []);

  const leaking = serviceFor(fixture, async ({ getSecret }) => ({
    files: output().map((file) => file.path === "database.md"
      ? { path: file.path, content: `${file.content}\n${getSecret("DATABASE_URL")}\n` }
      : file),
  }));
  const leakReceipt = await leaking.preview("primary-db");
  assert.deepEqual(leakReceipt.diagnostics.map((entry) => entry.code), ["producer_secret_leak"]);
  assert.doesNotMatch(JSON.stringify(leakReceipt), /secret\.invalid/);
  assert.deepEqual(fs.readdirSync(fixture.bundle), []);
});

test("MCP lists producers statically, gates apply, sanitizes receipts, and reindexes", async (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let loads = 0;
  const producerLoader = async () => {
    loads += 1;
    return moduleFor(async () => ({ files: output() }));
  };
  const disabled = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    producerLoader,
    producerEnv: { DATABASE_URL: "not-returned" },
  });
  const disabledTools = new Map((await disabled.client.listTools()).tools.map((tool) => [tool.name, tool]));
  assert.equal(disabledTools.has("okf_list_producers"), true);
  assert.equal(disabledTools.has("okf_preview_producer"), true);
  assert.equal(disabledTools.has("okf_run_producer"), false);
  const listed = await callJson(disabled.client, "okf_list_producers");
  assert.equal(loads, 0);
  assert.deepEqual(listed.payload, [{
    name: "primary-db",
    type: "postgresql",
    package: "@fixture/okf-postgres",
    bundle: "database",
  }]);
  const preview = await callJson(disabled.client, "okf_preview_producer", { producer: "primary-db", detail: "full" });
  assert.equal(loads, 1);
  assert.equal(preview.payload.readyToApply, true);
  assert.deepEqual(preview.payload.summary, { files: 2 });
  assert.deepEqual(preview.payload.changes.create, ["database.md", "index.md"]);
  assert.equal(JSON.stringify(preview.payload).includes("content"), false);
  await disabled.close();

  const broken = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    producerLoader: async () => { throw new Error(`${fixture.root}/DATABASE_URL=not-returned`); },
    producerEnv: { DATABASE_URL: "not-returned" },
  });
  const failedPreview = await callJson(broken.client, "okf_preview_producer", { producer: "primary-db" });
  assert.equal(failedPreview.result.isError, true);
  assert.doesNotMatch(JSON.stringify(failedPreview.payload), /not-returned|okf-producer-host-/);
  await broken.close();

  const enabled = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    producerLoader,
    producerEnv: { DATABASE_URL: "not-returned" },
    allowWrite: true,
    actor: "test/producer-host",
  });
  const enabledTools = new Map((await enabled.client.listTools()).tools.map((tool) => [tool.name, tool]));
  assert.equal(enabledTools.get("okf_run_producer").annotations.destructiveHint, true);
  const run = await callJson(enabled.client, "okf_run_producer", { producer: "primary-db" });
  assert.equal(run.result.isError, undefined);
  assert.equal(run.payload.applied, true);
  assert.equal(run.payload.changes, undefined);
  const concept = await callJson(enabled.client, "get_concept", { uri: "okf://database/database" });
  assert.equal(concept.payload.title, "Application database");
});

test("producer-managed bundle roots are protected from ordinary authoring", (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const project = loadProjectConfig(fixture.projectPath);
  assert.equal(isConfiguredGeneratorOutput(project, path.join(fixture.bundle, "anything.md")), true);
});

test("an unchanged source keeps published bytes instead of restamping every file", async (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let stamp = "2026-08-20T10:00:00.000Z";
  const generate = async () => ({ files: output() });
  const service = () => serviceFor(fixture, generate, { now: () => new Date(stamp) });

  const first = await service().run("primary-db");
  assert.equal(first.applied, true);
  assert.deepEqual(first.counts, { create: 2, update: 0, delete: 0, unchanged: 0 });

  const conceptPath = path.join(fixture.bundle, "database.md");
  const published = fs.readFileSync(conceptPath, "utf8");
  const manifestPath = path.join(fixture.bundle, ".okf-producer.json");
  const manifest = fs.readFileSync(manifestPath, "utf8");

  // Only the generation stamp moves; the catalog must not churn.
  stamp = "2026-09-01T12:30:00.000Z";
  const second = await service().run("primary-db");
  assert.equal(second.applied, true);
  assert.deepEqual(second.counts, { create: 0, update: 0, delete: 0, unchanged: 2 });
  assert.equal(fs.readFileSync(conceptPath, "utf8"), published);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), manifest);

  // A real content change still publishes.
  const changed = await serviceFor(fixture, async () => ({ files: output("Renamed database") }), {
    now: () => new Date(stamp),
  }).run("primary-db");
  assert.equal(changed.applied, true);
  assert.deepEqual(changed.counts, { create: 0, update: 1, delete: 0, unchanged: 1 });
  assert.match(fs.readFileSync(conceptPath, "utf8"), /Renamed database/);
});

test("a manifest claim cannot rewrite or remove a concept without generation provenance", async (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const generate = async () => ({ files: output() });
  assert.equal((await serviceFor(fixture, generate).run("primary-db")).applied, true);

  const handAuthored = path.join(fixture.bundle, "hand-authored.md");
  fs.writeFileSync(handAuthored, [
    "---",
    "type: Note",
    "title: Hand authored",
    "description: Never producer managed.",
    "---",
    "",
    "# Hand authored",
    "",
  ].join("\n"), "utf8");
  const manifestPath = path.join(fixture.bundle, ".okf-producer.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.push({ path: "hand-authored.md", sha256: sha256(fs.readFileSync(handAuthored)) });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result = await serviceFor(fixture, generate).run("primary-db");
  assert.equal(result.applied, false);
  assert.equal(result.diagnostics.some((entry) => entry.code === "producer_manifest_claims_unmanaged_file"), true);
  assert.equal(fs.existsSync(handAuthored), true);
});

test("publication prunes directories emptied by stale deletions", async (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const nested = () => output().concat([{
    path: "views/public/report.md",
    content: output()[1].content.replace("Application database", "Report view"),
  }]);
  assert.equal((await serviceFor(fixture, async () => ({ files: nested() })).run("primary-db")).applied, true);
  assert.equal(fs.existsSync(path.join(fixture.bundle, "views", "public")), true);

  const pruned = await serviceFor(fixture, async () => ({ files: output() })).run("primary-db");
  assert.equal(pruned.applied, true);
  assert.deepEqual(pruned.changes.delete, ["views/public/report.md"]);
  assert.equal(fs.existsSync(path.join(fixture.bundle, "views")), false);
});

test("workspace and linked producer installs resolve through their node_modules entry", (t) => {
  const fixture = makeProject();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  // A workspace install links node_modules/<name> at the real package directory.
  const real = path.join(fixture.root, "packages", "okf-postgres");
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, "package.json"), JSON.stringify({
    name: "@fixture/okf-postgres",
    version: "0.1.0",
    main: "index.js",
  }));
  fs.writeFileSync(path.join(real, "index.js"), "module.exports = { okfProducer: { id: 'postgresql' } };\n");
  const linkParent = path.join(fixture.root, "node_modules", "@fixture");
  fs.mkdirSync(linkParent, { recursive: true });
  fs.symlinkSync(real, path.join(linkParent, "okf-postgres"), "dir");

  const project = loadProjectConfig(fixture.projectPath);
  assert.equal(loadInstalledProducer(project, "@fixture/okf-postgres").okfProducer.id, "postgresql");
  assert.throws(
    () => loadInstalledProducer(project, "@fixture/not-installed"),
    /not installed/,
  );
});
