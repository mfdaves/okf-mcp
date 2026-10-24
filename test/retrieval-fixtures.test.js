"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildProjectIndex } = require("../src/indexer");
const { headingSlug, markdownHeadings } = require("./fixtures/retrieval/lib/slug");
const { assignSplit, splitCounts, stratumKey } = require("./fixtures/retrieval/lib/split");

const FIXTURES_ROOT = path.join(__dirname, "fixtures", "retrieval");
const CLI = path.join(__dirname, "..", "bin", "okf-mcp.js");
const LANGUAGES = new Set(["en", "it", "mixed"]);
const GRADES = new Set([1, 2]);
const SPLITS = new Set(["dev", "heldout"]);

// Every directory under test/fixtures/retrieval that ships a generator is a retrieval fixture:
// generated bundles, okf.project.yaml, and a graded queries.json sidecar.
const FIXTURES = fs
  .readdirSync(FIXTURES_ROOT)
  .filter((name) => fs.existsSync(path.join(FIXTURES_ROOT, name, "generate.js")))
  .sort();

function listFiles(root, relative) {
  const prefix = relative || "";
  const entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
  return entries
    .flatMap((entry) => {
      const next = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? listFiles(root, next) : [next];
    })
    .sort();
}

function generatedFiles(root) {
  return listFiles(root).filter(
    (file) => file === "okf.project.yaml" || file.startsWith("bundles/"),
  );
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", shell: false });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function validateWithCli(args) {
  const result = runNode([CLI].concat(args, ["validate"]));
  assert.equal(
    result.status,
    0,
    `validate ${args.join(" ")} exited ${result.status}: ${result.stderr}`,
  );
  const report = JSON.parse(result.stdout);
  assert.equal(report.validForProject, true, JSON.stringify(report.diagnostics, null, 2));
  assert.equal(report.conformant, true);
  return report;
}

assert.ok(FIXTURES.length >= 1, "at least one retrieval fixture is expected");

FIXTURES.forEach((fixture) => {
  const fixtureRoot = path.join(FIXTURES_ROOT, fixture);
  const projectPath = path.join(fixtureRoot, "okf.project.yaml");
  const queriesPath = path.join(fixtureRoot, "queries.json");

  test(`${fixture}: regenerating the fixture is byte-identical to the committed tree`, (t) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), `okf-fixture-${fixture}-`));
    t.after(() => fs.rmSync(out, { recursive: true, force: true }));
    const result = runNode([path.join(fixtureRoot, "generate.js"), "--out", out]);
    assert.equal(result.status, 0, result.stderr);

    const committed = generatedFiles(fixtureRoot);
    const regenerated = generatedFiles(out);
    assert.ok(committed.length > 0, "the committed fixture has generated files");
    assert.deepEqual(regenerated, committed);
    committed.forEach((file) => {
      const expected = fs.readFileSync(path.join(fixtureRoot, file));
      const actual = fs.readFileSync(path.join(out, file));
      assert.ok(actual.equals(expected), `${fixture}/${file} differs from the committed file`);
    });
  });

  test(`${fixture}: bundles validate clean in --project and --root mode`, () => {
    const project = validateWithCli(["--project", projectPath]);
    assert.equal(project.diagnostics.length, 0);
    const bundleDirs = fs
      .readdirSync(path.join(fixtureRoot, "bundles"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(fixtureRoot, "bundles", entry.name));
    assert.ok(bundleDirs.length >= 1);
    bundleDirs.forEach((bundleRoot) => {
      const report = validateWithCli(["--root", bundleRoot]);
      assert.equal(report.diagnostics.length, 0, path.basename(bundleRoot));
    });
  });

  test(`${fixture}: queries.json is well formed and references only indexed concepts`, () => {
    const sidecar = JSON.parse(fs.readFileSync(queriesPath, "utf8"));
    const index = buildProjectIndex(projectPath);
    assert.equal(index.validForProject, true);
    assert.match(String(sidecar.as_of), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(sidecar.queries) && sidecar.queries.length > 0);
    const categories = new Set(Object.keys(sidecar.categories));
    const ids = new Set();
    sidecar.queries.forEach((query) => {
      assert.equal(ids.has(query.id), false, `duplicate query id ${query.id}`);
      ids.add(query.id);
      assert.ok(
        typeof query.query === "string" && query.query.trim(),
        `${query.id} has a query string`,
      );
      assert.ok(LANGUAGES.has(query.lang), `${query.id} lang ${query.lang}`);
      assert.ok(categories.has(query.category), `${query.id} category ${query.category}`);
      const expected = query.expected || [];
      const distractors = query.distractors || [];
      if (query.category === "no-answer") {
        assert.equal(expected.length, 0, `${query.id} is no-answer but lists expected concepts`);
      } else {
        assert.ok(
          expected.some((entry) => entry.grade === 2),
          `${query.id} needs a grade-2 concept`,
        );
      }
      expected.concat(distractors).forEach((entry) => {
        const uri = `okf://${entry.bundle}/${entry.id}`;
        assert.ok(index.byUri.get(uri), `${query.id} references ${uri}, which is not indexed`);
      });
      expected.forEach((entry) => {
        assert.ok(GRADES.has(entry.grade), `${query.id} grade ${entry.grade}`);
      });
      if (query.added !== undefined) {
        assert.equal(query.added, "wp0", `${query.id} carries an unknown provenance marker`);
      }
    });
    assert.ok(
      sidecar.queries.filter((query) => query.category === "no-answer").length >= 8,
      "at least 8 no-answer queries",
    );
  });

  test(`${fixture}: the dev/heldout split is the committed seeded stratified assignment`, () => {
    const sidecar = JSON.parse(fs.readFileSync(queriesPath, "utf8"));
    assert.ok(
      sidecar.split && Number.isInteger(sidecar.split.seed),
      "split metadata records the seed",
    );
    const derived = assignSplit(sidecar.queries, {
      seed: sidecar.split.seed,
      devRatio: sidecar.split.devRatio,
    });
    const strata = new Map();
    sidecar.queries.forEach((query) => {
      assert.ok(SPLITS.has(query.split), `${query.id} split ${query.split}`);
      assert.equal(
        query.split,
        derived.get(query.id),
        `${query.id} split drifted from the seeded assignment`,
      );
      const key = stratumKey(query);
      if (!strata.has(key)) {
        strata.set(key, { dev: 0, heldout: 0 });
      }
      strata.get(key)[query.split] += 1;
    });
    // Every stratum keeps at least one development query, and the overall ratio stays near 70/30.
    strata.forEach((counts, key) => {
      assert.ok(counts.dev >= 1, `stratum ${key} has no dev query`);
    });
    // Paraphrase families (same primary grade-2 target) never span both splits.
    const familySplits = new Map();
    sidecar.queries.forEach((query) => {
      if (!query.family) {
        return;
      }
      const primary = (query.expected || []).find((entry) => entry.grade === 2);
      assert.equal(
        `${primary.bundle}/${primary.id}`,
        query.family,
        `${query.id} family differs from its primary target`,
      );
      if (!familySplits.has(query.family)) {
        familySplits.set(query.family, new Set());
      }
      familySplits.get(query.family).add(query.split);
    });
    familySplits.forEach((splits, family) => {
      assert.equal(splits.size, 1, `family ${family} spans both splits`);
    });
    const counts = splitCounts(sidecar.queries);
    const devShare = counts.dev / (counts.dev + counts.heldout);
    assert.ok(
      devShare >= 0.6 && devShare <= 0.8,
      `dev share ${devShare.toFixed(2)} is outside 60-80%`,
    );
  });

  test(`${fixture}: sectionAnchor labels point at a real H2 of a grade-2 concept (WP3a)`, () => {
    const sidecar = JSON.parse(fs.readFileSync(queriesPath, "utf8"));
    const index = buildProjectIndex(projectPath);
    let devLabelled = 0;
    sidecar.queries.forEach((query) => {
      if (!query.sectionAnchor) {
        return;
      }
      const { uri, heading, slug } = query.sectionAnchor;
      const doc = index.byUri.get(uri);
      assert.ok(doc, `${query.id} anchors ${uri}, which is not indexed`);
      const anchored = (query.expected || []).some(
        (entry) => `okf://${entry.bundle}/${entry.id}` === uri && entry.grade === 2,
      );
      assert.ok(anchored, `${query.id} anchors a concept that is not one of its grade-2 answers`);
      const h2 = markdownHeadings(doc.body)
        .filter(([level]) => level === 2)
        .map(([, text]) => text);
      assert.ok(
        h2.includes(heading),
        `${query.id}: "${heading}" is not an H2 of ${uri} (${h2.join(" | ")})`,
      );
      assert.equal(slug, headingSlug(heading), `${query.id}: slug drifted from the heading rule`);
      if (query.split === "dev") {
        devLabelled += 1;
      }
    });
    // WP3a's acceptance is measured on at least 40 labelled development queries per fixture.
    assert.ok(devLabelled >= 40, `${devLabelled} labelled dev queries; WP3a needs at least 40`);
  });
});
