"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { attachProject, buildIndex, indexUpdateStats } = require("../src/indexer");
const { LiveAuthoringService } = require("../src/live-authoring");
const { callTool, createStateAsync } = require("../src/mcp/server");
const { FileConceptStore } = require("../src/store");

// The write paths over the incremental index: what the MCP server state and
// the live authoring service hold between batches, and what each sees of
// files changed outside them.

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConcept(root, relativePath, title, extra) {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `---\ntype: Reference\ntitle: ${title}\n${extra || ""}---\n\n# ${title}\n`,
  );
}

function seedRoot(prefix, count) {
  const root = makeRoot(prefix);
  for (let index = 0; index < count; index += 1) {
    writeConcept(root, `reference/seed-${index}.md`, `Seed ${index}`);
  }
  return root;
}

function freshStateIndex(state) {
  return attachProject(
    buildIndex(state.localBundleArgs.concat(state.remoteBundles), {
      relationTypes: state.relationTypes,
      strictLinks: state.strictLinks,
      allowCustomRelationTypes: state.allowCustomRelationTypes,
    }),
    state.project,
  );
}

const BATCH = (bundle, suffix) => ({
  changes: [
    {
      op: "create",
      path: `reference/linked-${suffix}.md`,
      type: "Reference",
      title: `Linked ${suffix}`,
      relations: [{ type: "related_to", target: `okf://${bundle}/reference/seed-1` }],
      body: `# Linked ${suffix}\n\nSee [seed](seed-2.md) and [later](later-${suffix}.md).`,
    },
    {
      op: "create",
      path: `reference/later-${suffix}.md`,
      type: "Reference",
      title: `Later ${suffix}`,
    },
  ],
});

test("the MCP server index after okf_apply_changes equals a fresh build", async (t) => {
  const root = seedRoot("okf-index-mcp-", 30);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.basename(root);
  const state = await createStateAsync([], { rootPath: root, allowWrite: true, actor: "test/wp2" });
  assert.equal(state.shareLiveIndex, true);
  const before = state.index;

  const first = await callTool(state, "okf_apply_changes", BATCH(bundle, "one"));
  assert.equal(JSON.parse(first.content[0].text).applied, true);
  assert.notEqual(state.index, before);
  assert.equal(indexUpdateStats(state.index).mode, "incremental");
  assert.deepEqual(state.index, freshStateIndex(state));

  // A create that sorts before the concept the same batch updates.
  const update = await callTool(state, "okf_apply_changes", {
    changes: [
      { op: "create", path: "reference/aaa-first.md", type: "Reference", title: "First" },
      { op: "update", uri: `okf://${bundle}/reference/seed-2`, title: "Seed two, renamed" },
    ],
  });
  assert.equal(JSON.parse(update.content[0].text).applied, true);
  assert.equal(indexUpdateStats(state.index).mode, "incremental");
  assert.deepEqual(state.index, freshStateIndex(state));

  // A validation-only call leaves the server index alone.
  const validated = await callTool(state, "okf_validate_changes", BATCH(bundle, "two"));
  assert.equal(JSON.parse(validated.content[0].text).valid, true);
  assert.deepEqual(state.index, freshStateIndex(state));
});

test("a server whose live service builds with other options applies the batch to its own index", async (t) => {
  const root = seedRoot("okf-index-mcp-own-", 30);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.basename(root);
  const service = new LiveAuthoringService(FileConceptStore.fromRoot(root, { strictLinks: true }), {
    actor: "test/wp2",
  });
  const state = await createStateAsync([], {
    rootPath: root,
    allowWrite: true,
    actor: "test/wp2",
    liveAuthoringService: service,
  });
  assert.equal(state.shareLiveIndex, false);
  const result = await callTool(state, "okf_apply_changes", BATCH(bundle, "own"));
  assert.equal(JSON.parse(result.content[0].text).applied, true);
  assert.equal(state.index.strictLinks, false);
  assert.equal(indexUpdateStats(state.index).mode, "incremental");
  assert.deepEqual(state.index, freshStateIndex(state));
});

test("the live service sees files changed outside it between batches", async (t) => {
  const root = seedRoot("okf-index-external-", 12);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.basename(root);
  const service = new LiveAuthoringService(FileConceptStore.fromRoot(root), { actor: "test/wp2" });
  const first = await service.applyChanges({
    changes: [{ op: "create", path: "reference/first.md", type: "Reference", title: "First" }],
  });
  assert.equal(first.applied, true);

  writeConcept(root, "reference/external.md", "External");
  fs.unlinkSync(path.join(root, "reference/seed-3.md"));
  const second = await service.applyChanges({
    changes: [
      {
        op: "create",
        path: "reference/second.md",
        type: "Reference",
        title: "Second",
        relations: [{ type: "related_to", target: `okf://${bundle}/reference/external` }],
      },
    ],
  });
  assert.equal(second.applied, true, JSON.stringify(second.validation.diagnostics));
  assert.ok(!second.validation.diagnostics.some((entry) => entry.code === "broken_relation"));
  // The externally deleted concept is gone from the refreshed index too, so
  // the update is refused as unknown instead of failing on the missing file.
  await assert.rejects(
    service.applyChanges({
      changes: [{ op: "update", uri: `okf://${bundle}/reference/seed-3`, title: "Gone" }],
    }),
    (error) => error.code === "concept_not_found",
  );
  const validated = await service.validateChanges({
    changes: [{ op: "update", uri: `okf://${bundle}/reference/seed-3`, title: "Gone" }],
  });
  assert.equal(validated.valid, false);
  assert.equal(validated.code, "concept_not_found");
});

// Regression: an edit with the same byte length and the same mtime survives
// the refresh; the update then noticed the revision mismatch but left the
// stale index in place, so every retry failed the same way.
test("an edit the refresh cannot see is re-read once and the update applies", async (t) => {
  const root = seedRoot("okf-index-stale-", 4);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.basename(root);
  const uri = `okf://${bundle}/reference/seed-2`;
  const file = path.join(root, "reference/seed-2.md");
  // Pin the mtime so a rewrite can restore it exactly, then let the service
  // index the file.
  const pinned = new Date("2026-01-01T00:00:00Z");
  fs.utimesSync(file, pinned, pinned);
  const service = new LiveAuthoringService(FileConceptStore.fromRoot(root), { actor: "test/wp2" });
  const first = await service.applyChanges({
    changes: [{ op: "create", path: "reference/first.md", type: "Reference", title: "First" }],
  });
  assert.equal(first.applied, true);
  const indexedText = service.currentIndex([]).byPathUri.get(`${uri}.md`).text;
  const edited = indexedText.replace("title: Seed 2", "title: Seed Z");
  assert.equal(Buffer.byteLength(edited), Buffer.byteLength(indexedText));
  fs.writeFileSync(file, edited);
  fs.utimesSync(file, pinned, pinned);
  // The refresh has nothing to go on; the index is stale.
  assert.equal(service.currentIndex([]).byPathUri.get(`${uri}.md`).text, indexedText);

  const update = await service.applyChanges({
    changes: [{ op: "update", uri, description: "Updated" }],
  });
  assert.equal(update.applied, true, JSON.stringify(update.validation?.diagnostics));
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.includes("title: Seed Z") && text.includes("description: Updated"));
  assert.deepEqual(service.currentIndex([]), service.buildIndex([]));

  // When the file changes again between the re-read and the plan (here: the
  // re-read brings nothing new), the caller gets a conflict that carries the
  // revision now on disk, not a retry.
  fs.utimesSync(file, pinned, pinned);
  const racing = new LiveAuthoringService(FileConceptStore.fromRoot(root), { actor: "test/wp2" });
  racing.currentIndex([]);
  racing.indexCache.update = (index) => index;
  fs.writeFileSync(file, text.replace("title: Seed Z", "title: Seed Y"));
  fs.utimesSync(file, pinned, pinned);
  const again = { changes: [{ op: "update", uri, description: "Again" }] };
  const onDisk = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
  await assert.rejects(
    racing.applyChanges(again),
    (error) => error.code === "concept_changed" && error.details.revision === onDisk,
  );
  const validated = await racing.validateChanges(again);
  assert.equal(validated.valid, false);
  assert.equal(validated.code, "concept_changed");
  assert.equal(validated.details.revision, onDisk);
});

// Regression: a server whose index is not the service's replayed only the
// batch onto its previous index, so files changed outside the service never
// reached search or the graph.
test("a server with its own index sees external changes with each live batch", async (t) => {
  const root = seedRoot("okf-index-mcp-external-", 20);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.basename(root);
  const service = new LiveAuthoringService(FileConceptStore.fromRoot(root, { strictLinks: true }), {
    actor: "test/wp2",
  });
  const state = await createStateAsync([], {
    rootPath: root,
    allowWrite: true,
    actor: "test/wp2",
    liveAuthoringService: service,
  });
  assert.equal(state.shareLiveIndex, false);
  writeConcept(root, "reference/outside.md", "Outside");
  fs.unlinkSync(path.join(root, "reference/seed-4.md"));
  const result = await callTool(state, "okf_apply_changes", BATCH(bundle, "external"));
  assert.equal(JSON.parse(result.content[0].text).applied, true);
  assert.ok(state.index.byPathUri.has(`okf://${bundle}/reference/outside.md`));
  assert.equal(state.index.byPathUri.has(`okf://${bundle}/reference/seed-4.md`), false);
  assert.deepEqual(state.index, freshStateIndex(state));
});

// Regression: persisted validation re-read only the batch targets, so a
// dependency removed between planning and publication went unnoticed.
test("persisted validation sees a dependency removed after planning and rolls back", async (t) => {
  const root = seedRoot("okf-index-persist-", 8);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.basename(root);
  // The first validation is the plan's; the dependency vanishes right after
  // it, before the files are published.
  class Interposed extends LiveAuthoringService {
    validationResult(index, candidates) {
      const result = super.validationResult(index, candidates);
      this.validations = (this.validations || 0) + 1;
      if (this.validations === 1) {
        fs.unlinkSync(path.join(root, "reference/seed-1.md"));
      }
      return result;
    }
  }
  const service = new Interposed(FileConceptStore.fromRoot(root), { actor: "test/wp2" });
  const result = await service.applyChanges({
    changes: [
      {
        op: "create",
        path: "reference/needs-seed.md",
        type: "Reference",
        title: "Needs seed",
        relations: [{ type: "related_to", target: `okf://${bundle}/reference/seed-1` }],
      },
    ],
  });
  assert.equal(result.applied, false);
  assert.equal(result.status, "rolled_back");
  assert.ok(result.validation.diagnostics.some((entry) => entry.code === "broken_relation"));
  assert.equal(fs.existsSync(path.join(root, "reference/needs-seed.md")), false);
  const again = await service.applyChanges({
    changes: [{ op: "create", path: "reference/plain.md", type: "Reference", title: "Plain" }],
  });
  assert.equal(again.applied, true);
  assert.deepEqual(service.currentIndex([]), service.buildIndex([]));
});

// Regression: the cached index was keyed by snapshot ids, so a replacement
// snapshot under an existing id kept the old content.
test("a replacement remote snapshot under the same id invalidates the cached index", async (t) => {
  const root = seedRoot("okf-index-snapshot-", 6);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new LiveAuthoringService(FileConceptStore.fromRoot(root), { actor: "test/wp2" });
  const snapshot = (names) => ({
    id: "remote",
    remote: true,
    documents: names.map((name) => ({
      path: `${name}.md`,
      text: `---\ntype: Concept\ntitle: ${name}\n---\n\n# ${name}\n`,
    })),
  });
  const first = snapshot(["notes"]);
  const second = snapshot(["notes", "extra"]);
  const batch = {
    changes: [
      {
        op: "create",
        path: "reference/links-remote.md",
        type: "Reference",
        title: "Links remote",
        relations: [{ type: "related_to", target: "okf://remote/extra" }],
      },
    ],
  };
  const before = await service.validateChanges(batch, { additionalBundles: [first] });
  assert.equal(before.valid, false);
  const after = await service.validateChanges(batch, { additionalBundles: [second] });
  assert.equal(after.valid, true);
  // The same snapshot object keeps its index; the old one is rebuilt.
  const kept = service.currentIndex([second]);
  assert.equal(service.currentIndex([second]), kept);
  assert.equal(service.currentIndex([first]).byUri.has("okf://remote/extra"), false);
});
