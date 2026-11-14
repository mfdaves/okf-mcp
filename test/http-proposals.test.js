"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { callTool, createStateAsync } = require("../src/mcp/server");
const { runMcpHttpServer } = require("../src/mcp/http");
const { callJson, callOutcome, connectHttp, connectMcp, writeTokenFile } = require("./mcp-client");

const SENTINEL = "PRIVATE-DRAFT-SENTINEL";
const PROPOSAL_READS = ["okf_list_proposals", "okf_get_proposal"];

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-http-proposals-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "index.md"),
    ["---", 'okf_version: "0.2"', "---", "", "# Proposals", "", "- [Note](note.md)", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "note.md"),
    ["---", "type: Reference", "title: Note", "---", "", "# Note", ""].join("\n"),
  );
  return root;
}

async function names(client) {
  return (await client.listTools()).tools.map((tool) => tool.name);
}

test("over HTTP, pending proposals are readable only with okf.write", async (t) => {
  const root = makeRoot(t);
  // A stdio session with --authoring stores a proposal holding draft text.
  const stdio = await createStateAsync([], {
    rootPath: root,
    allowAuthoring: true,
    actor: "human:alice",
  });
  const stored = JSON.parse(
    (
      await callTool(stdio, "okf_propose_concept", {
        path: "drafts/plan.md",
        frontmatter: { type: "Reference", title: "Plan" },
        body: `# Plan\n\n${SENTINEL}\n`,
      })
    ).content[0].text,
  );
  assert.equal(stored.created, true);
  const proposalId = stored.proposal.id;

  // Anonymous (no --auth) and okf.read principals: neither listed nor callable.
  const anonymousServer = await runMcpHttpServer([], { rootPath: root, http: { port: 0 } });
  t.after(() => anonymousServer.close());
  const file = writeTokenFile(t, [
    { token: "tok-reader", subject: "reader", actor: "human:reader", scopes: ["okf.read"] },
    {
      token: "tok-writer",
      subject: "writer",
      actor: "human:writer",
      scopes: ["okf.read", "okf.write"],
    },
  ]);
  const server = await runMcpHttpServer([], {
    rootPath: root,
    http: { port: 0, auth: { mode: "tokens", file } },
  });
  t.after(() => server.close());
  const readers = [
    await connectHttp(t, anonymousServer.url),
    await connectHttp(t, server.url, { token: "tok-reader" }),
  ];
  for (const client of readers) {
    const listed = await names(client);
    for (const name of PROPOSAL_READS) assert.equal(listed.includes(name), false, name);
    assert.equal(listed.includes("okf_validate_concept"), true);
    for (const [name, args] of [
      ["okf_list_proposals", {}],
      ["okf_get_proposal", { proposalId }],
    ]) {
      const outcome = await callOutcome(client, name, args);
      assert.equal(outcome.code, -32602, name);
      assert.equal(JSON.stringify(outcome).includes(SENTINEL), false);
    }
  }

  // okf.write: listed and readable.
  const writer = await connectHttp(t, server.url, { token: "tok-writer" });
  const writerNames = await names(writer);
  for (const name of PROPOSAL_READS) assert.equal(writerNames.includes(name), true, name);
  const list = await callJson(writer, "okf_list_proposals", {});
  assert.equal(list.payload.length, 1);
  const read = await callJson(writer, "okf_get_proposal", { proposalId });
  assert.match(read.payload.markdown, new RegExp(SENTINEL));

  // Stdio is unchanged: the project helpers list proposals without --write.
  const { client } = await connectMcp(t, [], { rootPath: root });
  const stdioNames = await names(client);
  for (const name of PROPOSAL_READS) assert.equal(stdioNames.includes(name), true, name);
});

test("over HTTP, listing and previewing producers require okf.write", async (t) => {
  const root = makeRoot(t);
  const previews = [];
  // A stand-in producer service: previews would run the producer with the
  // server's own source credentials.
  const producerService = {
    list: () => [{ name: "erp", type: "fake", package: "@fixture/p", bundle: "notes" }],
    preview: async (name) => {
      previews.push(name);
      return { valid: true, readyToApply: true, instance: { name } };
    },
  };
  const file = writeTokenFile(t, [
    { token: "tok-reader", subject: "reader", actor: "human:reader", scopes: ["okf.read"] },
    {
      token: "tok-writer",
      subject: "writer",
      actor: "human:writer",
      scopes: ["okf.read", "okf.write"],
    },
  ]);
  const server = await runMcpHttpServer([], {
    rootPath: root,
    producerService,
    http: { port: 0, auth: { mode: "tokens", file } },
  });
  t.after(() => server.close());
  const anonymousServer = await runMcpHttpServer([], {
    rootPath: root,
    producerService,
    http: { port: 0 },
  });
  t.after(() => anonymousServer.close());
  const PRODUCER_READS = ["okf_list_producers", "okf_preview_producer"];
  for (const client of [
    await connectHttp(t, server.url, { token: "tok-reader" }),
    await connectHttp(t, anonymousServer.url),
  ]) {
    const listed = await names(client);
    for (const name of PRODUCER_READS) assert.equal(listed.includes(name), false, name);
    assert.equal((await callOutcome(client, "okf_list_producers", {})).code, -32602);
    assert.equal(
      (await callOutcome(client, "okf_preview_producer", { producer: "erp" })).code,
      -32602,
    );
  }
  assert.deepEqual(previews, []);

  const writer = await connectHttp(t, server.url, { token: "tok-writer" });
  const writerNames = await names(writer);
  for (const name of PRODUCER_READS) assert.equal(writerNames.includes(name), true, name);
  assert.equal((await callJson(writer, "okf_list_producers", {})).payload[0].name, "erp");
  const preview = await callJson(writer, "okf_preview_producer", { producer: "erp" });
  assert.equal(preview.payload.valid, true);
  assert.deepEqual(previews, ["erp"]);

  // Stdio is unchanged: the flag-less operator lists and previews producers.
  const { client } = await connectMcp(t, [], { rootPath: root, producerService });
  const stdioNames = await names(client);
  for (const name of PRODUCER_READS) assert.equal(stdioNames.includes(name), true, name);
});
