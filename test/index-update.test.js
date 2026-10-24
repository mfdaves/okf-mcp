"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
const { LiveAuthoringService } = require("../src/live-authoring");
const { callTool, createStateAsync } = require("../src/mcp/server");
const { FileConceptStore } = require("../src/store");

// mulberry32: a small deterministic generator so a failing sequence can be
// replayed from its seed.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ["Concept", "Guide", "Reference"];
const WORDS = ["alpha", "beta", "gamma", "delta", "note", "topic"];
const DIRS = ["", "guides/", "topics/deep/", "drafts/"];

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

// Asset files every bundle carries from the start, so documents can reference
// text and binary assets that exist, a file that is missing, and, in beta, a
// file the bundle policy excludes. Refreshes track Markdown only, so the
// asset files themselves never change during a sequence.
const ASSET_FILES = {
  "tools/run.py": "print('run')\n",
  "tools/check.py": "print('check')\n",
  "data/revenue.sql": "SELECT SUM(amount) FROM revenue;\n",
  "data/chart.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]),
  "drafts/hidden.py": "print('hidden')\n",
};

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A random two-bundle catalog mirrored on disk. Every operation keeps
// `files` equal to what is on disk so a fresh build is always available as
// the reference.
class World {
  constructor(root, rand) {
    this.rand = rand;
    this.bundles = [
      { id: "alpha", root: path.join(root, "alpha") },
      { id: "beta", root: path.join(root, "beta"), exclude: ["drafts/**"] },
    ];
    this.bundles.forEach((bundle) => {
      Object.entries(ASSET_FILES).forEach(([relativePath, content]) => {
        const file = path.join(bundle.root, ...relativePath.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      });
    });
    this.files = new Map();
    this.counter = 0;
    this.wanted = [];
  }

  pick(list) {
    return list[Math.floor(this.rand() * list.length)];
  }

  chance(probability) {
    return this.rand() < probability;
  }

  bundle(id) {
    return id ? this.bundles.find((bundle) => bundle.id === id) : this.pick(this.bundles);
  }

  entries() {
    return Array.from(this.files.keys()).map((key) => {
      const [bundleId, ...rest] = key.split("/");
      return { bundleId, relativePath: rest.join("/") };
    });
  }

  concepts() {
    return this.entries().filter((entry) => !/(^|\/)(index|log)\.md$/.test(entry.relativePath));
  }

  newPath() {
    this.counter += 1;
    return `${this.pick(DIRS)}${this.pick(WORDS)}-${this.counter}.md`;
  }

  // A link or relation target: an existing concept (by several locator
  // forms), a target that is wanted but missing yet, a fresh missing path,
  // a cross-bundle URI, the remote bundle, or an external URL.
  target(bundleId, kind) {
    const roll = this.rand();
    const concepts = this.concepts();
    if (roll < 0.45 && concepts.length) {
      const entry = this.pick(concepts);
      const conceptId = entry.relativePath.replace(/\.md$/i, "");
      if (entry.bundleId !== bundleId || this.chance(0.4)) {
        return `okf://${entry.bundleId}/${conceptId}`;
      }
      return kind === "link"
        ? `/${entry.relativePath}`
        : this.chance(0.5)
          ? conceptId
          : entry.relativePath;
    }
    if (roll < 0.6) {
      const missing = { bundleId, relativePath: this.newPath() };
      this.wanted.push(missing);
      return `/${missing.relativePath}`;
    }
    if (roll < 0.7 && this.wanted.length) {
      const wanted = this.pick(this.wanted);
      return wanted.bundleId === bundleId
        ? `/${wanted.relativePath}`
        : `okf://${wanted.bundleId}/${wanted.relativePath.replace(/\.md$/i, "")}`;
    }
    if (roll < 0.8) return "okf://remote/notes";
    if (roll < 0.9) return "https://example.com/reference";
    return kind === "link" ? "../outside.md" : "okf://alpha/does/not/exist";
  }

  // An asset reference: a file that exists (bundle-rooted, or relative to the
  // document so it misses from a subdirectory), a missing file, a concept or
  // other link target, a path outside the root, or a URL.
  assetTarget(bundleId) {
    const roll = this.rand();
    const files = Object.keys(ASSET_FILES);
    if (roll < 0.4) return `/${this.pick(files)}`;
    if (roll < 0.6) return this.pick(files);
    if (roll < 0.7) return "/data/missing.bin";
    if (roll < 0.8) return this.target(bundleId, "link");
    if (roll < 0.9) return "../escape.py";
    return "https://example.com/tool.py";
  }

  // An Attested Computation contract whose readiness depends on what its
  // executor, attester and computation references resolve to: text assets,
  // concepts, missing files or URLs; the computation is a file or an inline
  // block, now and then left unclosed so the contract is structurally unready.
  contract(bundleId) {
    const resource = () =>
      this.chance(0.55)
        ? `/${this.pick(["tools/run.py", "tools/check.py"])}`
        : this.assetTarget(bundleId);
    const lines = [
      `runtime: ${this.pick(["bigquery", "postgres"])}`,
      "executor:",
      `  resource: ${resource()}`,
      "  receipt: [job_id, result]",
    ];
    if (this.chance(0.9)) lines.push("attester:", `  resource: ${resource()}`);
    if (this.chance(0.5)) {
      lines.push(
        `computation: ${this.chance(0.7) ? "/data/revenue.sql" : this.assetTarget(bundleId)}`,
      );
      return { lines, body: [] };
    }
    const body = ["# Computation", "```sql\nSELECT 1\n```"];
    if (this.chance(0.1)) body[1] = "```sql\nSELECT 1\n";
    return { lines, body };
  }

  // Rendered Markdown with random validity: sometimes no type, sometimes a
  // compatibility id that collides with another document, sometimes a
  // relation of an unsupported type, sometimes an asset reference or a
  // computation contract, sometimes unparsable frontmatter.
  render(bundleId, relativePath) {
    if (this.chance(0.04)) {
      return "---\ntype: [unclosed\n---\n\n# Broken\n";
    }
    const lines = [];
    const contract = this.chance(0.12) ? this.contract(bundleId) : null;
    if (contract) lines.push("type: Attested Computation");
    else if (this.chance(0.9)) lines.push(`type: ${this.pick(TYPES)}`);
    lines.push(`title: Title ${this.counter}-${Math.floor(this.rand() * 1000)}`);
    if (this.chance(0.3)) lines.push(`tags: [${this.pick(WORDS)}, ${this.pick(WORDS)}]`);
    if (this.chance(0.25)) {
      const concepts = this.concepts();
      const alias =
        concepts.length && this.chance(0.5)
          ? `okf://${bundleId}/${this.pick(concepts).relativePath.replace(/\.md$/i, "")}`
          : `okf://${bundleId}/alias-${Math.floor(this.rand() * 6)}`;
      lines.push(`id: ${alias}`);
    }
    if (contract) lines.push(...contract.lines);
    else if (this.chance(0.15)) lines.push(`resource: ${this.assetTarget(bundleId)}`);
    if (this.chance(0.1)) {
      const source = this.chance(0.6) ? this.assetTarget(bundleId) : "all rows in the warehouse";
      lines.push("sources:", `  - resource: ${source}`);
    }
    const relationCount = Math.floor(this.rand() * 3);
    if (relationCount) {
      lines.push("relations:");
      for (let index = 0; index < relationCount; index += 1) {
        const type = this.chance(0.85)
          ? "related_to"
          : this.chance(0.5)
            ? "custom_kind"
            : "bad type";
        lines.push(`  - type: ${type}`, `    target: ${this.target(bundleId, "relation")}`);
      }
    }
    const body = [`# ${relativePath}`];
    const linkCount = Math.floor(this.rand() * 3);
    for (let index = 0; index < linkCount; index += 1) {
      body.push(`See [target ${index}](${this.target(bundleId, "link")}).`);
    }
    if (contract) body.push(...contract.body);
    return `---\n${lines.join("\n")}\n---\n\n${body.join("\n\n")}\n`;
  }

  write(bundleId, relativePath, text) {
    const bundle = this.bundle(bundleId);
    const file = path.join(bundle.root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    this.files.set(`${bundleId}/${relativePath}`, text);
    this.wanted = this.wanted.filter(
      (entry) => !(entry.bundleId === bundleId && entry.relativePath === relativePath),
    );
    return { bundleId, relativePath, text };
  }

  remove(bundleId, relativePath) {
    fs.unlinkSync(path.join(this.bundle(bundleId).root, ...relativePath.split("/")));
    this.files.delete(`${bundleId}/${relativePath}`);
    return { bundleId, relativePath };
  }

  // One random operation applied to disk, returned as index changes.
  operate() {
    const roll = this.rand();
    const existing = this.entries();
    if (roll < 0.3 || existing.length < 4) {
      const bundleId = this.bundle().id;
      const wanted = this.wanted.filter((entry) => entry.bundleId === bundleId);
      const relativePath =
        wanted.length && this.chance(0.6) ? this.pick(wanted).relativePath : this.newPath();
      return { upserts: [this.write(bundleId, relativePath, this.render(bundleId, relativePath))] };
    }
    if (roll < 0.5) {
      const entry = this.pick(existing);
      return {
        upserts: [
          this.write(
            entry.bundleId,
            entry.relativePath,
            this.render(entry.bundleId, entry.relativePath),
          ),
        ],
      };
    }
    if (roll < 0.65) {
      const entry = this.pick(existing);
      return { deletions: [this.remove(entry.bundleId, entry.relativePath)] };
    }
    if (roll < 0.75) {
      const entry = this.pick(existing);
      const text = this.files.get(`${entry.bundleId}/${entry.relativePath}`);
      const renamed = this.newPath();
      return {
        deletions: [this.remove(entry.bundleId, entry.relativePath)],
        upserts: [this.write(entry.bundleId, renamed, text)],
      };
    }
    if (roll < 0.85) {
      // A batch like an agent's: new documents, replacements and now and then
      // a deletion together, so insertions and replacements interleave.
      const upserts = [];
      const deletions = [];
      const touched = new Set();
      const count = 2 + Math.floor(this.rand() * 3);
      for (let index = 0; index < count; index += 1) {
        if (this.chance(0.5)) {
          const bundleId = this.bundle().id;
          const relativePath = this.newPath();
          upserts.push(this.write(bundleId, relativePath, this.render(bundleId, relativePath)));
          continue;
        }
        const entry = this.pick(existing);
        const key = `${entry.bundleId}/${entry.relativePath}`;
        if (touched.has(key)) continue;
        touched.add(key);
        if (this.chance(0.25)) {
          deletions.push(this.remove(entry.bundleId, entry.relativePath));
        } else {
          upserts.push(
            this.write(
              entry.bundleId,
              entry.relativePath,
              this.render(entry.bundleId, entry.relativePath),
            ),
          );
        }
      }
      return { upserts, deletions };
    }
    const bundleId = this.bundle().id;
    const reservedRoll = this.rand();
    if (reservedRoll < 0.45) {
      const version = this.pick(['"0.2"', '"0.1"', '"9"', null]);
      const text =
        version === null ? "# Index\n" : `---\nokf_version: ${version}\n---\n\n# Index\n`;
      return { upserts: [this.write(bundleId, "index.md", text)] };
    }
    if (reservedRoll < 0.75) {
      return { upserts: [this.write(bundleId, "log.md", `# Log\n\n- ${this.counter}\n`)] };
    }
    // A document whose path normalises to a reserved document's concept id
    // (`log.md.md` and `log.md` are both `okf://<bundle>/log.md`): the one way
    // two files share a canonical URI, which is what pools computation
    // readiness.
    const dir = this.pick(DIRS);
    const upserts = [];
    if (!this.files.has(`${bundleId}/${dir}log.md`)) {
      upserts.push(this.write(bundleId, `${dir}log.md`, "# Log\n"));
    }
    upserts.push(this.write(bundleId, `${dir}log.md.md`, this.render(bundleId, `${dir}log.md.md`)));
    return { upserts };
  }
}

const REMOTE = {
  id: "remote",
  remote: true,
  documents: [
    { path: "notes.md", text: "---\ntype: Concept\ntitle: Remote notes\n---\n\n# Notes\n" },
  ],
};

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
  return { upserts, deletions };
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
  };
  const observe = (index) => {
    if (index.assets.length) seen.assets = true;
    index.concepts.forEach((doc) => {
      const contract = doc.signals?.computation;
      if (contract) seen[contract.attestationReady ? "readyContract" : "unreadyContract"] = true;
    });
    if (index.errors.some((error) => error.code === "duplicate_concept_id")) seen.duplicates = true;
    if (indexUpdateStats(index).registry === "rebuilt") seen.registryRebuilt = true;
  };
  for (let step = 1; step <= steps; step += 1) {
    const operation = world.operate();
    const label = `seed ${seed} step ${step}`;
    if (step % 10 === 0) {
      // Every tenth step the change is external: nothing tells the index,
      // the refresh has to find it from the files.
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
  assert.equal(Object.keys(REACHED).length, 5);
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
