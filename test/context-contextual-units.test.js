"use strict";

// WP3c-2 step 2: contextual units. The prefix is bounded and formatted as specified, plain
// unit hashes are unchanged from 0.11.0-rc.2, contextual sections keep the plain anchors, a
// fixture embeds in one request per batch through the fake OpenAI-compatible server, a body
// edit re-embeds only its section, and switching embedUnits re-embeds once and says so.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  conceptSections,
  contextualSectionUnits,
  sectionUnits,
} = require("../src/context/sections");
const {
  CONTEXT_PREFIX_MAX,
  conceptUnitText,
  conceptUnits,
  contextPrefix,
  contextualConceptUnits,
  hashUnitText,
} = require("../src/embed/units");
const { buildProjectIndex } = require("../src/indexer");
const { normalizeEmbeddingConfig } = require("../src/search/embedding-config");
const { EMBED_UNITS, resolveUnits } = require("../src/search/dense");
const { openEmbeddingRuntime } = require("../src/search/hybrid");
const { startFakeEmbeddingsServer } = require("./fake-embeddings-server");

const RETRIEVAL = path.join(__dirname, "fixtures", "retrieval");

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function copyFixture(t, name) {
  const target = path.join(tempDir(t, `okf-contextual-${name}-`), name);
  fs.cpSync(path.join(RETRIEVAL, name), target, { recursive: true });
  return path.join(target, "okf.project.yaml");
}

test("the context prefix is title · type · path, bounded at 160 characters", () => {
  assert.equal(CONTEXT_PREFIX_MAX, 160);
  assert.equal(
    contextPrefix(["Ski boots", "Product", "products/ski.md"]),
    "Ski boots · Product · products/ski.md",
  );
  // Whitespace collapses, empty and missing parts are dropped.
  assert.equal(contextPrefix(["  Ski \n boots ", "", null, "p.md"]), "Ski boots · p.md");
  assert.equal(contextPrefix([undefined, "", "  "]), "");
  // A long title is shortened with an ellipsis; type and path stay whole.
  const title = "A very long title ".repeat(20);
  const path160 = contextPrefix([title, "Data Contract", "contracts/account-created-v1.md"]);
  assert.ok(path160.length <= 160, `${path160.length}`);
  assert.equal(path160.length, 160);
  assert.match(
    path160,
    /^A very long title.*… · Data Contract · contracts\/account-created-v1\.md$/,
  );
  // When type and path alone leave no room for the title, the whole prefix is cut.
  const longPath = `${"deep/".repeat(40)}leaf.md`;
  const cut = contextPrefix(["Title", "Type", longPath]);
  assert.equal(cut.length, 160);
  assert.ok(cut.endsWith("…"));
  assert.ok(cut.startsWith("Title · Type · deep/"));
  // A cut never splits a surrogate pair.
  const emoji = contextPrefix(["😀".repeat(200)]);
  assert.ok(emoji.length <= 160);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(emoji), "no lone high surrogate");
  assert.equal(contextPrefix(["abcdef"], 4), "abc…");
});

test("plain unit hashes are unchanged and contextual units keep the anchors", () => {
  const record = JSON.parse(
    fs.readFileSync(path.join(RETRIEVAL, "rc2-hybrid-golden.json"), "utf8"),
  );
  const digest = (units) =>
    crypto
      .createHash("sha256")
      .update(units.map((unit) => `${unit.id}\t${unit.hash}`).join("\n"))
      .digest("hex")
      .slice(0, 32);
  for (const name of ["alpinaria", "atlas"]) {
    const index = buildProjectIndex(path.join(RETRIEVAL, name, "okf.project.yaml"));
    assert.equal(digest(conceptUnits(index)), record.plainUnitDigests[name].concepts, name);
    assert.equal(digest(sectionUnits(index)), record.plainUnitDigests[name].sections, name);
    const plain = sectionUnits(index);
    const contextual = contextualSectionUnits(index);
    assert.deepEqual(
      contextual.map((unit) => unit.id),
      plain.map((unit) => unit.id),
      `${name}: anchors unchanged`,
    );
    let position = 0;
    index.concepts.forEach((doc) => {
      const prefix = contextPrefix([doc.title, doc.type, doc.path]);
      assert.ok(prefix.length > 0 && prefix.length <= 160);
      conceptSections(doc).forEach((section) => {
        const unit = contextual[position];
        assert.equal(unit.text, `${prefix}\n${section.text}`);
        assert.equal(unit.hash, hashUnitText(unit.text));
        assert.notEqual(unit.hash, plain[position].hash, "own hashes");
        position += 1;
      });
    });
    const concepts = contextualConceptUnits(index);
    assert.deepEqual(
      concepts.map((unit) => unit.id),
      conceptUnits(index).map((unit) => unit.id),
    );
    concepts.forEach((unit) => {
      const doc = index.byUri.get(unit.id);
      assert.equal(unit.text, `${contextPrefix([doc.type, doc.path])}\n${conceptUnitText(doc)}`);
      assert.equal(unit.hash, hashUnitText(unit.text));
    });
  }
  assert.deepEqual(EMBED_UNITS, [
    "concepts",
    "sections",
    "contextual-sections",
    "contextual-concepts",
  ]);
  assert.equal(resolveUnits("contextual-sections"), contextualSectionUnits);
  assert.equal(resolveUnits("contextual-concepts"), contextualConceptUnits);
  const errors = [];
  const settings = normalizeEmbeddingConfig(
    {
      embedder: { type: "openai", baseUrl: "http://127.0.0.1:9", model: "m" },
      embedUnits: "contextual-sections",
    },
    errors,
  );
  assert.deepEqual(errors, []);
  assert.equal(settings.embedUnits, "contextual-sections");
});

async function runtimeFor(server, project, cacheDir, embedUnits) {
  return openEmbeddingRuntime(
    {
      embedder: { baseUrl: server.baseUrl, model: "fake", dimensions: 16, batchSize: 2048 },
      cacheDir,
      embedUnits,
    },
    { root: path.dirname(project) },
  );
}

test("contextual sections embed in one request per batch and an edit re-embeds its section only", async (t) => {
  const server = await startFakeEmbeddingsServer({ dimension: 16 });
  t.after(() => server.close());
  const project = copyFixture(t, "alpinaria");
  const cacheDir = path.join(tempDir(t, "okf-contextual-cache-"), "vectors");
  const runtime = await runtimeFor(server, project, cacheDir, "contextual-sections");
  const index = buildProjectIndex(project);
  const distinct = new Set(contextualSectionUnits(index).map((unit) => unit.hash)).size;
  const receipt = await runtime.sync(index);
  assert.equal(receipt.embedded, distinct);
  assert.equal(receipt.requests, 1, "one request for the whole fixture");
  assert.equal(server.requests.length, 1);
  assert.equal(receipt.embedUnits, "contextual-sections");
  assert.ok(server.requests[0].body.input.every((text) => /^[^\n]{1,160}\n/.test(text)));

  // A body edit changes the concept's last section: exactly that unit is embedded, in one request.
  const file = path.join(
    path.dirname(project),
    "bundles",
    "alpinaria",
    "audiences",
    "trail-runner.md",
  );
  fs.appendFileSync(file, "\nFrase aggiunta in coda per cambiare una sola sezione.\n");
  const edited = buildProjectIndex(project);
  const changed = await runtime.embedChanged(index, edited);
  assert.equal(changed.units, 1);
  assert.equal(changed.embedded, 1);
  assert.equal(changed.usage.requests, 1);
  // A title edit gives every section of the concept a new prefix: all of them are re-embedded.
  const uri = "okf://alpinaria/audiences/trail-runner";
  const sections = contextualSectionUnits(edited).filter(
    (unit) => unit.id === uri || unit.id.startsWith(`${uri}#`),
  );
  assert.ok(sections.length >= 2);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(/^title: "/m, 'title: "Rinominato: '));
  const renamed = buildProjectIndex(project);
  const retitled = await runtime.embedChanged(edited, renamed);
  assert.equal(retitled.units, sections.length);
  assert.equal(retitled.usage.requests, 1);
  const again = await runtime.sync(renamed);
  assert.equal(again.embedded, 0, "nothing left to embed");
});

test("switching embedUnits re-embeds once, prunes the old rows and reports the unit set", async (t) => {
  const server = await startFakeEmbeddingsServer({ dimension: 16 });
  t.after(() => server.close());
  const project = copyFixture(t, "atlas");
  const cacheDir = path.join(tempDir(t, "okf-contextual-switch-"), "vectors");
  const index = buildProjectIndex(project);
  const plain = await runtimeFor(server, project, cacheDir, "sections");
  const first = await plain.sync(index);
  const plainRows = new Set(sectionUnits(index).map((unit) => unit.hash)).size;
  assert.equal(first.embedded, plainRows);
  assert.equal(first.embedUnits, "sections");

  const contextual = await runtimeFor(server, project, cacheDir, "contextual-sections");
  const before = server.requests.length;
  const switched = await contextual.sync(index);
  const contextualRows = new Set(contextualSectionUnits(index).map((unit) => unit.hash)).size;
  assert.equal(switched.embedUnits, "contextual-sections");
  assert.equal(switched.reused, 0, "no plain section row is reused");
  assert.equal(switched.embedded, contextualRows);
  assert.equal(switched.pruned, plainRows, "the plain rows are pruned once");
  assert.equal(server.requests.length - before, 1);
  const status = contextual.status();
  assert.equal(status.embedUnits, "contextual-sections");
  assert.equal(status.startup.embedUnits, "contextual-sections");
  assert.equal(status.startup.embedded, contextualRows);
  const steady = await contextual.sync(buildProjectIndex(project));
  assert.equal(steady.embedded, 0);
  assert.equal(steady.pruned, 0);
  assert.equal(server.requests.length - before, 1, "no further request");
  const search = await contextual.search(index, { query: "compatibility of contracts" });
  assert.equal(search.hybrid, true);
  assert.ok(
    search.results.some((entry) => typeof entry.unit === "string" && entry.unit.includes("#")),
  );
});
