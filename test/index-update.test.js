"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  attachProject,
  buildIndex,
  indexUpdateStats,
  refreshIndex,
  updateIndex,
} = require("../src/indexer");
const { parseMarkdownText } = require("../src/parser");

const { REMOTE, World, makeRoot, prng } = require("./helpers/index-world");

// Sweep controls for one-off runs; the defaults are the committed cases.
// OKF_INDEX_UPDATE_STEPS sets the sequence length and OKF_INDEX_UPDATE_SEEDS
// ("1-25" or "3,9,42") runs those seeds too, under both option sets:
//
//   OKF_INDEX_UPDATE_SEEDS=1-25 OKF_INDEX_UPDATE_STEPS=300 \
//     node --test test/index-update.test.js
const STEPS =
  Number(process.env.OKF_INDEX_UPDATE_STEPS) > 0 ? Number(process.env.OKF_INDEX_UPDATE_STEPS) : 150;

function sweepSeeds(spec) {
  const seeds = [];
  String(spec || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const range = part.match(/^(\d+)-(\d+)$/);
      if (!range) {
        seeds.push(Number(part));
        return;
      }
      for (let seed = Number(range[1]); seed <= Number(range[2]); seed += 1) {
        seeds.push(seed);
      }
    });
  return seeds;
}

// The upsert and deletion forms updateIndex accepts, chosen at random so the
// sequence exercises all of them.
function asChanges(world, index, operation) {
  const upserts = (operation.upserts || []).map((entry) => {
    const bundle = world.bundle(entry.bundleId);
    const roll = world.rand();
    if (roll < 0.4)
      return { bundleId: entry.bundleId, relativePath: entry.relativePath, text: entry.text };
    if (roll < 0.7) return { bundleId: entry.bundleId, relativePath: entry.relativePath };
    try {
      return parseMarkdownText(
        { id: bundle.id, root: bundle.root },
        entry.relativePath,
        entry.text,
        path.join(bundle.root, ...entry.relativePath.split("/")),
      );
    } catch {
      // Unparsable text cannot be handed over as a parsed document.
      return { bundleId: entry.bundleId, relativePath: entry.relativePath, text: entry.text };
    }
  });
  const deletions = (operation.deletions || []).map((entry) => {
    const pathUri = `okf://${entry.bundleId}/${entry.relativePath}`;
    const doc = index.byPathUri.get(pathUri);
    const roll = world.rand();
    if (doc && roll < 0.3 && index.byUri.get(doc.uri) === doc) return doc.uri;
    if (doc && roll < 0.5) return pathUri;
    if (doc && roll < 0.65) return doc;
    return { bundleId: entry.bundleId, relativePath: entry.relativePath };
  });
  return { upserts, deletions, assetsChanged: Boolean(operation.assetsChanged) };
}

function runSequence(t, seed, steps, options, project) {
  const root = makeRoot("okf-index-update-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const world = new World(root, prng(seed));
  const args = world.bundles.concat([REMOTE]);
  // Root mode puts the stemming languages on the index object itself, after
  // the build; every update has to carry them to the index it produces.
  const languages = ["it", "en"];
  const fresh = () => {
    const index = buildIndex(args, options);
    const attached = project ? attachProject(index, project) : index;
    attached.languages = languages;
    return attached;
  };
  let current = fresh();
  const modes = { incremental: 0, full: 0, refresh: 0 };
  // What the sequence reached, so a seed is known to have exercised the
  // asset registry, computation readiness and duplicate pooling paths.
  const seen = {
    assets: false,
    readyContract: false,
    unreadyContract: false,
    duplicates: false,
    registryRebuilt: false,
    assetsMutated: false,
  };
  const observe = (index) => {
    if (index.assets.length) seen.assets = true;
    index.concepts.forEach((doc) => {
      const contract = doc.signals?.computation;
      if (contract) seen[contract.attestationReady ? "readyContract" : "unreadyContract"] = true;
    });
    if (index.errors.some((error) => error.code === "duplicate_concept_id")) seen.duplicates = true;
    const stats = indexUpdateStats(index);
    if (stats.registry === "rebuilt") seen.registryRebuilt = true;
    if (stats.assets === "changed") seen.assetsMutated = true;
  };
  for (let step = 1; step <= steps; step += 1) {
    const operation = world.operate();
    const label = `seed ${seed} step ${step}`;
    if (step % 10 === 0 || (operation.assetsChanged && world.chance(0.5))) {
      // Every tenth step the change is external: nothing tells the index,
      // the refresh has to find it from the files; so is half of the asset
      // changes, the other half is announced to updateIndex.
      const refreshed = refreshIndex(current);
      assert.deepEqual(refreshed, fresh(), `${label} (refresh)`);
      assert.equal(refreshed.languages, languages, `${label} (refresh): languages`);
      modes.refresh += 1;
      current = refreshed;
      observe(current);
      continue;
    }
    const changes = asChanges(world, current, operation);
    const snapshot = structuredClone(current);
    // Mostly incremental; now and then a forced rebuild, so the sequence also
    // proves that what a rebuild folds back in equals the incremental state.
    const next = updateIndex(current, changes, { maxChangeRatio: world.chance(0.15) ? 0 : 1 });
    assert.deepEqual(current, snapshot, `${label}: the input index changed`);
    assert.deepEqual(next, fresh(), label);
    assert.equal(next.languages, languages, `${label}: languages`);
    modes[indexUpdateStats(next).mode] += 1;
    current = next;
    observe(current);
  }
  return { world, current, args, modes, seen };
}

const PROJECT = {
  project: "updates",
  root: "/tmp/updates",
  path: null,
  plugins: [],
  producers: [],
  remoteBundles: [],
  strictLinks: false,
  errors: [{ code: "project_note", message: "carried by every update" }],
};
const STRICT = { strictLinks: true, allowCustomRelationTypes: true };

// What the fixed sequences reached between them; asserted once both ran.
const REACHED = {};

// At 150 steps a sequence forces about 20 rebuilds and runs about 115
// incremental updates; the floors scale with the step count.
function assertMixedModes(result) {
  assert.ok(result.modes.full >= STEPS / 30, JSON.stringify(result.modes));
  assert.ok(result.modes.incremental >= (STEPS * 2) / 3, JSON.stringify(result.modes));
  Object.keys(result.seen).forEach((key) => {
    REACHED[key] = Boolean(REACHED[key] || result.seen[key]);
  });
}

test("incremental updates equal a fresh build over random write sequences (seed 7)", (t) => {
  const result = runSequence(t, 7, STEPS, {}, PROJECT);
  assertMixedModes(result);
  assert.deepEqual(result.current.errors[0], {
    code: "project_note",
    message: "carried by every update",
  });
});

test("incremental updates equal a fresh build with strict links and custom relation types (seed 11)", (t) => {
  const result = runSequence(t, 11, STEPS, STRICT);
  assertMixedModes(result);
  assert.ok(result.current.relationTypes.includes("custom_kind"));
});

test("the fixed sequences reach the asset, readiness and duplicate paths", () => {
  assert.equal(Object.keys(REACHED).length, 6);
  const missed = Object.keys(REACHED).filter((key) => !REACHED[key]);
  assert.deepEqual(missed, [], `paths neither sequence reached: ${missed.join(", ")}`);
});

sweepSeeds(process.env.OKF_INDEX_UPDATE_SEEDS).forEach((seed) => {
  test(`sweep: incremental updates equal a fresh build (seed ${seed}, project)`, (t) => {
    runSequence(t, seed, STEPS, {}, PROJECT);
  });
  test(`sweep: incremental updates equal a fresh build (seed ${seed}, strict)`, (t) => {
    runSequence(t, seed, STEPS, STRICT);
  });
});

// Regression: a new document that sorts before a document the same batch
// replaces used to shift the replaced document's position, so the batch
// overwrote the wrong entry and left the old one in the index.
test("a batch that inserts before a document it also replaces keeps every entry once", (t) => {
  const root = makeRoot("okf-index-mixed-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const world = new World(root, prng(5));
  const text = (name, version) =>
    `---\ntype: Concept\ntitle: ${name} ${version}\n---\n\n# ${name}\n\nSee [c](/c.md) and [d](/d.md).\n`;
  ["b.md", "c.md", "d.md"].forEach((name) => {
    world.write("alpha", name, text(name, "one"));
  });
  const args = world.bundles.concat([REMOTE]);
  const index = buildIndex(args);
  const upsert = (name) => ({ bundleId: "alpha", relativePath: name });
  const alphaPaths = (result) =>
    result.documents.filter((doc) => doc.bundle === "alpha").map((doc) => doc.path);

  // The insertion is listed before the replacement it sorts ahead of.
  world.write("alpha", "a.md", text("a.md", "one"));
  world.write("alpha", "c.md", text("c.md", "two"));
  const incremental = { maxChangeRatio: 1 };
  const forward = updateIndex(index, { upserts: [upsert("a.md"), upsert("c.md")] }, incremental);
  assert.equal(indexUpdateStats(forward).mode, "incremental");
  assert.deepEqual(forward, buildIndex(args));
  assert.deepEqual(alphaPaths(forward), ["a.md", "b.md", "c.md", "d.md"]);

  // Then the other order, with an insertion at each end and a deletion.
  world.write("alpha", "e.md", text("e.md", "one"));
  world.write("alpha", "b.md", text("b.md", "two"));
  world.write("alpha", "aa.md", text("aa.md", "one"));
  world.remove("alpha", "d.md");
  const mixed = updateIndex(
    forward,
    {
      upserts: [upsert("e.md"), upsert("b.md"), upsert("aa.md")],
      deletions: [upsert("d.md")],
    },
    incremental,
  );
  assert.equal(indexUpdateStats(mixed).mode, "incremental");
  assert.deepEqual(mixed, buildIndex(args));
  assert.deepEqual(alphaPaths(mixed), ["a.md", "aa.md", "b.md", "c.md", "e.md"]);
  assert.ok(mixed.edges.some((edge) => edge.target === "okf://alpha/d.md" && edge.broken));
});

test("updateIndex falls back to a full build above the change ratio and rejects bad input", (t) => {
  const root = makeRoot("okf-index-ratio-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const world = new World(root, prng(3));
  for (let index = 0; index < 10; index += 1) {
    const relativePath = `concept-${index}.md`;
    world.write("alpha", relativePath, world.render("alpha", relativePath));
  }
  const args = world.bundles.concat([REMOTE]);
  const index = buildIndex(args);
  assert.equal(indexUpdateStats(index).mode, "build");
  assert.equal(indexUpdateStats({}), null);
  assert.equal(updateIndex(index, { upserts: [], deletions: [] }), index);

  const create = (count) =>
    Array.from({ length: count }, (_, position) => {
      const relativePath = `batch-${count}-${position}.md`;
      return world.write("alpha", relativePath, world.render("alpha", relativePath));
    });
  // 10 documents: two changes are 0.2 of them and stay incremental; three
  // cross the default ratio and rebuild. Both equal a fresh build.
  const two = updateIndex(index, { upserts: create(2) });
  assert.equal(indexUpdateStats(two).mode, "incremental");
  assert.deepEqual(two, buildIndex(args));
  const five = updateIndex(two, { upserts: create(3) });
  assert.equal(indexUpdateStats(five).mode, "full");
  assert.deepEqual(five, buildIndex(args));
  const forced = updateIndex(five, { upserts: create(1) }, { maxChangeRatio: 0 });
  assert.equal(indexUpdateStats(forced).mode, "full");
  assert.deepEqual(forced, buildIndex(args));
  // A document that is not on disk is folded into the rebuild as an override.
  const overlay = updateIndex(
    forced,
    {
      upserts: [
        {
          bundleId: "alpha",
          relativePath: "overlay.md",
          text: "---\ntype: Concept\ntitle: Overlay\n---\n",
        },
      ],
    },
    { maxChangeRatio: 0 },
  );
  assert.ok(overlay.byPathUri.has("okf://alpha/overlay.md"));
  assert.equal(fs.existsSync(path.join(world.bundle("alpha").root, "overlay.md")), false);

  assert.throws(() => updateIndex({ documents: [] }, {}), /produced by buildIndex/);
  assert.throws(
    () => updateIndex(index, { upserts: [{ bundleId: "nope", relativePath: "a.md" }] }),
    /Unknown bundle/,
  );
  assert.throws(
    () => updateIndex(index, { upserts: [{ bundleId: "remote", relativePath: "a.md" }] }),
    /Remote bundles/,
  );
  assert.throws(
    () => updateIndex(index, { upserts: [{ bundleId: "alpha", relativePath: "../a.md" }] }),
    /safe bundle-relative/,
  );
  assert.throws(
    () => updateIndex(index, { upserts: [{ bundleId: "alpha", relativePath: "a.txt" }] }),
    /Markdown/,
  );
  assert.throws(() => updateIndex(index, {}, { maxChangeRatio: -1 }), /non-negative/);
});

// Regression: a refresh compared Markdown files only, so an asset that was
// modified or removed under the documents kept its bytes, diagnostics and
// readiness in the index until a document referencing it changed.
test("a refresh sees referenced assets that were modified, removed or added", (t) => {
  const root = makeRoot("okf-index-assets-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const world = new World(root, prng(9));
  world.write(
    "alpha",
    "report.md",
    "---\ntype: Reference\ntitle: Report\nresource: /data/revenue.sql\n---\n\n# Report\n",
  );
  world.write(
    "alpha",
    "job.md",
    "---\ntype: Attested Computation\ntitle: Job\nruntime: postgres\ncomputation: /data/revenue.sql\nexecutor:\n  resource: /tools/run.py\n  receipt: [job_id]\nattester:\n  resource: /tools/check.py\n---\n\n# Job\n",
  );
  world.write("alpha", "note.md", "---\ntype: Reference\ntitle: Note\n---\n\n# Note\n");
  const args = world.bundles.concat([REMOTE]);
  const index = buildIndex(args);
  const sql = path.join(world.bundle("alpha").root, "data", "revenue.sql");
  const digest = (result) => result.byAssetUri.get("okf-asset://alpha/data/revenue.sql")?.sha256;
  const missing = (result) => result.warnings.some((entry) => entry.code === "asset_missing");
  assert.equal(index.assets.length, 3);
  assert.equal(missing(index), false);

  fs.writeFileSync(sql, "SELECT 1;\n");
  const modified = refreshIndex(index);
  assert.notEqual(modified, index);
  assert.equal(indexUpdateStats(modified).assets, "changed");
  assert.deepEqual(modified, buildIndex(args));
  assert.notEqual(digest(modified), digest(index));

  fs.unlinkSync(sql);
  const removed = refreshIndex(modified);
  assert.deepEqual(removed, buildIndex(args));
  assert.equal(removed.assets.length, 2);
  assert.equal(missing(removed), true);
  assert.equal(removed.byUri.get("okf://alpha/job").signals.computation.attestationReady, false);

  // An unrelated write on the refreshed index carries the registry as is.
  world.write("alpha", "note.md", "---\ntype: Reference\ntitle: Note two\n---\n\n# Note\n");
  const unrelated = updateIndex(
    removed,
    { upserts: [{ bundleId: "alpha", relativePath: "note.md" }] },
    { maxChangeRatio: 1 },
  );
  assert.equal(indexUpdateStats(unrelated).registry, "carried");
  assert.deepEqual(unrelated, buildIndex(args));

  fs.writeFileSync(sql, "SELECT 2;\n");
  const restored = refreshIndex(unrelated);
  assert.deepEqual(restored, buildIndex(args));
  assert.equal(restored.assets.length, 3);
  assert.equal(missing(restored), false);
  assert.equal(refreshIndex(restored), restored);

  // A host that knows it changed an asset can say so without a refresh.
  fs.writeFileSync(sql, "SELECT 3;\n");
  const announced = updateIndex(restored, { assetsChanged: true }, { maxChangeRatio: 1 });
  assert.equal(indexUpdateStats(announced).mode, "incremental");
  assert.deepEqual(announced, buildIndex(args));
});

// Regression: `signals.asOf` and `freshness` are stamped with the day of the
// parse, so an index kept across midnight disagreed with a fresh build on
// every document until each was rewritten.
test("an index built without an asOf follows the calendar", (t) => {
  const root = makeRoot("okf-index-date-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const world = new World(root, prng(13));
  world.write(
    "alpha",
    "stale.md",
    "---\ntype: Reference\ntitle: Stale\nstale_after: 2098-06-01\n---\n\n# Stale\n",
  );
  world.write("alpha", "ever.md", "---\ntype: Reference\ntitle: Ever\n---\n\n# Ever\n");
  const args = world.bundles.concat([REMOTE]);
  const index = buildIndex(args);
  assert.equal(index.byUri.get("okf://alpha/stale").signals.freshness, "fresh");
  // The same day costs nothing.
  assert.equal(updateIndex(index, {}), index);
  assert.equal(refreshIndex(index), index);

  const later = refreshIndex(index, { asOf: "2099-01-01" });
  assert.equal(indexUpdateStats(later).mode, "full");
  assert.equal(indexUpdateStats(later).reason, "date");
  assert.deepEqual(later, buildIndex(args, { asOf: "2099-01-01" }));
  assert.equal(later.byUri.get("okf://alpha/stale").signals.freshness, "stale");
  assert.equal(later.byUri.get("okf://alpha/ever").signals.asOf, "2099-01-01");
  // The rebuilt index still floats: same day, same object; next day, rebuilt.
  assert.equal(updateIndex(later, {}, { asOf: new Date("2099-01-01T23:00:00Z") }), later);
  world.write("alpha", "ever.md", "---\ntype: Reference\ntitle: Ever two\n---\n\n# Ever\n");
  const next = updateIndex(
    later,
    { upserts: [{ bundleId: "alpha", relativePath: "ever.md" }] },
    { asOf: "2099-01-02" },
  );
  assert.equal(indexUpdateStats(next).reason, "date");
  assert.deepEqual(next, buildIndex(args, { asOf: "2099-01-02" }));

  // A configured asOf is a fixed point of view and never moves.
  const fixed = buildIndex(args, { asOf: "2026-01-01" });
  assert.equal(updateIndex(fixed, {}, { asOf: "2099-01-01" }), fixed);
  world.write("alpha", "ever.md", "---\ntype: Reference\ntitle: Ever three\n---\n\n# Ever\n");
  const edited = updateIndex(
    fixed,
    { upserts: [{ bundleId: "alpha", relativePath: "ever.md" }] },
    { asOf: "2099-01-01", maxChangeRatio: 1 },
  );
  assert.equal(indexUpdateStats(edited).mode, "incremental");
  assert.deepEqual(edited, buildIndex(args, { asOf: "2026-01-01" }));
});
