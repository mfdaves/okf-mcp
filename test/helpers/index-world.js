"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The random catalog behind the incremental index property test: a seeded
// generator, two local bundles mirrored on disk with their asset files, and
// a remote bundle snapshot.

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
    this.assets = new Map();
    this.bundles.forEach((bundle) => {
      Object.entries(ASSET_FILES).forEach(([relativePath, content]) => {
        const file = path.join(bundle.root, ...relativePath.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        this.assets.set(`${bundle.id}/${relativePath}`, content);
      });
    });
    // Twins that differ only in the extension's case need a filesystem that
    // keeps them apart.
    const probe = path.join(root, "Case-Probe");
    fs.writeFileSync(probe, "");
    this.caseSensitive = !fs.existsSync(path.join(root, "case-probe"));
    fs.unlinkSync(probe);
    this.files = new Map();
    this.counter = 0;
    this.wanted = [];
    this.deleted = [];
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

  // A path never used before, or now and then one a deletion freed.
  newPath() {
    if (this.deleted.length && this.chance(0.3)) {
      return this.deleted.splice(Math.floor(this.rand() * this.deleted.length), 1)[0];
    }
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
    // A compatibility alias some documents declare, which turns ambiguous
    // or unambiguous as they come and go.
    if (roll < 0.76) return `okf://${bundleId}/alias-${Math.floor(this.rand() * 6)}`;
    if (roll < 0.8) return "okf://remote/notes";
    if (roll < 0.9) return "https://example.com/reference";
    return kind === "link" ? "../outside.md" : "okf://alpha/does/not/exist";
  }

  // An asset file changes under the documents: rewritten with other bytes
  // (always a new length), removed, or put back.
  mutateAsset() {
    const bundle = this.bundle();
    const relativePath = this.pick(Object.keys(ASSET_FILES));
    const key = `${bundle.id}/${relativePath}`;
    const file = path.join(bundle.root, ...relativePath.split("/"));
    if (this.assets.get(key) !== null && this.chance(0.4)) {
      fs.unlinkSync(file);
      this.assets.set(key, null);
    } else {
      this.counter += 1;
      const content = Buffer.concat([
        Buffer.from(ASSET_FILES[relativePath]),
        Buffer.from(`\n${"#".repeat(this.counter)}`),
      ]);
      fs.writeFileSync(file, content);
      this.assets.set(key, content);
    }
    return { assetsChanged: true };
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
  render(bundleId, relativePath, forceContract) {
    if (this.chance(0.04)) {
      return "---\ntype: [unclosed\n---\n\n# Broken\n";
    }
    const lines = [];
    const contract = forceContract || this.chance(0.12) ? this.contract(bundleId) : null;
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
    this.deleted.push(relativePath);
    return { bundleId, relativePath };
  }

  // One random operation applied to disk, returned as index changes.
  operate() {
    const roll = this.rand();
    const existing = this.entries();
    if (roll < 0.06 && existing.length >= 4) {
      return this.mutateAsset();
    }
    if (roll < 0.1 && existing.length >= 4 && this.caseSensitive) {
      // A twin whose path differs from a concept's only in the extension's
      // case: both normalise to one concept id, so two concept documents,
      // often both contracts, share a canonical URI.
      const twins = this.concepts().filter(
        (entry) =>
          entry.relativePath.endsWith(".md") &&
          !this.files.has(`${entry.bundleId}/${entry.relativePath.slice(0, -3)}.MD`),
      );
      if (twins.length) {
        const entry = this.pick(twins);
        const twin = `${entry.relativePath.slice(0, -3)}.MD`;
        return {
          upserts: [this.write(entry.bundleId, twin, this.render(entry.bundleId, twin, true))],
        };
      }
    }
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

module.exports = { ASSET_FILES, REMOTE, World, makeRoot, prng };
