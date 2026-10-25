"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CONTEXT_CONTENT_FIELDS,
  CONTEXT_TOKEN_ESTIMATOR,
  DEFAULT_CONCEPT_LIFT,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_PREAMBLE_WEIGHT,
  DEFAULT_PROVENANCE,
  assembleContext,
  estimateContextTokens,
} = require("../src/context/assemble");
const { conceptSections } = require("../src/context/sections");
const { buildIndex, buildProjectIndex, updateIndex } = require("../src/indexer");

const FIXTURES_ROOT = path.join(__dirname, "fixtures", "retrieval");
const ALPINARIA = path.join(FIXTURES_ROOT, "alpinaria", "okf.project.yaml");
const SEED = 20261024;

function mulberry32(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fixtureQueries(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_ROOT, name, "queries.json"), "utf8"));
}

function tempBundle(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  Object.entries(files).forEach(([relativePath, content]) => {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  });
  return buildIndex([`demo=${root}`]);
}

function note(title, body, extra) {
  return `---\ntype: Note\ntitle: "${title}"\ndescription: "About ${title}."\n${extra || ""}---\n\n# ${title}\n\n${body}\n`;
}

// What is delivered, as the budget counts it (0.11.0-rc.2): the compact JSON of the
// whole value, every field included.
const SCORING_FIELDS = ["tokens", "score", "relevance", "matchedTerms", "coverage"];
const serialisedTokens = (value) => estimateContextTokens(JSON.stringify(value));
// The response around its sections.
const frameTokens = (result) => serialisedTokens(Object.assign({}, result, { sections: [] }));

const checkBudget = (result, budget, limit) => {
  assert.equal(result.usedTokens, serialisedTokens(result), "usedTokens is the whole response");
  // Only a budget below the fixed fields (query echo, field names) can be exceeded, and
  // then nothing but those fields is returned.
  assert.ok(
    result.usedTokens <= budget || (!result.sections.length && !result.concepts.length),
    `used ${result.usedTokens} > budget ${budget}`,
  );
  result.sections.forEach((section) => {
    assert.equal(section.tokens, serialisedTokens(section));
    assert.deepEqual(
      Object.keys(section).filter((name) => !SCORING_FIELDS.includes(name)),
      CONTEXT_CONTENT_FIELDS.filter((name) => name in section),
    );
  });
  assert.ok(result.sections.length <= limit);
};

test("the budget is never exceeded across random budgets, limits and queries", () => {
  const index = buildProjectIndex(ALPINARIA);
  const sidecar = fixtureQueries("alpinaria");
  const random = mulberry32(SEED);
  for (let round = 0; round < 80; round += 1) {
    const query = sidecar.queries[Math.floor(random() * sidecar.queries.length)];
    const budgetTokens = 1 + Math.floor(random() * 2500);
    const limit = 1 + Math.floor(random() * 30);
    const provenance = [{}, { provenance: "compact" }, { includeProvenance: false }][round % 3];
    const result = assembleContext(
      index,
      Object.assign({ query: query.query, budgetTokens, limit, asOf: sidecar.as_of }, provenance),
    );
    checkBudget(result, budgetTokens, limit);
    assert.equal(result.budgetTokens, budgetTokens);
    assert.equal(result.estimator, "chars/4");
    assert.equal(
      new Set(result.sections.map((section) => section.anchor)).size,
      result.sections.length,
    );
    if (result.truncated) {
      assert.equal(result.sections.length, 1);
      assert.equal(result.sections[0].truncated, true);
    } else {
      assert.ok(result.sections.every((section) => section.truncated === false));
    }
  }
  assert.equal(CONTEXT_TOKEN_ESTIMATOR, "chars/4");
  assert.equal(DEFAULT_CONTEXT_BUDGET_TOKENS, 1200);
  // The review's reproduction: 50 tokens used to deliver about 283 serialised.
  ["full", "compact"].forEach((provenance) => {
    const small = assembleContext(index, { query: "scarponi donna", budgetTokens: 50, provenance });
    checkBudget(small, 50, 20);
  });
  const lean = assembleContext(index, {
    query: "scarponi donna",
    budgetTokens: 400,
    includeProvenance: false,
  });
  const compact = assembleContext(index, {
    query: "scarponi donna",
    budgetTokens: 400,
    provenance: "compact",
  });
  const full = assembleContext(index, { query: "scarponi donna", budgetTokens: 400 });
  assert.ok(lean.sections.length >= compact.sections.length);
  assert.ok(compact.sections.length >= full.sections.length);
  assert.throws(
    () => assembleContext(index, { query: "scarponi", provenance: "verbose" }),
    /provenance must be one of compact, full, none/,
  );
});

test("the whole serialised response fits random budgets, in the library and over MCP", async () => {
  const { tools } = require("../src/mcp/tools/context");
  const index = buildProjectIndex(ALPINARIA);
  const sidecar = fixtureQueries("alpinaria");
  const random = mulberry32(SEED + 1);
  for (let round = 0; round < 120; round += 1) {
    const query = sidecar.queries[Math.floor(random() * sidecar.queries.length)];
    const budgetTokens = 150 + Math.floor(random() * 3850);
    const options = {
      query: query.query,
      budgetTokens,
      asOf: sidecar.as_of,
      conceptLimit: 1 + Math.floor(random() * 50),
      provenance: ["compact", "full", "none"][round % 3],
    };
    const response = assembleContext(index, options);
    assert.ok(
      Math.ceil(JSON.stringify(response).length / 4) <= budgetTokens,
      `${query.id} at ${budgetTokens}`,
    );
    assert.equal(response.usedTokens, Math.ceil(JSON.stringify(response).length / 4));
    assert.equal(response.omittedConcepts + response.concepts.length <= options.conceptLimit, true);
    if (round % 10 === 0) {
      const returned = await tools.get_context.handler({ index }, options);
      const text = returned.content[0].text;
      assert.ok(Math.ceil(text.length / 4) <= budgetTokens, "the MCP text fits the budget");
      assert.deepEqual(JSON.parse(text), response);
    }
  }
  // Below the fixed fields nothing else is returned and usedTokens says what it costs.
  const tiny = assembleContext(index, { query: "scarponi donna", budgetTokens: 1 });
  assert.deepEqual([tiny.sections, tiny.concepts], [[], []]);
  assert.ok(tiny.omittedConcepts > 0);
  assert.equal(tiny.usedTokens, serialisedTokens(tiny));
});

test("assembly is deterministic and ordered by concept rank, own text first, with a bounded lift", () => {
  const index = buildProjectIndex(ALPINARIA);
  const options = { query: "scarponi da trekking donna", budgetTokens: 1200, asOf: "2026-10-24" };
  const first = assembleContext(index, options);
  const second = assembleContext(index, options);
  assert.deepEqual(second, first);
  const rebuilt = assembleContext(buildProjectIndex(ALPINARIA), options);
  assert.deepEqual(rebuilt, first);
  assert.ok(first.sections.length > 3);
  const rankOf = new Map(first.concepts.map((concept) => [concept.uri, concept.rank]));
  // The sort key: concept rank, less up to DEFAULT_CONCEPT_LIFT for an own-text section in
  // proportion to its relevance (score over the best own-text section).
  const keyOf = (section) =>
    rankOf.get(section.uri) - (section.coverage > 0 ? DEFAULT_CONCEPT_LIFT * section.relevance : 0);
  for (let position = 1; position < first.sections.length; position += 1) {
    const previous = first.sections[position - 1];
    const current = first.sections[position];
    assert.ok(keyOf(previous) <= keyOf(current) + 1e-12, "keys ascend");
    assert.ok(
      rankOf.get(previous.uri) - DEFAULT_CONCEPT_LIFT <= rankOf.get(current.uri),
      "no section passes more than the lift",
    );
    if (previous.uri === current.uri && previous.coverage === 0) {
      assert.equal(current.coverage, 0, "own-text sections precede metadata-only ones");
    }
    if (keyOf(previous) === keyOf(current) && previous.uri === current.uri) {
      const anchors = conceptSections(index.byUri.get(current.uri)).map((s) => s.anchor);
      assert.ok(
        previous.score > current.score ||
          anchors.indexOf(previous.anchor) < anchors.indexOf(current.anchor),
      );
    }
  }
  first.sections.forEach((section) => {
    assert.ok(rankOf.has(section.uri), "every section belongs to a candidate concept");
    assert.ok(section.coverage >= 0 && section.coverage <= 1);
    assert.equal(section.matchedTerms.length === 0, section.coverage === 0);
    assert.ok(section.relevance > 0 && section.relevance <= 1);
  });
  // Both anchor forms occur: the concept URI for a preamble, uri#slug for a heading.
  assert.ok(first.sections.some((section) => !section.anchor.includes("#")));
  assert.ok(first.sections.some((section) => section.anchor.includes("#")));
  assert.deepEqual(Object.keys(first), [
    "query",
    "budgetTokens",
    "estimator",
    "usedTokens",
    "mode",
    "lowConfidence",
    "queryTerms",
    "droppedTerms",
    "confidence",
    "concepts",
    "sections",
    "totalSections",
    "omittedSections",
    "truncated",
    "omittedConcepts",
  ]);
  assert.equal(first.omittedConcepts, 0);
});

test("identical sections are packed once and the first in rank order wins", (t) => {
  const shared = "## Notes\n\nShared boilerplate about the kestrel widget.\n";
  const index = tempBundle(t, {
    "a.md": note("Alpha kestrel", `Alpha body about the kestrel.\n\n${shared}`),
    "b.md": note("Beta kestrel", `Beta body about the kestrel.\n\n${shared}`),
    "c.md": note("Gamma", "Nothing relevant here.\n"),
  });
  const result = assembleContext(index, { query: "kestrel widget", budgetTokens: 1000 });
  const notes = result.sections.filter((section) => section.anchor.endsWith("#notes"));
  assert.equal(notes.length, 1, "one copy of the shared section");
  assert.equal(notes[0].text, "Notes\nShared boilerplate about the kestrel widget.");
  const hashes = new Set();
  result.sections.forEach((section) => {
    const match = conceptSections(index.byUri.get(section.uri)).find(
      (candidate) => candidate.anchor === section.anchor,
    );
    assert.ok(match);
    assert.equal(hashes.has(match.hash), false);
    hashes.add(match.hash);
  });
  assert.ok(result.sections.every((section) => section.uri !== "okf://demo/c"));
});

test("a best section larger than the budget is returned alone, cut at a sentence boundary", (t) => {
  const sentences = [];
  for (let n = 1; n <= 40; n += 1) {
    sentences.push(`Sentence ${n} about the heron migration pattern and its timing.`);
  }
  const index = tempBundle(t, {
    "long.md": note("Heron study", `## Findings\n\n${sentences.join(" ")}\n`),
    "short.md": note("Heron note", "## Aside\n\nA short heron aside.\n"),
  });
  const full = assembleContext(index, { query: "heron migration timing", budgetTokens: 5000 });
  const findings = full.sections.find((section) => section.anchor.endsWith("#findings"));
  assert.ok(findings && !findings.truncated && findings.tokens > 100);
  assert.equal(full.sections[0].anchor, findings.anchor, "the long section ranks first");
  const lean = { query: "heron migration timing", includeProvenance: false };
  // The response around the sections (query echo, candidate concepts, counters).
  const frame = frameTokens(assembleContext(index, Object.assign({ budgetTokens: 5000 }, lean)));
  const budget = frame + 120;
  const cut = assembleContext(index, Object.assign({ budgetTokens: budget }, lean));
  checkBudget(cut, budget, 20);
  assert.equal(cut.truncated, true);
  assert.equal(cut.sections.length, 1);
  assert.equal(cut.omittedSections, full.totalSections - 1);
  assert.equal(cut.omittedConcepts, 0);
  const [section] = cut.sections;
  assert.equal(section.anchor, findings.anchor);
  assert.equal(section.truncated, true);
  assert.ok(findings.text.startsWith(section.text));
  assert.match(section.text, /timing\.$/, "ends at a sentence boundary");
  // The fields around the text take their share; the text fills at least half of the rest.
  const overhead = serialisedTokens(Object.assign({}, section, { text: "" }));
  assert.ok(section.text.length > (budget - frame - overhead) * 4 * 0.5);
  // A budget below any sentence falls back to a word boundary, still within budget.
  const smallBudget = frame + overhead + 8;
  const small = assembleContext(index, Object.assign({ budgetTokens: smallBudget }, lean));
  checkBudget(small, smallBudget, 20);
  assert.equal(small.sections.length, 1);
  assert.ok(findings.text.startsWith(small.sections[0].text));
  assert.doesNotMatch(small.sections[0].text, /\s$/);
  // Below the section's own fields no section is returned, and nothing is over budget.
  const noneBudget = frame + overhead - 4;
  const none = assembleContext(index, Object.assign({ budgetTokens: noneBudget }, lean));
  checkBudget(none, noneBudget, 20);
  assert.deepEqual([none.sections, none.truncated], [[], false]);
  assert.ok(none.usedTokens <= noneBudget);
  assert.equal(none.omittedSections, none.totalSections);
});

test("filters, mode and asOf are honoured and the preamble carries the lead fields", () => {
  const index = buildProjectIndex(ALPINARIA);
  const landing = assembleContext(index, {
    query: "scarponi donna",
    types: ["Landing Page"],
    budgetTokens: 2000,
  });
  assert.ok(landing.sections.length > 0);
  landing.sections.forEach((section) => {
    assert.equal(index.byUri.get(section.uri).type, "Landing Page");
  });
  landing.concepts.forEach((concept) => {
    assert.equal(index.byUri.get(concept.uri).type, "Landing Page");
  });
  const prefixed = assembleContext(index, {
    query: "scarponi donna",
    pathPrefix: "decisions/",
    budgetTokens: 2000,
  });
  prefixed.sections.forEach((section) => {
    assert.ok(index.byUri.get(section.uri).path.startsWith("decisions/"));
  });
  const none = assembleContext(index, { query: "scarponi donna", bundle: "missing" });
  assert.deepEqual([none.sections, none.concepts], [[], []]);
  assert.equal(none.usedTokens, serialisedTokens(none));
  const all = assembleContext(index, { query: "scarponi trekking donna", mode: "all" });
  assert.equal(all.mode, "all");
  const any = assembleContext(index, { query: "scarponi trekking donna", mode: "any" });
  assert.equal(any.mode, "any");
  assert.ok(any.concepts.length >= all.concepts.length);
  const preamble = all.sections.find((section) => !section.anchor.includes("#"));
  assert.ok(preamble);
  const doc = index.byUri.get(preamble.uri);
  assert.ok(preamble.text.startsWith(`${doc.title}\n`));
  assert.equal(preamble.heading, null);
  assert.equal(preamble.title, doc.title);
  // asOf changes freshness in the provenance the same way it does in search.
  const stale = index.concepts.find((candidate) => candidate.signals.staleAfter);
  if (stale) {
    const later = assembleContext(index, {
      query: `"${stale.conceptId}"`,
      asOf: "2099-01-01",
      budgetTokens: 400,
    });
    const hit = later.sections.find((section) => section.uri === stale.uri);
    assert.ok(hit);
    assert.equal(hit.provenance.freshness, "stale");
  }
});

test("a no-answer query is flagged lowConfidence and yields weak sections; nonsense yields none", () => {
  const index = buildProjectIndex(ALPINARIA);
  const sidecar = fixtureQueries("alpinaria");
  const flagged = sidecar.queries
    .filter((query) => query.category === "no-answer")
    .map((query) => assembleContext(index, { query: query.query, asOf: sidecar.as_of }))
    .filter((result) => result.lowConfidence);
  assert.ok(flagged.length >= 5, `flagged ${flagged.length} no-answer queries`);
  flagged.forEach((result) => {
    assert.equal(result.mode, "any");
    result.sections.forEach((section) => {
      assert.ok(section.coverage < 0.5, "every packed section matched under half of the terms");
    });
  });
  const nonsense = assembleContext(index, { query: "zxqv wmbk plork" });
  assert.deepEqual([nonsense.sections, nonsense.concepts, nonsense.totalSections], [[], [], 0]);
  assert.equal(nonsense.lowConfidence, false);
  assert.equal(nonsense.truncated, false);
});

test("provenance comes from the concept's v0.2 signals and can be left out", () => {
  const index = buildProjectIndex(ALPINARIA);
  assert.equal(DEFAULT_PROVENANCE, "compact");
  const result = assembleContext(index, {
    query: "scarponi donna",
    budgetTokens: 1200,
    provenance: "full",
  });
  assert.ok(result.sections.length > 0);
  result.sections.forEach((section) => {
    const doc = index.byUri.get(section.uri);
    assert.deepEqual(Object.keys(section.provenance), [
      "status",
      "staleAfter",
      "freshness",
      "trustTier",
      "verified",
      "generated",
      "sources",
    ]);
    assert.equal(section.provenance.status, doc.signals.status);
    assert.equal(section.provenance.trustTier, doc.signals.trustTier);
    assert.equal(section.provenance.sources.length, doc.signals.sources.length);
    section.provenance.sources.forEach((source) => {
      assert.ok(Object.keys(source).every((key) => ["id", "resource", "author"].includes(key)));
    });
    if (doc.signals.generated) {
      assert.deepEqual(section.provenance.generated, {
        by: doc.signals.generated.by,
        at: doc.signals.generated.at,
      });
    }
  });
  const bare = assembleContext(index, {
    query: "scarponi donna",
    budgetTokens: 1200,
    includeProvenance: false,
  });
  bare.sections.forEach((section) => {
    assert.equal("provenance" in section, false);
  });
  // Same ranking; the lighter payload packs at least the same prefix.
  const anchors = bare.sections.map((section) => section.anchor);
  assert.deepEqual(
    anchors.slice(0, result.sections.length),
    result.sections.map((section) => section.anchor),
  );
  const compact = assembleContext(index, {
    query: "scarponi donna",
    budgetTokens: 1200,
    provenance: "compact",
  });
  compact.sections.forEach((section) => {
    const doc = index.byUri.get(section.uri);
    assert.deepEqual(section.provenance, {
      status: doc.signals.status,
      freshness: doc.signals.freshness,
      verified: doc.signals.verifiedEvents.length > 0,
      sourceCount: doc.signals.sources.filter((source) => source.valid !== false).length,
    });
  });
  // Compact is the default; none is the same as includeProvenance false.
  assert.deepEqual(
    assembleContext(index, { query: "scarponi donna", budgetTokens: 1200 }),
    compact,
  );
  assert.deepEqual(
    assembleContext(index, { query: "scarponi donna", budgetTokens: 1200, provenance: "none" }),
    bare,
  );
});

test("invalid options are rejected with TypeErrors", () => {
  const index = buildProjectIndex(ALPINARIA);
  assert.throws(
    () => assembleContext(index, { query: "scarponi", conceptLift: -1 }),
    /conceptLift must be a number from 0 through 10/,
  );
  assert.throws(() => assembleContext(index, {}), /requires a query/);
  assert.throws(() => assembleContext(index, { query: "   " }), /requires a query/);
  ["0", 0, 1.5, "abc", -3, 100001].forEach((budgetTokens) => {
    assert.throws(
      () => assembleContext(index, { query: "scarponi", budgetTokens }),
      /budgetTokens must be an integer from 1 through 100000/,
    );
  });
  assert.throws(
    () => assembleContext(index, { query: "scarponi", limit: 0 }),
    /limit must be an integer from 1 through 250/,
  );
  assert.throws(
    () => assembleContext(index, { query: "scarponi", conceptLimit: 51 }),
    /conceptLimit must be an integer from 1 through 50/,
  );
  assert.throws(
    () => assembleContext(index, { query: "scarponi", mode: "bogus" }),
    /Search mode must be one of auto, all, any/,
  );
  assert.throws(
    () => assembleContext(index, { query: "scarponi", minRelevance: 2 }),
    /minRelevance must be a number between 0 and 1/,
  );
});

test("the preamble weight scales only preamble scores and is validated", (t) => {
  const index = tempBundle(t, {
    "a.md": note(
      "Osprey nesting",
      "Lead about the osprey.\n\n## Nesting sites\n\nOsprey nesting on poles.\n",
    ),
  });
  const run = (preambleWeight) =>
    assembleContext(index, { query: "osprey nesting", budgetTokens: 1000, preambleWeight });
  const byAnchor = (result) => new Map(result.sections.map((section) => [section.anchor, section]));
  const full = byAnchor(run(1));
  const half = byAnchor(run(0.5));
  assert.equal(half.get("okf://demo/a").score, full.get("okf://demo/a").score * 0.5);
  assert.equal(
    half.get("okf://demo/a#nesting-sites").score,
    full.get("okf://demo/a#nesting-sites").score,
  );
  assert.equal(DEFAULT_PREAMBLE_WEIGHT, 0.5);
  assert.deepEqual(
    byAnchor(assembleContext(index, { query: "osprey nesting", budgetTokens: 1000 })),
    half,
  );
  [0, -1, 1.5, "x"].forEach((preambleWeight) => {
    assert.throws(() => run(preambleWeight), /preambleWeight must be a number greater than 0/);
  });
});

test("sections are computed per document, so an index update re-reads only changed concepts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-context-update-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "a.md"), note("Plover", "## Range\n\nPlover coastal range.\n"));
  fs.writeFileSync(
    path.join(root, "b.md"),
    note("Plover eggs", "## Clutch\n\nPlover clutch size.\n"),
  );
  const index = buildIndex([`demo=${root}`]);
  const before = assembleContext(index, { query: "plover", budgetTokens: 1000 });
  assert.ok(before.sections.some((section) => section.anchor === "okf://demo/a#range"));
  fs.writeFileSync(path.join(root, "a.md"), note("Plover", "## Habitat\n\nPlover dunes.\n"));
  const next = updateIndex(
    index,
    { upserts: [{ bundleId: "demo", relativePath: "a.md" }] },
    { maxChangeRatio: 1 },
  );
  assert.equal(next.byUri.get("okf://demo/b"), index.byUri.get("okf://demo/b"));
  assert.equal(
    conceptSections(next.byUri.get("okf://demo/b")),
    conceptSections(index.byUri.get("okf://demo/b")),
    "the unchanged concept keeps its memoised sections",
  );
  const anchors = assembleContext(next, { query: "plover", budgetTokens: 1000 }).sections.map(
    (section) => section.anchor,
  );
  assert.ok(anchors.includes("okf://demo/a#habitat"));
  assert.equal(anchors.includes("okf://demo/a#range"), false);
});

test("concept metadata is a bounded secondary signal; own text ranks first within a concept", (t) => {
  const index = tempBundle(t, {
    // The query terms live only in this concept's type, tags and path ...
    "runbooks/rotate-keys.md": note(
      "Credential rollover",
      "## Steps\n\nGenerate the new secret and deploy it.\n",
      "tags: [security]\n",
    ),
    // ... and once in the text of a long section of another concept.
    "notes/handbook.md": note(
      "Handbook",
      `## Practices\n\n${"Filler sentence about unrelated operations. ".repeat(30)}We rotate keys yearly.\n`,
    ),
  });
  const result = assembleContext(index, {
    query: "rotate keys security",
    mode: "any",
    budgetTokens: 5000,
  });
  const anchors = result.sections.map((section) => section.anchor);
  const practices = anchors.indexOf("okf://demo/notes/handbook#practices");
  const steps = anchors.indexOf("okf://demo/runbooks/rotate-keys#steps");
  assert.ok(practices >= 0 && steps >= 0, JSON.stringify(anchors));
  // The handbook's own-text match lifts it over the metadata-only sections of a higher concept.
  assert.ok(practices < steps, "a strong own-text match passes metadata-only evidence");
  const metadataOnly = result.sections[steps];
  assert.equal(metadataOnly.coverage, 0);
  assert.deepEqual(metadataOnly.matchedTerms, []);
  // Within a concept, own-text sections come first and outscore metadata-only ones.
  const byConcept = new Map();
  result.sections.forEach((section, position) => {
    if (!byConcept.has(section.uri)) byConcept.set(section.uri, []);
    byConcept.get(section.uri).push(Object.assign({ position }, section));
  });
  byConcept.forEach((sections) => {
    const own = sections.filter((section) => section.coverage > 0);
    sections
      .filter((section) => section.coverage === 0)
      .forEach((section) => {
        own.forEach((match) => {
          assert.ok(match.position < section.position && match.score > section.score);
        });
      });
  });
});

test("inherited metadata never inflates coverage or beats a section that holds the term", (t) => {
  const index = tempBundle(t, {
    "widgets/gizmo.md": note(
      "Gizmo",
      `Short lead.\n\n## Usage\n\n${"Background on the device and its history. ".repeat(20)}Calibrate the gizmo before use.\n`,
      "tags: [calibrate]\n",
    ),
  });
  const result = assembleContext(index, { query: "calibrate gizmo", budgetTokens: 5000 });
  const byAnchor = new Map(result.sections.map((section) => [section.anchor, section]));
  const usage = byAnchor.get("okf://demo/widgets/gizmo#usage");
  const preamble = byAnchor.get("okf://demo/widgets/gizmo");
  assert.equal(usage.coverage, 1);
  // The preamble holds "gizmo" in its title but "calibrate" only in the tags.
  assert.equal(preamble.coverage, 0.5);
  assert.deepEqual(preamble.matchedTerms, ["gizmo"]);
});
