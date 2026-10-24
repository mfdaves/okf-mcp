"use strict";

// Section units as the embedding units WP3c will configure
// (`prepareEmbeddings(index, embedder, cache, { units: sectionUnits })`):
// they pass the unit validation, hash like concept units, and an edit to one
// section re-embeds that section only.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { openVectorCache } = require("../src/cache/store");
const { sectionUnits } = require("../src/context/sections");
const { prepareEmbeddings } = require("../src/embed/prepare");
const { UNIT_HASH_PATTERN, hashUnitText } = require("../src/embed/units");
const { buildProjectIndex } = require("../src/indexer");
const { vectorFor } = require("./fake-embeddings-server");

const FIXTURE = path.join(__dirname, "fixtures", "retrieval", "alpinaria");
const DIMENSION = 8;

function memoryEmbedder() {
  const inputs = [];
  return {
    id: `memory:sections:${DIMENSION}`,
    dimension: DIMENSION,
    languages: ["en", "it"],
    remote: false,
    maxBatch: 64,
    maxInputChars: 4000,
    async embed(texts) {
      inputs.push(texts.slice());
      return texts.map((text) => vectorFor(text, DIMENSION));
    },
    inputs,
  };
}

test("section units feed prepareEmbeddings and an edited section alone is re-embedded", async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "okf-section-units-"));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const fixture = path.join(work, "alpinaria");
  fs.cpSync(FIXTURE, fixture, { recursive: true });
  const projectPath = path.join(fixture, "okf.project.yaml");
  const embedder = memoryEmbedder();
  const cache = openVectorCache(path.join(work, "cache"), {
    embedderId: embedder.id,
    dimension: DIMENSION,
  });

  const index = buildProjectIndex(projectPath);
  const units = sectionUnits(index);
  units.forEach((unit) => {
    assert.match(unit.hash, UNIT_HASH_PATTERN);
    assert.equal(unit.hash, hashUnitText(unit.text));
  });
  const distinct = new Set(units.map((unit) => unit.hash)).size;
  const first = await prepareEmbeddings(index, embedder, cache, { units: sectionUnits });
  assert.equal(first.units, units.length);
  assert.equal(first.embedded, distinct);
  assert.equal(first.deduplicated, units.length - distinct);
  assert.equal(cache.size, distinct);

  const second = await prepareEmbeddings(buildProjectIndex(projectPath), embedder, cache, {
    units: sectionUnits,
  });
  assert.equal(second.embedded, 0);
  assert.equal(second.requests, 0);

  // Appending to the file extends its last section only.
  const uri = "okf://alpinaria/audiences/trail-runner";
  const before = units.filter((unit) => unit.id === uri || unit.id.startsWith(`${uri}#`));
  assert.ok(before.length >= 2, "the concept has several sections");
  const target = path.join(fixture, "bundles", "alpinaria", "audiences", "trail-runner.md");
  fs.appendFileSync(target, "\nFrase aggiunta in coda per cambiare una sola sezione.\n");
  const editedUnits = sectionUnits(buildProjectIndex(projectPath));
  const after = editedUnits.filter((unit) => unit.id === uri || unit.id.startsWith(`${uri}#`));
  assert.deepEqual(
    after.map((unit) => unit.id),
    before.map((unit) => unit.id),
    "anchors are unchanged by a body edit",
  );
  const changed = after.filter((unit, position) => unit.hash !== before[position].hash);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].id, before.at(-1).id);
  const calls = embedder.inputs.length;
  const third = await prepareEmbeddings(buildProjectIndex(projectPath), embedder, cache, {
    units: sectionUnits,
  });
  assert.equal(third.embedded, 1);
  assert.deepEqual(embedder.inputs.slice(calls), [[changed[0].text]]);
});
