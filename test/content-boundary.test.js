"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

const repositoryRoot = path.resolve(__dirname, "..");
const binary = path.join(repositoryRoot, "bin", "okf-mcp.js");
const ACTOR = "human:test";
const CONCEPTS = 4;

// B-6 / S-3: catalog content is data, never instructions. Every text field of
// this fixture carries a unique token; a token may appear only inside
// structured result payloads (get_concept, search results, resource bodies),
// never in initialize, tools/list, prompts/list, resource templates, or any
// message an error produces. The match is case-insensitive so a slug of a
// title would count too. Paths and URIs carry no token, so a message that
// names them stays clean.
const SENTINEL = /sentinel-/i;

function token(field, n) {
  return `SENTINEL-${field}-${n}`;
}

// Each concept relates to the next one, so relation targets carry tokened
// titles too. Relation types stay declared ones: they are a schema
// vocabulary checked against okf.project.yaml, not free text.
function conceptText(n) {
  const next = (n % CONCEPTS) + 1;
  return [
    "---",
    `type: ${token("type", n)}`,
    `title: ${token("title", n)}`,
    `description: ${token("description", n)}`,
    `tags: [${token("tag", n)}, ${token("tagb", n)}]`,
    `aliases: [${token("alias", n)}]`,
    `x-note: ${token("meta", n)}`,
    "sources:",
    `  - resource: /concepts/concept-${next}.md`,
    `    author: human:${token("author", n)}`,
    "relations:",
    "  - type: related_to",
    `    target: /concepts/concept-${next}.md`,
    `    label: ${token("label", n)}`,
    `    description: ${token("reldesc", n)}`,
    "---",
    "",
    `# ${token("heading", n)}`,
    "",
    `${token("body", n)} is the paragraph of concept ${n}.`,
    "",
  ].join("\n");
}

function write(root, relativePath, text) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
}

function makeFixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "okf-content-boundary-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "catalog");
  const links = Array.from(
    { length: CONCEPTS },
    (_, i) => `- [${token("link", i + 1)}](concepts/concept-${i + 1}.md)`,
  );
  write(
    root,
    "index.md",
    ["---", 'okf_version: "0.2"', "---", "", `# ${token("index", 0)}`, "", ...links, ""].join("\n"),
  );
  for (let n = 1; n <= CONCEPTS; n += 1) {
    write(root, `concepts/concept-${n}.md`, conceptText(n));
  }
  write(
    root,
    "managed.md",
    [
      "---",
      `type: ${token("type", "managed")}`,
      `title: ${token("title", "managed")}`,
      "generated:",
      "  by: process:fixture-generator",
      "  at: 2026-08-01T00:00:00.000Z",
      "---",
      "",
      `# ${token("heading", "managed")}`,
      "",
    ].join("\n"),
  );
  // Trusted configuration, not catalog text: it carries no token.
  const policyPath = path.join(parent, "policy.yaml");
  fs.writeFileSync(
    policyPath,
    ["rules:", '  - actors: ["**"]', '    paths: ["drafts/**"]', "    effect: deny", ""].join("\n"),
    "utf8",
  );
  const bundle = path.basename(root);
  return { root, policyPath, uri: (relative) => `okf://${bundle}/${relative}` };
}

// Every file under the catalog with its bytes, proposals excluded (they are
// the authoring mode's own store, not catalog content).
function snapshotFiles(root) {
  return Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath || entry.path, entry.name))
      .map((file) => path.relative(root, file).split(path.sep).join("/"))
      .filter((relative) => !relative.startsWith(".okf-proposals/"))
      .sort()
      .map((relative) => [relative, fs.readFileSync(path.join(root, relative), "utf8")]),
  );
}

async function connectBinary(t, args) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binary].concat(args, ["mcp"]),
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client(
    { name: "okf-content-boundary", version: "1" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(transport);
  t.after(() => client.close());
  return { client, stderr: () => stderr };
}

function assertClean(label, text) {
  assert.doesNotMatch(String(text), SENTINEL, `${label} carries catalog text`);
}

// Every string stored under a `message` or `error` key, however deep: tool
// failures put theirs at the top, receipts in validation.diagnostics and
// validation.errors, proposals in errors[] and the conflict notice.
function messagesIn(value, out) {
  if (Array.isArray(value)) {
    for (const entry of value) messagesIn(entry, out);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if ((key === "message" || key === "error") && typeof entry === "string") {
        out.push(entry);
      } else {
        messagesIn(entry, out);
      }
    }
  }
  return out;
}

// One failing call: a protocol error's message, the plain text of an SDK
// input-validation failure, or the messages of an isError result (or, for
// the read-only validator, of an invalid receipt). `expect` pins the reason,
// so a call that fails for some other reason does not pass silently.
async function failingCall(client, name, args, options) {
  const label = `${name} ${JSON.stringify(args)}`;
  let result;
  try {
    result = await client.callTool({ name, arguments: args });
  } catch (error) {
    return { label, messages: [error.message] };
  }
  let payload;
  try {
    payload = JSON.parse(result.content[0].text);
  } catch {
    assert.equal(result.isError, true, `${label} should fail`);
    return { label, messages: [result.content[0].text] };
  }
  if (options?.receipt) {
    assert.equal(payload.valid, false, `${label} should report an invalid batch`);
  } else {
    assert.equal(result.isError, true, `${label} should fail`);
  }
  const messages = messagesIn(payload, []);
  assert.ok(messages.length, `${label} should carry a message`);
  return { label, messages, payload };
}

async function checkBattery(client, mode, battery) {
  for (const [name, args, options] of battery) {
    const { label, messages } = await failingCall(client, name, args, options);
    if (options?.expect) {
      assert.ok(
        messages.some((message) => options.expect.test(message)),
        `${mode} ${label} should fail with ${options.expect}: ${messages.join(" | ")}`,
      );
    }
    for (const message of messages) assertClean(`${mode} ${label} message`, message);
  }
}

async function checkSurfaces(client, mode) {
  assertClean(`${mode} initialize.instructions`, client.getInstructions() || "");
  assertClean(`${mode} initialize.serverInfo`, JSON.stringify(client.getServerVersion()));
  assertClean(
    `${mode} initialize.capabilities`,
    JSON.stringify(client.getServerCapabilities() || {}),
  );
  assertClean(`${mode} tools/list`, JSON.stringify(await client.listTools()));
  assertClean(
    `${mode} resources/templates/list`,
    JSON.stringify(await client.listResourceTemplates()),
  );
  // The server advertises no prompts, so listPrompts() would answer locally;
  // the raw request reaches the server and its refusal is the surface.
  let prompts;
  try {
    prompts = JSON.stringify(await client.request({ method: "prompts/list", params: {} }));
  } catch (error) {
    prompts = error.message;
  }
  assert.ok(prompts, `${mode} prompts/list answered`);
  assertClean(`${mode} prompts/list`, prompts);
}

// Failures every mode shares: unknown concepts, unknown bundles, invalid
// arguments, and a resource read of a missing concept.
async function checkReadFailures(client, mode, uri) {
  await checkBattery(client, mode, [
    ["get_concept", { id: "concepts/missing" }, { expect: /concepts\/missing/ }],
    ["get_concept", { uri: uri("concepts/missing") }, { expect: /concepts\/missing/ }],
    ["get_concept", { id: 42 }],
    ["get_concept", {}],
    ["search_concepts", { query: "plain", limit: "ten" }],
    ["get_neighbors", { uri: uri("concepts/missing") }, { expect: /concepts\/missing/ }],
    ["validate_bundle", { bundle: "nope" }, { expect: /nope/ }],
    ["list_concepts", { limit: -1 }],
  ]);
  let readError = "";
  try {
    await client.readResource({ uri: uri("concepts/missing") });
  } catch (error) {
    readError = error.message;
  }
  assert.ok(readError, `${mode} resources/read of a missing concept should fail`);
  assertClean(`${mode} resources/read message`, readError);
}

// Positive controls: the same tokens come back inside structured results, so
// a clean surface means the server kept them out, not that it never saw them.
async function checkPayloadsCarryText(client, mode, uri) {
  const concept = await client.callTool({
    name: "get_concept",
    arguments: { id: "concepts/concept-1" },
  });
  assert.notEqual(concept.isError, true, `${mode} get_concept`);
  const payload = JSON.parse(concept.content[0].text);
  assert.equal(payload.title, token("title", 1));
  assert.equal(payload.description, token("description", 1));
  assert.equal(payload.type, token("type", 1));
  assert.deepEqual(payload.tags, [token("tag", 1), token("tagb", 1)]);
  assert.deepEqual(payload.aliases, [token("alias", 1)]);
  const conceptText = concept.content[0].text;
  for (const field of ["meta", "label", "reldesc", "author", "heading", "body"]) {
    assert.match(conceptText, new RegExp(token(field, 1)), `${mode} get_concept ${field}`);
  }
  const search = await client.callTool({
    name: "search_concepts",
    arguments: { query: token("body", 2) },
  });
  assert.notEqual(search.isError, true, `${mode} search_concepts`);
  const hits = JSON.parse(search.content[0].text).results;
  assert.ok(
    hits.some((hit) => hit.title === token("title", 2) && hit.type === token("type", 2)),
    `${mode} search_concepts returns the tokened concept`,
  );
  const resource = await client.readResource({ uri: uri("concepts/concept-3") });
  assert.match(resource.contents[0].text, new RegExp(token("body", 3)));
}

test("default mode: catalog text reaches result payloads only", async (t) => {
  const { root, uri } = makeFixture(t);
  const before = snapshotFiles(root);
  const { client, stderr } = await connectBinary(t, ["--root", root]);
  await checkSurfaces(client, "default");
  await checkReadFailures(client, "default", uri);
  await checkPayloadsCarryText(client, "default", uri);
  assert.deepEqual(snapshotFiles(root), before);
  assert.equal(stderr(), "");
});

test("authoring mode: proposal conflicts and refusals name paths and URIs only", async (t) => {
  const { root, uri } = makeFixture(t);
  const { client, stderr } = await connectBinary(t, ["--root", root, "--authoring"]);
  await checkSurfaces(client, "authoring");
  await checkReadFailures(client, "authoring", uri);
  await checkPayloadsCarryText(client, "authoring", uri);
  const before = snapshotFiles(root);
  await checkBattery(client, "authoring", [
    // A create over an existing concept: refused with a validation result.
    [
      "okf_propose_concept",
      {
        path: "concepts/concept-1.md",
        frontmatter: { type: "Reference", title: "Clash" },
        body: "# Clash",
      },
    ],
    [
      "okf_propose_concept",
      {
        path: "../escape.md",
        frontmatter: { type: "Reference", title: "Escape" },
        body: "# Escape",
      },
      { expect: /safe relative path/ },
    ],
    ["okf_propose_concept", { path: "new.md", frontmatter: "not an object" }],
    [
      "okf_propose_update",
      { uri: uri("concepts/missing"), body: "# Replaced" },
      { expect: /concepts\/missing/ },
    ],
    ["okf_get_proposal", { proposalId: "nope" }, { expect: /Unknown OKF proposal/ }],
    ["okf_accept_proposal", { proposalId: "nope" }],
    ["okf_reject_proposal", { proposalId: "nope" }],
  ]);
  assert.deepEqual(snapshotFiles(root), before, "refused proposals leave the catalog untouched");

  // A proposal conflict: two updates of one concept from the same revision;
  // once the first is accepted the second is stale.
  const propose = async (body) => {
    const result = await client.callTool({
      name: "okf_propose_update",
      arguments: { uri: uri("concepts/concept-2"), body },
    });
    assert.notEqual(result.isError, true, "okf_propose_update");
    return JSON.parse(result.content[0].text).proposal.id;
  };
  const first = await propose(`# ${token("heading", 2)}\n\nFirst revision.`);
  const second = await propose(`# ${token("heading", 2)}\n\nSecond revision.`);
  const accepted = await client.callTool({
    name: "okf_accept_proposal",
    arguments: { proposalId: first },
  });
  assert.equal(JSON.parse(accepted.content[0].text).accepted, true);
  await checkBattery(client, "authoring", [
    ["okf_accept_proposal", { proposalId: second }, { expect: /changed after this update/ }],
    ["okf_accept_proposal", { proposalId: first }, { expect: /Current status: accepted/ }],
  ]);
  assert.equal(stderr(), "");
});

test("write mode: refused batches and policy violations never echo catalog text", async (t) => {
  const { root, uri, policyPath } = makeFixture(t);
  const before = snapshotFiles(root);
  const { client, stderr } = await connectBinary(t, [
    "--root",
    root,
    "--write",
    "--actor",
    ACTOR,
    "--policy",
    policyPath,
  ]);
  await checkSurfaces(client, "write");
  await checkReadFailures(client, "write", uri);
  await checkPayloadsCarryText(client, "write", uri);
  const denied = { op: "create", path: "drafts/one.md", type: "Reference", title: "Draft" };
  await checkBattery(client, "write", [
    // Write policy violation: reported read-only, then refused by apply.
    [
      "okf_validate_changes",
      { changes: [denied] },
      { receipt: true, expect: /Write policy rule 0 denies this write \(path_denied\)/ },
    ],
    ["okf_apply_changes", { changes: [denied] }, { expect: /Write policy rule 0/ }],
    // A refused apply: the future graph has a broken relation.
    [
      "okf_apply_changes",
      {
        changes: [
          {
            op: "create",
            path: "new/broken.md",
            type: "Reference",
            title: "Broken",
            relations: [{ type: "related_to", target: "/concepts/missing.md" }],
          },
        ],
      },
    ],
    // The same type and title as an existing concept: the conflict names the
    // candidate URI, not the title (formerly it quoted the title).
    [
      "okf_apply_changes",
      {
        changes: [
          { op: "create", path: "dupe.md", type: token("type", 1), title: token("title", 1) },
        ],
      },
      { expect: /same type and title: okf:\/\/catalog\/dupe$/ },
    ],
    [
      "okf_apply_changes",
      {
        changes: [
          { op: "create", path: "concepts/concept-1.md", type: "Reference", title: "Clash" },
        ],
      },
      { expect: /already exists: concepts\/concept-1\.md/ },
    ],
    [
      "okf_apply_changes",
      { changes: [{ op: "update", uri: uri("concepts/missing"), title: "Gone" }] },
      { expect: /concepts\/missing/ },
    ],
    [
      "okf_apply_changes",
      {
        changes: [
          { op: "update", uri: uri("concepts/concept-1"), tags: { add: [token("tag", 1)] } },
        ],
      },
      { expect: /no effective changes: okf:\/\/catalog\/concepts\/concept-1/ },
    ],
    [
      "okf_apply_changes",
      { changes: [{ op: "update", uri: uri("managed"), title: "Overwrite" }] },
      { expect: /through its generator: okf:\/\/catalog\/managed/ },
    ],
    [
      "okf_apply_changes",
      { changes: [{ op: "create", path: "../escape.md", type: "Reference", title: "Escape" }] },
    ],
    ["okf_apply_changes", {}],
    ["okf_apply_changes", { changes: [{ op: "destroy", path: "x.md" }] }],
  ]);
  // The policy violation receipt is structured, carries the rule id, and
  // nothing reached disk.
  const refused = await client.callTool({
    name: "okf_apply_changes",
    arguments: { changes: [denied] },
  });
  const receipt = JSON.parse(refused.content[0].text);
  assert.equal(receipt.applied, false);
  assert.equal(receipt.filesChanged, false);
  assert.deepEqual(
    receipt.policyViolations.map(({ code, rule, reason, path: target }) => ({
      code,
      rule,
      reason,
      path: target,
    })),
    [{ code: "policy_violation", rule: 0, reason: "path_denied", path: "drafts/one.md" }],
  );
  assert.deepEqual(snapshotFiles(root), before);
  assert.equal(stderr(), "");
});

test("malformed frontmatter: diagnostics name the position, never the source text", async (t) => {
  const { root } = makeFixture(t);
  // js-yaml's own message would quote these lines in a code frame, and its
  // unknown-tag reason would quote the tag.
  write(
    root,
    "broken/frame.md",
    ["---", "type: Reference", `title: ${token("yaml", 1)}: [open`, "---", "", "# x", ""].join(
      "\n",
    ),
  );
  write(
    root,
    "broken/tag.md",
    ["---", "type: Reference", `title: !${token("yamltag", 2)} x`, "---", "", "# y", ""].join("\n"),
  );
  const { client, stderr } = await connectBinary(t, ["--root", root, "--write", "--actor", ACTOR]);
  const report = JSON.parse(
    (await client.callTool({ name: "validate_bundle", arguments: {} })).content[0].text,
  );
  const preview = JSON.parse(
    (
      await client.callTool({
        name: "okf_validate_changes",
        arguments: {
          changes: [{ op: "create", path: "ok/new.md", type: "Reference", title: "New" }],
        },
      })
    ).content[0].text,
  );
  const messages = messagesIn([report, preview], []);
  const yamlMessages = messages.filter((message) => message.startsWith("Invalid YAML mapping"));
  assert.ok(
    yamlMessages.some((message) => /^Invalid YAML mapping: .* \(2:\d+\)$/.test(message)),
    `the diagnostic keeps the position: ${yamlMessages.join(" | ")}`,
  );
  for (const message of messages) assertClean("malformed frontmatter diagnostic", message);
  assert.equal(stderr(), "");
});
