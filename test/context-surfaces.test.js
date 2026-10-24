"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { UsageError, parseArgs, usage } = require("../src/cli");
const { buildProjectIndex } = require("../src/indexer");
const { TOOL_ORDER } = require("../src/mcp/registry");
const { tools } = require("../src/mcp/tools/context");
const { tools: searchTools } = require("../src/mcp/tools/search");
const { callJson, connectMcp } = require("./mcp-client");

const CLI = path.join(__dirname, "..", "bin", "okf-mcp.js");
const ALPINARIA = path.join(__dirname, "fixtures", "retrieval", "alpinaria");
const ALPINARIA_BUNDLE = path.join(ALPINARIA, "bundles", "alpinaria");
// Never a word of any language, never an identifier in the catalogs.
const SENTINEL = "zqxsentinel7";

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

// A root whose every text field carries the sentinel: title, description,
// tag, alias, a heading and a paragraph. File names stay free of it so URIs
// and paths, which error messages may cite, cannot leak it.
function sentinelRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-context-sentinel-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "index.md"),
    ["---", 'okf_version: "0.2"', "---", "", "# Root", "", "- [Widget](notes/widget.md)", ""].join(
      "\n",
    ),
  );
  fs.mkdirSync(path.join(root, "notes"));
  fs.writeFileSync(
    path.join(root, "notes", "widget.md"),
    [
      "---",
      "type: Note",
      `title: "Widget ${SENTINEL} guide"`,
      `description: "How the ${SENTINEL} widget is set up."`,
      `tags: ["${SENTINEL}"]`,
      `aliases: ["${SENTINEL} widget"]`,
      "---",
      "",
      `# Widget ${SENTINEL} guide`,
      "",
      "Lead paragraph.",
      "",
      `## Setup ${SENTINEL}`,
      "",
      `Turn the ${SENTINEL} dial to three and wait.`,
      "",
    ].join("\n"),
  );
  return root;
}

test("get_context is advertised right after search_concepts, read-only and unprefixed", () => {
  assert.equal(TOOL_ORDER.indexOf("get_context"), TOOL_ORDER.indexOf("search_concepts") + 1);
  const tool = tools.get_context;
  assert.deepEqual(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(tool.inputSchema.required, ["query"]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  const properties = tool.inputSchema.properties;
  assert.deepEqual(
    [
      properties.budgetTokens.minimum,
      properties.budgetTokens.maximum,
      properties.budgetTokens.default,
    ],
    [1, 100000, 1200],
  );
  assert.deepEqual(
    [properties.limit.minimum, properties.limit.maximum, properties.limit.default],
    [1, 250, 20],
  );
  assert.deepEqual(
    [properties.includeProvenance.type, properties.includeProvenance.default],
    ["boolean", true],
  );
  assert.deepEqual(
    [properties.provenance.enum, properties.provenance.default],
    [["compact", "full", "none"], "compact"],
  );
  assert.equal(properties.query.maxLength, 512);
  assert.equal("languages" in properties, false);
  assert.equal("conceptLimit" in properties, false);
  // The shared filters read exactly as they do on search_concepts.
  const search = searchTools.search_concepts.inputSchema.properties;
  [
    "mode",
    "minCoverage",
    "minRelevance",
    "bundle",
    "types",
    "tagsAny",
    "statuses",
    "asOf",
    "frontmatter",
    "verifiedBy",
  ].forEach((name) => {
    assert.ok(properties[name], name);
    assert.deepEqual(properties[name], search[name], name);
  });
  assert.equal("detail" in properties, false);
  assert.equal("offset" in properties, false);
});

test("the description explains budget, anchors and provenance and repeats the query guidance", () => {
  const description = tools.get_context.description;
  [
    /budgetTokens/,
    /ceil\(characters \/ 4\)/,
    /never exceeded/,
    /The budget covers what is delivered/,
    /Provenance is compact by default/,
    /truncated/,
    /anchor/,
    /uri#heading-slug/,
    /okf-mcp extension/,
    /set provenance to full/,
    /Ranking follows the candidate concept order/,
    /keywords in the catalog's languages/,
    /identifiers/,
    /double quotes/,
    /lowConfidence/,
  ].forEach((pattern) => {
    assert.match(description, pattern);
  });
  assert.match(tools.get_context.inputSchema.properties.query.description, /stop words/);
  // The guidance is the one search_concepts gives, verbatim.
  const guidance = /Write it as keywords[\s\S]*are dropped\./.exec(
    searchTools.search_concepts.description,
  )[0];
  assert.ok(description.endsWith(`For the query, w${guidance.slice(1)}`));
});

test("no catalog text reaches the get_context description or schema (S-3)", () => {
  const index = buildProjectIndex(path.join(ALPINARIA, "okf.project.yaml"));
  const sentinels = index.concepts
    .flatMap((doc) => [doc.title, doc.description])
    .filter((text) => typeof text === "string" && text.trim().length >= 6);
  assert.ok(sentinels.length > 100);
  descriptionsOf(tools.get_context).forEach((text) => {
    sentinels.forEach((sentinel) => {
      assert.equal(text.includes(sentinel), false, `tool text contains catalog text: ${sentinel}`);
    });
  });
});

test("S-3 over MCP: a sentinel in every text field is absent from initialize, tools/list, prompts/list and error messages, and present in get_context sections", async (t) => {
  const root = sentinelRoot(t);
  // The shape `okf-mcp --root <dir>` builds (see test/root-mode.test.js).
  const { client } = await connectMcp(t, [], { rootPath: root });
  const instructions = client.getInstructions();
  assert.equal(String(instructions === undefined ? "" : instructions).includes(SENTINEL), false);
  assert.equal(JSON.stringify(client.getServerVersion() || null).includes(SENTINEL), false);
  const listed = await client.listTools();
  assert.equal(JSON.stringify(listed).includes(SENTINEL), false);
  assert.ok(listed.tools.some((tool) => tool.name === "get_context"));
  const templates = await client.listResourceTemplates();
  assert.ok(templates.resourceTemplates.length > 0);
  assert.equal(JSON.stringify(templates).includes(SENTINEL), false);
  // prompts/list: either an empty-of-catalog listing or an unsupported-method
  // error, and neither may carry the token.
  try {
    assert.equal(JSON.stringify(await client.listPrompts()).includes(SENTINEL), false);
  } catch (error) {
    assert.equal(String(error.message).includes(SENTINEL), false);
  }
  // Positive control: the root really loaded the sentinel concept, so the
  // absences above are not vacuous.
  const resources = await client.listResources();
  assert.ok(JSON.stringify(resources).includes(SENTINEL));
  const failures = [
    { name: "get_context", arguments: { query: SENTINEL, mode: "bogus" } },
    { name: "get_context", arguments: { query: SENTINEL, budgetTokens: 0 } },
    { name: "get_context", arguments: { query: SENTINEL, minRelevance: 7 } },
    { name: "get_context", arguments: {} },
    {
      name: "get_context",
      arguments: { query: Array.from({ length: 20 }, (_, n) => `${SENTINEL}${n}`).join(" ") },
    },
    { name: "search_concepts", arguments: { query: SENTINEL, mode: "bogus" } },
    { name: "get_concept", arguments: { uri: "okf://missing/nothing" } },
  ];
  // Failures arrive either as JSON-RPC errors (schema rejections) or as
  // isError results (tool execution errors); neither form may carry the token.
  for (const call of failures) {
    const label = `${call.name}(${Object.keys(call.arguments).join(", ")})`;
    let outcome;
    try {
      outcome = { result: await client.callTool(call) };
    } catch (error) {
      outcome = { error };
    }
    if (outcome.error) {
      assert.equal(String(outcome.error.message).includes(SENTINEL), false, `${label} message`);
      assert.equal(JSON.stringify(outcome.error.data || null).includes(SENTINEL), false, label);
    } else {
      assert.equal(outcome.result.isError, true, `${label} did not fail`);
      assert.equal(JSON.stringify(outcome.result).includes(SENTINEL), false, `${label} payload`);
    }
  }
  const { payload } = await callJson(client, "get_context", { query: SENTINEL, budgetTokens: 400 });
  assert.ok(payload.sections.length >= 2);
  assert.ok(payload.sections.every((section) => section.text.includes(SENTINEL)));
  assert.ok(
    payload.sections.some(
      (section) => section.anchor === `okf://${path.basename(root)}/notes/widget#setup-${SENTINEL}`,
    ),
    JSON.stringify(payload.sections.map((section) => section.anchor)),
  );
  assert.ok(payload.usedTokens <= 400);
  assert.equal(payload.estimator, "chars/4");
});

test("the tool handler passes options through and translates invalid values", async () => {
  const state = { index: buildProjectIndex(path.join(ALPINARIA, "okf.project.yaml")) };
  const parse = (result) => JSON.parse(result.content[0].text);
  const packed = parse(
    await tools.get_context.handler(state, {
      query: "scarponi donna",
      budgetTokens: 300,
      limit: 4,
      types: ["Landing Page"],
      includeProvenance: false,
    }),
  );
  assert.equal(packed.budgetTokens, 300);
  assert.ok(packed.usedTokens <= 300);
  assert.ok(packed.sections.length > 0 && packed.sections.length <= 4);
  packed.sections.forEach((section) => {
    assert.equal(state.index.byUri.get(section.uri).type, "Landing Page");
    assert.equal("provenance" in section, false);
  });
  const withProvenance = parse(
    await tools.get_context.handler(state, { query: "scarponi donna", budgetTokens: 300 }),
  );
  assert.ok(withProvenance.sections.every((section) => section.provenance));
  // The candidate floors work as on search_concepts.
  const floored = parse(
    await tools.get_context.handler(state, {
      query: "scarponi trekking donna",
      mode: "any",
      minCoverage: 1,
    }),
  );
  const unfloored = parse(
    await tools.get_context.handler(state, { query: "scarponi trekking donna", mode: "any" }),
  );
  assert.ok(floored.concepts.length > 0);
  assert.ok(floored.concepts.every((concept) => concept.coverage === 1));
  assert.ok(unfloored.concepts.some((concept) => concept.coverage < 1));
  const relevant = parse(
    await tools.get_context.handler(state, { query: "scarponi donna", minRelevance: 0.9 }),
  );
  assert.ok(relevant.concepts.every((concept) => concept.relevance >= 0.9));
  assert.ok(
    relevant.sections.every((section) => relevant.concepts.some((c) => c.uri === section.uri)),
  );
  await assert.rejects(
    () => tools.get_context.handler(state, { query: "scarponi", mode: "bogus" }),
    /Search mode must be one of auto, all, any/,
  );
  await assert.rejects(
    () => tools.get_context.handler(state, { query: "scarponi", budgetTokens: 1.5 }),
    /budgetTokens must be an integer from 1 through 100000/,
  );
  await assert.rejects(() => tools.get_context.handler(state, {}), /requires a query/);
});

test("the CLI context command parses --budget and --limit and prints the JSON result", () => {
  const args = parseArgs([
    "--root",
    "bundle",
    "context",
    "scarponi",
    "donna",
    "--budget",
    "300",
    "--limit",
    "3",
    "--type",
    "Landing Page",
  ]);
  assert.deepEqual(args.positional, ["context", "scarponi", "donna"]);
  assert.deepEqual(args.context, { budgetTokens: 300, limit: 3 });
  assert.deepEqual(args.search.types, ["Landing Page"]);
  assert.deepEqual(parseArgs(["--root", "bundle", "search", "x"]).context, {});
  ["--budget", "--limit"].forEach((flag) => {
    assert.throws(
      () => parseArgs([flag, "abc"]),
      (error) => error instanceof UsageError && /requires a positive integer/.test(error.message),
    );
    assert.throws(() => parseArgs([flag]), /requires a positive integer/);
    assert.throws(() => parseArgs([flag, "0"]), /requires a positive integer/);
  });
  assert.match(usage(), /context <query>/);
  assert.match(usage(), /--budget <tokens>/);

  const run = runCli([
    "--root",
    ALPINARIA_BUNDLE,
    "context",
    "scarponi trekking donna",
    "--budget",
    "300",
    "--limit",
    "3",
    "--type",
    "Landing Page",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.budgetTokens, 300);
  assert.equal(result.estimator, "chars/4");
  assert.ok(result.usedTokens <= 300);
  assert.ok(result.sections.length >= 1 && result.sections.length <= 3);
  const index = buildProjectIndex(path.join(ALPINARIA, "okf.project.yaml"));
  result.sections.forEach((section) => {
    assert.equal(index.byUri.get(section.uri).type, "Landing Page");
    assert.deepEqual(Object.keys(section.provenance), [
      "status",
      "freshness",
      "verified",
      "sourceCount",
    ]);
  });
  assert.equal(parseArgs(["context", "x", "--provenance", "full"]).context.provenance, "full");
  assert.throws(
    () => parseArgs(["context", "x", "--provenance", "verbose"]),
    (error) => error instanceof UsageError && /--provenance requires one of/.test(error.message),
  );
  const none = runCli([
    "--root",
    ALPINARIA_BUNDLE,
    "context",
    "scarponi trekking donna",
    "--provenance",
    "none",
  ]);
  assert.equal(none.status, 0, none.stderr);
  assert.ok(JSON.parse(none.stdout).sections.every((section) => !("provenance" in section)));
  assert.match(usage(), /--provenance compact\|full\|none/);
  const missing = runCli(["--root", ALPINARIA_BUNDLE, "context"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /context requires a query/);
  const invalid = runCli(["--root", ALPINARIA_BUNDLE, "context", "scarponi", "--mode", "bogus"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Search mode must be one of auto, all, any/);
});
