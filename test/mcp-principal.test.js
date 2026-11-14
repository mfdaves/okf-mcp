"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { callTool, createStateAsync, registerMcpInterface } = require("../src/mcp/server");
const { anonymousPrincipal, flagsPrincipal } = require("../src/mcp/principal");
const { callJson, connectFactory } = require("./mcp-client");

const ACTOR = "human:operator";
const READER = { subject: "7", actor: "human:reader", scopes: new Set(["okf.read"]) };
const WRITER = {
  subject: "42",
  actor: "human:mrossi",
  scopes: new Set(["okf.read", "okf.write"]),
  name: "Mario Rossi",
  email: "mrossi@example.com",
};
const WRITE_TOOLS = ["okf_validate_changes", "okf_apply_changes", "okf_run_producer"];

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-principal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "index.md"),
    [
      "---",
      'okf_version: "0.2"',
      "---",
      "",
      "# Principal fixture",
      "",
      "- [Note](note.md)",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "note.md"),
    ["---", "type: Reference", "title: Note", "---", "", "# Note", ""].join("\n"),
    "utf8",
  );
  return root;
}

// A stand-in producer service: the producer gates only look for one.
const PRODUCERS = {
  list: () => [],
  preview: async () => ({ valid: true }),
  run: async () => ({ applied: true }),
};

async function connectAs(t, state, principal) {
  const { client } = await connectFactory(t, () => registerMcpInterface(state, principal));
  return client;
}

async function toolNames(client) {
  return (await client.listTools()).tools.map((tool) => tool.name);
}

async function callError(client, name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return { result };
  } catch (error) {
    return { code: error.code, message: error.message };
  }
}

test("a read-only principal sees and reaches no write tool", async (t) => {
  const root = makeRoot(t);
  const writable = await createStateAsync([], {
    rootPath: root,
    allowWrite: true,
    actor: ACTOR,
    producerService: PRODUCERS,
  });
  const readOnly = await createStateAsync([], {
    rootPath: root,
    actor: ACTOR,
    producerService: PRODUCERS,
  });

  // The flags' principal (stdio) keeps today's listing.
  const operator = await toolNames(await connectAs(t, writable, undefined));
  for (const name of WRITE_TOOLS) assert.ok(operator.includes(name), name);
  assert.deepEqual(
    operator,
    await toolNames(await connectAs(t, writable, flagsPrincipal(writable))),
  );

  // A principal without okf.write gets the listing of a server without --write.
  const reader = await connectAs(t, writable, READER);
  const disabled = await connectAs(t, readOnly, undefined);
  const readerNames = await toolNames(reader);
  for (const name of WRITE_TOOLS) assert.equal(readerNames.includes(name), false, name);
  assert.deepEqual(readerNames, await toolNames(disabled));
  assert.deepEqual(
    await toolNames(await connectAs(t, writable, anonymousPrincipal())),
    readerNames,
  );

  // Calling a write tool anyway fails exactly as on a server without --write.
  const args = { changes: [{ op: "create", path: "x.md", type: "Reference", title: "X" }] };
  const denied = await callError(reader, "okf_apply_changes", args);
  const unavailable = await callError(disabled, "okf_apply_changes", args);
  assert.deepEqual(denied, unavailable);
  assert.equal(denied.code, -32602);
  assert.equal(
    (await callError(reader, "okf_run_producer", { producer: "p" })).code,
    (await callError(disabled, "okf_run_producer", { producer: "p" })).code,
  );
  assert.equal(fs.existsSync(path.join(root, "x.md")), false);

  // Direct in-process calls are gated the same way.
  await assert.rejects(
    callTool(writable, "okf_apply_changes", args, READER),
    /Unknown registered MCP tool: okf_apply_changes/,
  );
  const read = await callJson(reader, "get_concept", { uri: `okf://${path.basename(root)}/note` });
  assert.equal(read.payload.title, "Note");
});

test("write tools hand the principal's actor and author to the authoring service", async (t) => {
  const root = makeRoot(t);
  const contexts = [];
  const service = {
    async validateChanges(_input, context) {
      contexts.push(context);
      return { valid: true, status: "valid", changes: [] };
    },
    async applyChanges(_input, context) {
      contexts.push(context);
      return { applied: false, filesChanged: false, status: "rejected", changes: [] };
    },
  };
  const state = await createStateAsync([], {
    rootPath: root,
    allowWrite: true,
    actor: ACTOR,
    liveAuthoringService: service,
  });
  const args = { changes: [{ op: "create", path: "x.md", type: "Reference", title: "X" }] };
  const writer = await connectAs(t, state, WRITER);
  await callJson(writer, "okf_validate_changes", args);
  await callJson(writer, "okf_apply_changes", args);
  const unnamed = await connectAs(t, state, Object.assign({}, WRITER, { email: undefined }));
  await callJson(unnamed, "okf_apply_changes", args);
  await callJson(await connectAs(t, state, undefined), "okf_apply_changes", args);
  const author = { name: "Mario Rossi", email: "mrossi@example.com" };
  assert.deepEqual(contexts, [
    { additionalBundles: [], actor: "human:mrossi", author },
    { additionalBundles: [], actor: "human:mrossi", author },
    { additionalBundles: [], actor: "human:mrossi" },
    { additionalBundles: [], actor: ACTOR },
  ]);
});

test("a principal's actor is recorded on the proposals it stores", async (t) => {
  const root = makeRoot(t);
  const state = await createStateAsync([], { rootPath: root, allowAuthoring: true, actor: ACTOR });
  const input = {
    path: "proposed.md",
    frontmatter: { type: "Reference", title: "Proposed" },
    body: "# Proposed",
  };
  const asReader = await callJson(await connectAs(t, state, READER), "okf_propose_concept", input);
  assert.equal(asReader.payload.created, true);
  assert.equal(asReader.payload.proposal.proposedBy, "human:reader");
  const asOperator = await callJson(
    await connectAs(t, state, undefined),
    "okf_propose_concept",
    Object.assign({}, input, { path: "other.md", frontmatter: { type: "Reference", title: "B" } }),
  );
  assert.equal(asOperator.payload.proposal.proposedBy, ACTOR);
  assert.equal(state.authoringService.actor, ACTOR);
});
