"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { UsageError, parseArgs } = require("../src/cli");
const { buildProjectIndex } = require("../src/indexer");
const { tools } = require("../src/mcp/tools/search");
const { loadProjectConfig } = require("../src/project");

const CLI = path.join(__dirname, "..", "bin", "okf-mcp.js");
const ALPINARIA = path.join(__dirname, "fixtures", "retrieval", "alpinaria");
const ALPINARIA_BUNDLE = path.join(ALPINARIA, "bundles", "alpinaria");

function projectWithLanguages(t, languagesLine) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-search-project-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "a"));
  const config = path.join(root, "okf.project.yaml");
  fs.writeFileSync(
    config,
    ["bundles:", "  - id: a", "    root: a"]
      .concat(languagesLine ? [languagesLine] : [])
      .concat([""])
      .join("\n"),
    "utf8",
  );
  return loadProjectConfig(config);
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  return result;
}

const descriptionsOf = (tool) =>
  [tool.description].concat(
    Object.values(tool.inputSchema.properties).map((property) => property.description),
  );

test("project config accepts languages as auto, none, or supported codes", (t) => {
  assert.equal(projectWithLanguages(t, "").languages, "auto");
  assert.equal(projectWithLanguages(t, "languages: auto").languages, "auto");
  assert.deepEqual(projectWithLanguages(t, "languages: none").languages, []);
  assert.deepEqual(projectWithLanguages(t, "languages: [it, en]").languages, ["it", "en"]);
  assert.deepEqual(projectWithLanguages(t, 'languages: "en,it"').languages, ["en", "it"]);
  const unsupported = projectWithLanguages(t, "languages: [fr]");
  assert.equal(unsupported.languages, "auto");
  assert.ok(
    unsupported.errors.some(
      (error) =>
        error.code === "invalid_languages" && /Unsupported search language: fr/.test(error.message),
    ),
  );
  const wrongType = projectWithLanguages(t, "languages: 3");
  assert.ok(wrongType.errors.some((error) => error.code === "invalid_languages"));
});

test("the CLI parses --languages and the search mode, floor and prior flags", () => {
  const args = parseArgs([
    "--root",
    "bundle",
    "--languages",
    "it,en",
    "search",
    "scarponi",
    "--mode",
    "any",
    "--min-coverage",
    "0.5",
    "--min-relevance",
    "0.1",
    "--freshness-prior",
  ]);
  assert.equal(args.languages, "it,en");
  assert.deepEqual(args.positional, ["search", "scarponi"]);
  assert.equal(args.search.mode, "any");
  assert.equal(args.search.minCoverage, "0.5");
  assert.equal(args.search.minRelevance, "0.1");
  assert.equal(args.search.freshnessPrior, true);
  assert.throws(
    () => parseArgs(["--languages", "fr"]),
    (error) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /Unsupported search language: fr/);
      return true;
    },
  );
  assert.throws(() => parseArgs(["--languages"]), /--languages requires/);
  assert.throws(() => parseArgs(["--mode"]), /--mode requires a value/);
});

test("the search command prints the 0.10 fields and honours --languages and --mode", () => {
  const auto = runCli([
    "--root",
    ALPINARIA_BUNDLE,
    "search",
    "scarpone trekking donna",
    "--mode",
    "all",
  ]);
  assert.equal(auto.status, 0, auto.stderr);
  const stemmed = JSON.parse(auto.stdout);
  [
    "total",
    "mode",
    "allTermsTotal",
    "lowConfidence",
    "queryTerms",
    "droppedTerms",
    "results",
  ].forEach((key) => {
    assert.ok(key in stemmed, key);
  });
  assert.equal(stemmed.mode, "all");
  assert.ok(typeof stemmed.results[0].coverage === "number");
  const literal = runCli([
    "--root",
    ALPINARIA_BUNDLE,
    "--languages",
    "none",
    "search",
    "scarpone trekking donna",
    "--mode",
    "all",
  ]);
  assert.equal(literal.status, 0, literal.stderr);
  // Without stemming the singular "scarpone" no longer matches the plural pages.
  assert.ok(JSON.parse(literal.stdout).total < stemmed.total);
  const invalid = runCli(["--root", ALPINARIA_BUNDLE, "search", "scarponi", "--mode", "bogus"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Search mode must be one of auto, all, any/);
});

test("search_concepts and list_concepts expose mode, floors and prior but not languages", () => {
  const search = tools.search_concepts.inputSchema.properties;
  const list = tools.list_concepts.inputSchema.properties;
  [search.mode, list.mode].forEach((mode) => {
    assert.deepEqual(mode.enum, ["auto", "all", "any"]);
    assert.equal(mode.default, "auto");
  });
  ["minCoverage", "minRelevance"].forEach((name) => {
    assert.deepEqual(
      [search[name].type, search[name].minimum, search[name].maximum],
      ["number", 0, 1],
    );
    assert.equal(name in list, false);
  });
  assert.deepEqual([search.freshnessPrior.type, search.freshnessPrior.default], ["boolean", false]);
  assert.equal("languages" in search, false);
  assert.equal("languages" in list, false);
  assert.equal(search.query.maxLength, 512);
  assert.deepEqual(search.detail.enum, ["compact", "full"]);
});

test("the search descriptions ask for keywords and identifiers and explain confidence (R-11)", () => {
  const description = tools.search_concepts.description;
  [
    /keywords in the catalog's languages/,
    /identifiers/,
    /matching some of the terms/,
    /lowConfidence/,
    /coverage/,
    /relevance/,
  ].forEach((pattern) => {
    assert.match(description, pattern);
  });
  [tools.search_concepts, tools.list_concepts].forEach((tool) => {
    assert.doesNotMatch(tool.inputSchema.properties.query.description, /^(Optional )?all-term/i);
    assert.doesNotMatch(tool.description, /all terms must match/i);
  });
  assert.match(tools.list_concepts.inputSchema.properties.query.description, /stop words/);
});

test("no catalog text reaches the search tool descriptions or schemas (S-3)", () => {
  const index = buildProjectIndex(path.join(ALPINARIA, "okf.project.yaml"));
  const sentinels = index.concepts
    .flatMap((doc) => [doc.title, doc.description])
    .filter((text) => typeof text === "string" && text.trim().length >= 6);
  assert.ok(sentinels.length > 100);
  const surfaces = descriptionsOf(tools.search_concepts).concat(
    descriptionsOf(tools.list_concepts),
  );
  surfaces.forEach((text) => {
    sentinels.forEach((sentinel) => {
      assert.equal(text.includes(sentinel), false, `tool text contains catalog text: ${sentinel}`);
    });
  });
  // The descriptions are constants: identical whatever index the server holds.
  const again = require("../src/mcp/tools/search").tools;
  assert.equal(again.search_concepts.description, tools.search_concepts.description);
});

test("the tool handlers pass mode and floors through and translate invalid values", async () => {
  const state = { index: buildProjectIndex(path.join(ALPINARIA, "okf.project.yaml")) };
  const parse = (result) => JSON.parse(result.content[0].text);
  const any = parse(
    await tools.search_concepts.handler(state, {
      query: "scarponi donna",
      mode: "any",
      minCoverage: 0.5,
    }),
  );
  assert.equal(any.mode, "any");
  assert.ok(any.results.length > 0);
  assert.ok(any.results.every((entry) => entry.coverage >= 0.5));
  assert.deepEqual(Object.keys(any.results[0]).sort(), [
    "coverage",
    "description",
    "relevance",
    "title",
    "type",
    "uri",
  ]);
  const listed = parse(
    await tools.list_concepts.handler(state, { query: "scarponi donna", mode: "all" }),
  );
  assert.equal(listed.mode, "all");
  assert.ok(listed.allTermsTotal >= listed.total);
  await assert.rejects(
    () => tools.search_concepts.handler(state, { query: "scarponi", mode: "bogus" }),
    /Search mode must be one of auto, all, any/,
  );
  await assert.rejects(
    () => tools.search_concepts.handler(state, { query: "scarponi", minRelevance: 2 }),
    /minRelevance must be a number between 0 and 1/,
  );
});
