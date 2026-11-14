"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main } = require("../src/cli");
const { runMcpHttpServer } = require("../src/mcp/http");
const { callJson, connectHttp, writeTokenFile } = require("./mcp-client");

function concept(title, body) {
  return ["---", "type: Reference", `title: ${title}`, "---", "", `# ${title}`, "", body, ""].join(
    "\n",
  );
}

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-http-refresh-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "index.md"),
    ["---", 'okf_version: "0.2"', "---", "", "# Refresh fixture", "", "- [Note](note.md)", ""].join(
      "\n",
    ),
  );
  fs.writeFileSync(path.join(root, "note.md"), concept("Note", "Plain text."));
  return root;
}

async function start(t, root, refreshIntervalMs, extra) {
  const server = await runMcpHttpServer(
    [],
    Object.assign({ rootPath: root, http: { port: 0, refreshIntervalMs } }, extra),
  );
  t.after(() => server.close());
  return server;
}

async function titles(client, query) {
  const found = await callJson(client, "search_concepts", { query });
  return found.payload.results.map((result) => result.title);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("files written on disk are found after the refresh interval", async (t) => {
  const root = makeRoot(t);
  const server = await start(t, root, 400);
  const client = await connectHttp(t, server.url);
  // Past the interval, so this request runs a check and the next one,
  // straight after, falls inside the interval again.
  await pause(450);
  assert.deepEqual(await titles(client, "zebra"), []);

  fs.writeFileSync(path.join(root, "zebra.md"), concept("Zebra crossing", "Striped."));
  fs.writeFileSync(path.join(root, "note.md"), concept("Note", "Now mentions a giraffe."));
  // Within the interval the server answers from the index it has.
  assert.deepEqual(await titles(client, "zebra"), []);
  await pause(450);
  assert.deepEqual(await titles(client, "zebra"), ["Zebra crossing"]);
  assert.deepEqual(await titles(client, "giraffe"), ["Note"]);
  const read = await callJson(client, "get_concept", { uri: `okf://${path.basename(root)}/zebra` });
  assert.equal(read.payload.title, "Zebra crossing");

  fs.rmSync(path.join(root, "zebra.md"));
  await pause(450);
  assert.deepEqual(await titles(client, "zebra"), []);
});

test("a refresh keeps the index shared with live authoring and an unchanged one is kept", async (t) => {
  const root = makeRoot(t);
  const server = await start(t, root, 0);
  const { state } = server;
  const client = await connectHttp(t, server.url);
  const before = state.index;
  await titles(client, "note");
  assert.equal(state.index, before, "an unchanged bundle keeps its index object");

  // A writable server shares one index with the live authoring service; a
  // refreshed index is handed over as a write would hand it.
  const writable = await start(t, root, 0, {
    allowWrite: true,
    actor: "human:operator",
    http: {
      port: 0,
      refreshIntervalMs: 0,
      auth: { mode: "tokens", file: tokenFile(t) },
    },
  });
  assert.equal(writable.state.shareLiveIndex, true);
  const writer = await connectHttp(t, writable.url, { token: "tok-writer" });
  fs.writeFileSync(path.join(root, "okapi.md"), concept("Okapi", "Forest giraffe."));
  assert.deepEqual(await titles(writer, "okapi"), ["Okapi"]);
  assert.equal(writable.state.liveAuthoringService.indexCache.index, writable.state.index);
  const applied = await callJson(writer, "okf_apply_changes", {
    changes: [{ op: "update", uri: `okf://${path.basename(root)}/okapi`, description: "Shy." }],
  });
  assert.equal(applied.payload.applied, true);
});

function tokenFile(t) {
  const file = path.join(os.tmpdir(), `okf-refresh-tokens-${process.pid}-${Date.now()}.yaml`);
  t.after(() => fs.rmSync(file, { force: true }));
  const hash = require("node:crypto").createHash("sha256").update("tok-writer").digest("hex");
  fs.writeFileSync(
    file,
    [
      "tokens:",
      `  - sha256: ${hash}`,
      "    subject: writer",
      "    actor: human:writer",
      "    scopes: [okf.read, okf.write]",
      "",
    ].join("\n"),
  );
  return file;
}

test("the refresh check runs only for index reads, in the call queue's order", async (t) => {
  const root = makeRoot(t);
  const events = [];
  // A stand-in batch validator that records when each call runs.
  const service = {
    async validateChanges(input) {
      events.push(`call ${input.changes[0].title}`);
      await pause(20);
      return { valid: true, status: "valid", changes: [] };
    },
  };
  const file = writeTokenFile(t, [
    { token: "tok", subject: "w", actor: "human:w", scopes: ["okf.read", "okf.write"] },
  ]);
  const server = await start(t, root, 0, {
    allowWrite: true,
    actor: "human:operator",
    liveAuthoringService: service,
    http: { port: 0, refreshIntervalMs: 0, auth: { mode: "tokens", file } },
  });
  const refresh = server.state.refreshIndex;
  server.state.refreshIndex = () => {
    events.push("refresh");
    return refresh();
  };
  const clients = [];
  for (let index = 0; index < 3; index += 1) {
    clients.push(await connectHttp(t, server.url, { token: "tok" }));
  }
  // initialize, ping and tools/list never refresh; resource reads do.
  await clients[0].ping();
  await clients[0].listTools();
  assert.deepEqual(events, []);
  const listed = await clients[0].listResources();
  await clients[0].readResource({ uri: listed.resources[0].uri });
  assert.deepEqual(events, ["refresh", "refresh"]);

  // Concurrent calls: each one's check runs right before it, in order.
  events.length = 0;
  await Promise.all(
    clients.map((client, index) =>
      client.callTool({
        name: "okf_validate_changes",
        arguments: {
          changes: [{ op: "create", path: `x${index}.md`, type: "Reference", title: `t${index}` }],
        },
      }),
    ),
  );
  assert.equal(events.length, 6, events.join(","));
  for (let index = 0; index < 6; index += 2) {
    assert.equal(events[index], "refresh", events.join(","));
    assert.match(events[index + 1], /^call t\d$/, events.join(","));
  }
});

test("--refresh-interval is parsed strictly", async (t) => {
  const calls = [];
  const runtime = {
    runMcpHttpServer: async (_bundleArgs, options) => {
      calls.push(options.http.refreshIntervalMs);
      return { url: "http://127.0.0.1:1/mcp" };
    },
  };
  const stderr = process.stderr.write;
  process.stderr.write = () => true;
  t.after(() => {
    process.stderr.write = stderr;
  });
  const root = path.join(__dirname, "..", "okf", "okf-mcp");
  await main(["--root", root, "mcp", "--http"], runtime);
  await main(["--root", root, "mcp", "--http", "--refresh-interval", "0"], runtime);
  await main(["--root", root, "mcp", "--http", "--refresh-interval=60000"], runtime);
  assert.deepEqual(calls, [2000, 0, 60000]);
  for (const value of ["-1", "1.5", "soon", "86400001"]) {
    await assert.rejects(
      main(["--root", root, "mcp", "--http", `--refresh-interval=${value}`], runtime),
      /--refresh-interval must be/,
    );
  }
  await assert.rejects(
    main(["--root", root, "mcp", "--refresh-interval", "10"], runtime),
    /require --http/,
  );
});
