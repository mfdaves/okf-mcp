"use strict";

// Views (plan I-2d): a principal reads the bundles its audiences allow, from
// a state built from those bundles alone. The fixture plants a sentinel in
// every part of two restricted bundles (titles, descriptions, tags, types,
// bodies, file names) and in nothing a caller sends, so a sentinel in any
// answer is a leak.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runMcpHttpServer } = require("../src/mcp/http");
const { callTool, createStateAsync, viewStateFor } = require("../src/mcp/server");
const { loadProjectConfig } = require("../src/project");
const { connectHttp, writeTokenFile } = require("./mcp-client");

const SENTINEL = /sentinelhr|sentinelboard/i;
const HIDDEN_URI = "okf://hr/policies/salaries";
const OPEN_URI = "okf://open/handbook";

function git(root, args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const result = spawnSync("git", ["-C", root].concat(args), { encoding: "utf8", env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function conceptText(concept) {
  const relations = (concept.relations || []).flatMap((relation) => [
    `  - type: ${JSON.stringify(relation.type)}`,
    `    target: ${JSON.stringify(relation.target)}`,
  ]);
  return [
    "---",
    `type: ${JSON.stringify(concept.type)}`,
    `title: ${JSON.stringify(concept.title)}`,
    `description: ${JSON.stringify(concept.description)}`,
    `tags: ${JSON.stringify(concept.tags)}`,
    'lang: "en"',
    "generated:",
    '  at: "2026-11-01T09:00:00Z"',
    '  by: "human:seed"',
    'status: "stable"',
    ...(relations.length ? ["relations:", ...relations] : []),
    "---",
    "",
    concept.body,
    "",
  ].join("\n");
}

function writeBundle(root, id, title, concepts) {
  const dir = path.join(root, id);
  const index = ["---", 'okf_version: "0.2"', "---", "", `# ${title}`, ""];
  for (const [file, concept] of Object.entries(concepts)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), conceptText(concept));
    index.push(`- [${concept.title}](${file})`);
  }
  fs.writeFileSync(path.join(dir, "index.md"), `${index.join("\n")}\n`);
}

const PROJECT = [
  "project: views",
  "bundles:",
  "  - id: open",
  "    root: open",
  "  - id: hr",
  "    root: hr",
  "    audiences: [hr]",
  "  - id: board",
  "    root: board",
  "    audiences: [management]",
  "writePolicy:",
  "  defaultEffect: deny",
  "  rules:",
  "    - name: everyone",
  '      actors: ["human:*"]',
  '      bundles: ["*"]',
  "",
];

// An open bundle and two restricted ones. The hr concept points at the open
// one, so the open concept has an inbound edge from a bundle outsiders do
// not read.
function makeProject(t, project = PROJECT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-views-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBundle(root, "open", "Open handbook", {
    "handbook.md": {
      type: "Policy",
      title: "Staff handbook",
      description: "Rules for everyone.",
      tags: ["staff", "pay"],
      body: "# Staff handbook\n\nOffice hours are 9 to 18. Salary questions go to the people team.",
    },
  });
  writeBundle(root, "hr", "People SENTINELHR", {
    "policies/salaries.md": {
      type: "SentinelhrPolicy",
      title: "SENTINELHR salary bands",
      description: "sentinelhr bands by level.",
      tags: ["sentinelhr", "pay"],
      body: "# SENTINELHR salary bands\n\nLevel 3 earns sentinelhr-42000 a year. See the [handbook](okf://open/handbook).",
      relations: [{ type: "related_to", target: OPEN_URI }],
    },
    "policies/sentinelhr-reviews.md": {
      type: "Policy",
      title: "Review calendar",
      description: "When salary reviews happen.",
      tags: ["pay"],
      body: "# Review calendar\n\nReviews follow the [salary bands](salaries.md) in sentinelhr-march.",
    },
  });
  writeBundle(root, "board", "Board SENTINELBOARD", {
    "plan.md": {
      type: "Decision",
      title: "SENTINELBOARD acquisition plan",
      description: "sentinelboard target.",
      tags: ["sentinelboard"],
      body: "# SENTINELBOARD acquisition plan\n\nBuy sentinelboard-co before the summer.",
    },
  });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), project.join("\n"));
  git(root, ["init", "--quiet", "-b", "main"]);
  git(root, ["config", "user.name", "Repo Committer"]);
  git(root, ["config", "user.email", "committer@example.invalid"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return { root, projectPath: path.join(root, "okf.project.yaml") };
}

const principal = (name, audiences) => ({
  subject: name,
  actor: `human:${name}`,
  scopes: new Set(["okf.read", "okf.write"]),
  audiences: new Set(audiences),
});
const TOKENS = [
  { token: "token-outsider", subject: "olga", actor: "human:olga", audiences: [] },
  { token: "token-hr", subject: "hugo", actor: "human:hugo", audiences: ["hr"] },
  { token: "token-both", subject: "bea", actor: "human:bea", audiences: ["hr", "management"] },
].map((entry) => Object.assign({ scopes: ["okf.read", "okf.write"] }, entry));

async function startServer(t, projectPath, extra) {
  const file = writeTokenFile(t, TOKENS);
  const server = await runMcpHttpServer(
    [],
    Object.assign(
      {
        projectPath,
        allowWrite: true,
        actor: "process:okf-views",
        gitCommit: true,
        http: {
          port: 0,
          mcpPath: "/mcp",
          publicUrl: null,
          allowedHosts: [],
          allowedOrigins: [],
          auth: { mode: "tokens", file },
          env: {},
        },
      },
      extra,
    ),
  );
  t.after(() => server.close());
  const connect = (token) => connectHttp(t, `http://127.0.0.1:${server.port}/mcp`, { token });
  return { server, connect };
}

// Everything a call answers, as one string: content, structured content, or
// the error.
async function answerText(run) {
  try {
    return JSON.stringify(await run());
  } catch (error) {
    return `error ${error.code ?? ""} ${error.message}`;
  }
}

// A value for an input property, chosen by its name from `values`. Nothing
// in `values` carries a sentinel: an answer may echo what was sent.
function valueFor(name, schema, values) {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum) return schema.enum[0];
  if (type === "integer" || type === "number") return schema.minimum ?? 1;
  if (type === "boolean") return true;
  if (type === "array") return [valueFor(name, schema.items || { type: "string" }, values)];
  if (type === "object") return {};
  if (/bundle/i.test(name)) return values.bundle;
  if (/^(uri|concept|from|to|source|target|linkedTo|linkedFrom|root)$/i.test(name))
    return values.uri;
  if (/path|prefix/i.test(name)) return values.path;
  if (name === "id") return values.id;
  if (/tag/i.test(name)) return "pay";
  if (/type/i.test(name)) return "Policy";
  return values.text;
}

function argumentSets(tool) {
  const properties = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required || []);
  const hidden = {
    bundle: "hr",
    uri: HIDDEN_URI,
    path: "policies/salaries.md",
    id: "policies/salaries",
    text: "salary bands level reviews acquisition plan",
  };
  const open = {
    bundle: "open",
    uri: OPEN_URI,
    path: "handbook.md",
    id: "handbook",
    text: hidden.text,
  };
  const board = {
    bundle: "board",
    uri: "okf://board/plan",
    path: "plan.md",
    id: "plan",
    text: hidden.text,
  };
  const fill = (values, names) =>
    Object.fromEntries(names.map((name) => [name, valueFor(name, properties[name], values)]));
  const all = Object.keys(properties);
  const needed = all.filter((name) => required.has(name));
  const sets = [{}];
  for (const values of [hidden, open, board]) {
    sets.push(fill(values, needed), fill(values, all));
    // One optional property at a time next to the required ones.
    for (const name of all.filter((entry) => !required.has(entry))) {
      sets.push(fill(values, [...needed, name]));
    }
  }
  return sets;
}

// Calls every tool offered to `client` with every argument set and reads
// every resource; returns the answers that carry a sentinel, by tool.
async function sweep(client) {
  const leaks = new Map();
  const note = (name, text) => {
    if (SENTINEL.test(text)) leaks.set(name, (leaks.get(name) || 0) + 1);
  };
  const { tools } = await client.listTools();
  note("tools/list", JSON.stringify(tools));
  for (const tool of tools) {
    for (const args of argumentSets(tool)) {
      note(
        tool.name,
        await answerText(() => client.callTool({ name: tool.name, arguments: args })),
      );
    }
  }
  note("resources/list", await answerText(() => client.listResources()));
  note("resources/templates/list", await answerText(() => client.listResourceTemplates()));
  for (const uri of [
    HIDDEN_URI,
    "okf://hr/policies/salaries.md",
    "okf://hr/index.md",
    "okf://board/plan",
    OPEN_URI,
  ]) {
    note("resources/read", await answerText(() => client.readResource({ uri })));
  }
  return { leaks, tools: tools.map((tool) => tool.name) };
}

test("bundle audiences are read from the project file and a misspelt key closes the bundle", (t) => {
  const { projectPath } = makeProject(t);
  const project = loadProjectConfig(projectPath);
  assert.deepEqual(project.errors, []);
  assert.deepEqual(
    project.bundles.map((bundle) => [bundle.id, bundle.audiences]),
    [
      ["open", []],
      ["hr", ["hr"]],
      ["board", ["management"]],
    ],
  );
  for (const [line, code, field] of [
    ["    audience: [hr]", "unknown_bundle_key", "audience"],
    ["    audiences: hr", "invalid_bundle_audiences", "audiences"],
    ["    audiences: []", "invalid_bundle_audiences", "audiences"],
    ["    audiences: [HR]", "invalid_bundle_audiences", "audiences"],
    ["    audiences: [hr, hr]", "invalid_bundle_audiences", "audiences"],
    ["    readers: [hr]", "unknown_bundle_key", "readers"],
  ]) {
    const broken = makeProject(
      t,
      PROJECT.map((entry) => (entry === "    audiences: [hr]" ? line : entry)),
    );
    const loaded = loadProjectConfig(broken.projectPath);
    assert.deepEqual(
      loaded.errors.map((error) => [error.code, error.bundle, error.field]),
      [[code, "hr", field]],
      line,
    );
    // Closed to every audience, not left open.
    assert.deepEqual(loaded.bundles.find((bundle) => bundle.id === "hr").audiences, ["!"], line);
  }
});

test("a principal is served from the state of its view, built once and kept", async (t) => {
  const { projectPath } = makeProject(t);
  const state = await createStateAsync([], {
    projectPath,
    allowWrite: true,
    actor: "process:okf-views",
    maxViews: 2,
  });
  const bundles = (view) => view.index.bundles.map((bundle) => bundle.id).sort();
  const outsider = viewStateFor(state, principal("olga", []));
  const member = viewStateFor(state, principal("hugo", ["hr"]));
  assert.deepEqual(bundles(outsider), ["open"]);
  assert.deepEqual(bundles(member), ["hr", "open"]);
  assert.notEqual(outsider, state);
  assert.notEqual(member, outsider);
  // The same audiences, and audiences the project does not name, share a view.
  assert.equal(viewStateFor(state, principal("anna", ["hr"])), member);
  assert.equal(viewStateFor(state, principal("otto", ["sales"])), outsider);
  // A view holds nothing of the other bundles: index, project, store, services.
  for (const holder of [
    outsider.index,
    outsider.project,
    outsider.authoringService.store.getBundles(),
    outsider.liveAuthoringService.store.project,
  ]) {
    assert.doesNotMatch(JSON.stringify(holder), /sentinel|"hr"|board/i);
  }
  assert.equal(outsider.base, state);
  // Whoever reads every bundle is served from the server's own state.
  assert.equal(viewStateFor(state, principal("bea", ["hr", "management"])), state);
  assert.equal(
    viewStateFor(state, { subject: "stdio", allBundles: true, scopes: new Set() }),
    state,
  );
  // At most maxViews are kept: the least recently used one, the member's, goes.
  viewStateFor(state, principal("mia", ["management"]));
  assert.equal(state.views.size, 2);
  assert.equal(viewStateFor(state, principal("olga", [])), outsider);
  assert.notEqual(viewStateFor(state, principal("hugo", ["hr"])), member);
});

test("a project without audiences has one view, the server's own state", async (t) => {
  const { projectPath } = makeProject(
    t,
    PROJECT.filter((line) => !line.includes("audiences")),
  );
  const state = await createStateAsync([], { projectPath });
  assert.equal(viewStateFor(state, principal("olga", [])), state);
  assert.equal(state.views, undefined);
});

test("an outsider obtains nothing of a restricted bundle through any tool or resource", async (t) => {
  const { projectPath } = makeProject(t);
  const { connect } = await startServer(t, projectPath);
  const outsider = await sweep(await connect("token-outsider"));
  assert.deepEqual([...outsider.leaks], [], "an answer to the outsider carries a sentinel");
  // The same calls do find the sentinel for a member, so the sweep can see a leak;
  // the member in turn learns nothing of the other restricted bundle.
  const member = await sweep(await connect("token-hr"));
  assert.ok(member.leaks.size >= 8, `only ${[...member.leaks.keys()].join(", ")} reach the bundle`);
  for (const name of [
    "list_concepts",
    "search_concepts",
    "get_concept",
    "get_neighbors",
    "list_tags",
    "list_types",
    "resources/list",
    "resources/read",
  ]) {
    assert.ok(member.leaks.has(name), `${name} does not reach the member's bundle`);
  }
  const hrOnly = await connect("token-hr");
  const board = [];
  for (const tool of (await hrOnly.listTools()).tools) {
    for (const args of argumentSets(tool)) {
      const text = await answerText(() => hrOnly.callTool({ name: tool.name, arguments: args }));
      if (/sentinelboard/i.test(text)) board.push(tool.name);
    }
  }
  assert.deepEqual(board, []);
  // Both were offered the same tools, write tools included.
  assert.deepEqual(outsider.tools, member.tools);
  assert.ok(outsider.tools.includes("okf_apply_changes") && outsider.tools.length > 25);
});

test("a restricted bundle answers an outsider like a bundle that does not exist", async (t) => {
  const { projectPath } = makeProject(t);
  const { connect } = await startServer(t, projectPath);
  const client = await connect("token-outsider");
  const same = async (name, hidden, missing) => {
    const [first, second] = await Promise.all(
      [hidden, missing].map((args) => answerText(() => client.callTool({ name, arguments: args }))),
    );
    // The two answers differ only in the name sent and the time of the call.
    const plain = (text) => text.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>");
    assert.equal(plain(first).replaceAll("hr", "nope"), plain(second), name);
  };
  await same("list_concepts", { bundle: "hr" }, { bundle: "nope" });
  await same(
    "search_concepts",
    { query: "salary", bundle: "hr" },
    { query: "salary", bundle: "nope" },
  );
  await same("validate_bundle", { bundle: "hr" }, { bundle: "nope" });
  await same(
    "get_concept",
    { bundle: "hr", path: "policies/salaries.md" },
    { bundle: "nope", path: "policies/salaries.md" },
  );
  await same(
    "get_concept",
    { uri: "okf://hr/policies/salaries" },
    { uri: "okf://nope/policies/salaries" },
  );
  const change = { changes: [{ op: "create", path: "notes/x.md", type: "Reference", title: "X" }] };
  await same("okf_validate_changes", { bundle: "hr", ...change }, { bundle: "nope", ...change });
  await same("okf_apply_changes", { bundle: "hr", ...change }, { bundle: "nope", ...change });
  const listing = JSON.parse(
    (await client.callTool({ name: "list_bundles", arguments: {} })).content[0].text,
  );
  assert.deepEqual(
    (listing.bundles || listing).map((bundle) => bundle.id),
    ["open"],
  );
});

test("a write stays inside the writer's view and shows at once in every view that holds the bundle", async (t) => {
  const { root, projectPath } = makeProject(t);
  const { connect } = await startServer(t, projectPath, {
    http: {
      port: 0,
      mcpPath: "/mcp",
      publicUrl: null,
      allowedHosts: [],
      allowedOrigins: [],
      auth: { mode: "tokens", file: writeTokenFile(t, TOKENS) },
      env: {},
      // Long enough that only the write itself can make the others look again.
      refreshIntervalMs: 600000,
    },
  });
  const [outsider, member, both] = await Promise.all(
    ["token-outsider", "token-hr", "token-both"].map(connect),
  );
  const apply = (client, bundle, file, title) =>
    client.callTool({
      name: "okf_apply_changes",
      arguments: { bundle, changes: [{ op: "create", path: file, type: "Reference", title }] },
    });
  const finds = async (client, query) =>
    JSON.parse(
      (await client.callTool({ name: "search_concepts", arguments: { query } })).content[0].text,
    ).results.map((result) => result.title);
  // Each client has read once, so every view exists before the writes.
  for (const client of [outsider, member, both]) await finds(client, "handbook");

  const restricted = await apply(member, "hr", "notes/bonus.md", "Bonus rules zebra");
  assert.equal(restricted.isError, undefined, JSON.stringify(restricted.content));
  assert.deepEqual(await finds(member, "zebra"), ["Bonus rules zebra"]);
  assert.deepEqual(await finds(both, "zebra"), ["Bonus rules zebra"]);
  assert.deepEqual(await finds(outsider, "zebra"), []);

  const shared = await apply(outsider, "open", "notes/parking.md", "Parking rules quokka");
  assert.equal(shared.isError, undefined, JSON.stringify(shared.content));
  for (const client of [outsider, member, both]) {
    assert.deepEqual(await finds(client, "quokka"), ["Parking rules quokka"]);
  }
  // Two commits, in the order of the writes, and a clean worktree.
  assert.deepEqual(
    git(root, ["log", "-2", "--format=", "--name-only", "--reverse"]).split("\n").filter(Boolean),
    ["hr/notes/bonus.md", "open/notes/parking.md"],
  );
  assert.equal(git(root, ["status", "--porcelain"]), "");
});

test("the bundle listing names each bundle's audiences, and proposals show only in the views that hold their bundle", async (t) => {
  const { projectPath } = makeProject(t);
  const state = await createStateAsync([], {
    projectPath,
    allowAuthoring: true,
    actor: "process:okf-views",
  });
  const json = (result) => JSON.parse(result.content[0].text);
  const everyone = principal("bea", ["hr", "management"]);
  const member = principal("hugo", ["hr"]);
  const outsider = principal("olga", []);
  const audiences = async (who) =>
    Object.fromEntries(
      json(await callTool(viewStateFor(state, who), "list_bundles", {}, who)).map((bundle) => [
        bundle.id,
        bundle.audiences,
      ]),
    );
  assert.deepEqual(await audiences(everyone), {
    open: undefined,
    hr: ["hr"],
    board: ["management"],
  });
  assert.deepEqual(await audiences(member), { open: undefined, hr: ["hr"] });
  assert.deepEqual(await audiences(outsider), { open: undefined });

  const proposed = json(
    await callTool(
      state,
      "okf_propose_concept",
      {
        bundle: "hr",
        path: "notes/raise.md",
        frontmatter: {
          type: "Reference",
          title: "SENTINELHR raise",
          description: "sentinelhr raise.",
        },
        body: "# SENTINELHR raise\n\nA sentinelhr-raise for level 3.",
      },
      everyone,
    ),
  );
  const id = proposed.proposalId || proposed.id || proposed.proposal?.id;
  assert.ok(id, JSON.stringify(proposed).slice(0, 300));
  const list = async (who, args) =>
    json(await callTool(viewStateFor(state, who), "okf_list_proposals", args || {}, who)).map(
      (entry) => entry.id,
    );
  assert.deepEqual(await list(everyone), [id]);
  assert.deepEqual(await list(member), [id]);
  assert.deepEqual(await list(outsider), []);
  assert.deepEqual(await list(outsider, { bundle: "hr" }), []);
  const get = (who, proposalId) =>
    answerText(() => callTool(viewStateFor(state, who), "okf_get_proposal", { proposalId }, who));
  assert.match(await get(member, id), SENTINEL);
  // For the outsider the proposal answers like an id that does not exist.
  const hidden = await get(outsider, id);
  assert.doesNotMatch(hidden, SENTINEL);
  assert.equal(
    hidden.replaceAll(id, "<id>"),
    (await get(outsider, "nope")).replaceAll("nope", "<id>"),
  );
});

test("a concept may not reference a bundle that some readers of its own bundle cannot read", async (t) => {
  const { projectPath } = makeProject(t);
  const { connect } = await startServer(t, projectPath);
  const member = await connect("token-hr");
  const write = async (bundle, file, relations) => {
    const result = await member.callTool({
      name: "okf_apply_changes",
      arguments: {
        bundle,
        changes: [
          { op: "create", path: file, type: "Reference", title: `Note ${file}`, relations },
        ],
      },
    });
    return JSON.parse(result.content[0].text);
  };
  // From the restricted bundle into the open one: every reader of hr reads open.
  const allowed = await write("hr", "notes/a.md", [{ type: "related_to", target: OPEN_URI }]);
  assert.equal(allowed.applied, true, JSON.stringify(allowed).slice(0, 400));
  // From the open bundle into the restricted one: refused, nothing written.
  const refused = await write("open", "notes/b.md", [{ type: "related_to", target: HIDDEN_URI }]);
  assert.equal(refused.applied, false);
  assert.match(JSON.stringify(refused), /reference_outside_audience/);
  const outsider = await connect("token-outsider");
  const found = JSON.parse(
    (await outsider.callTool({ name: "list_concepts", arguments: { bundle: "open" } })).content[0]
      .text,
  );
  assert.doesNotMatch(JSON.stringify(found), /notes\/b/);
});
