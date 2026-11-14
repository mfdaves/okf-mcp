"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createMcpServer, createStateAsync, registerMcpInterface } = require("../src/mcp/server");
const { runMcpHttpServer } = require("../src/mcp/http");
const { TOOL_PACK_DETAILS, boundedErrorDetails } = require("../src/error-details");
const { loadToolPacks } = require("../src/tool-packs");
const { startFakeIntrospectionServer } = require("./fake-introspection-server");
const {
  INITIALIZE_BODY,
  MCP_POST_HEADERS,
  callJson,
  callOutcome,
  connectFactory,
  connectHttp,
  connectMcp,
  httpExchange,
  writeTokenFile,
} = require("./mcp-client");

const repositoryRoot = path.resolve(__dirname, "..");
const binary = path.join(repositoryRoot, "bin", "okf-mcp.js");
const FIXTURES = path.join(__dirname, "fixtures", "tool-packs");
const FAKE = "@fixture/okf-fake-pack";
const ENV = { FAKE_KEY: "fake-secret-value-0001" };
const FAKE_ENTRY = { package: FAKE, config: { label: "hello", keyEnv: "FAKE_KEY" } };
const FAKE_TOOLS = ["fake_echo", "fake_fail", "fake_slow", "fake_admin"];

// A project with one bundle, the given toolPacks entries, and the fixture
// packs installed under its node_modules.
function makeProject(t, entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-tool-packs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, "okf", "notes");
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(
    path.join(bundle, "index.md"),
    ["---", 'okf_version: "0.2"', "---", "", "# Notes", "", "- [Note](note.md)", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(bundle, "note.md"),
    ["---", "type: Reference", "title: Note", "---", "", "# Note", ""].join("\n"),
  );
  for (const name of fs.readdirSync(FIXTURES)) {
    fs.cpSync(path.join(FIXTURES, name), path.join(root, "node_modules", "@fixture", name), {
      recursive: true,
    });
  }
  const lines = ["project: Packs", "bundles:", "  - id: notes", "    root: okf/notes"];
  if (entries) lines.push(`toolPacks: ${JSON.stringify(entries)}`);
  fs.writeFileSync(path.join(root, "okf.project.yaml"), `${lines.join("\n")}\n`);
  return { root, projectPath: path.join(root, "okf.project.yaml") };
}

// The fixture pack module as the server loaded it (its handlers record events).
function installedFakePack(root) {
  return require(fs.realpathSync(path.join(root, "node_modules", "@fixture", "okf-fake-pack")));
}

async function names(client) {
  return (await client.listTools()).tools.map((tool) => tool.name);
}

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

test("pack tools are listed after the core tools and run over stdio without a subject token", async (t) => {
  const { projectPath } = makeProject(t, [FAKE_ENTRY]);
  const plain = makeProject(t, null);
  const core = await names((await connectMcp(t, [], { projectPath: plain.projectPath })).client);
  const { client } = await connectMcp(t, [], { projectPath, toolPackEnv: ENV });
  // The stdio principal, the process's operator, holds the packs' scopes.
  assert.deepEqual(await names(client), core.concat(FAKE_TOOLS));
  const echoed = await callJson(client, "fake_echo", { text: "hi", pair: ["a", 1] });
  assert.equal(echoed.result.isError, undefined);
  assert.deepEqual(echoed.result.structuredContent, echoed.payload);
  assert.equal(echoed.payload.text, "hi");
  assert.equal(echoed.payload.label, "HELLO", "ctx.config is validateConfig's normalised config");
  assert.equal(echoed.payload.hasSubjectToken, false);
  assert.equal(echoed.payload.subjectTokenSha256, null);
  assert.equal(echoed.payload.secretLength, ENV.FAKE_KEY.length);
});

test("over HTTP a principal sees pack tools by scope and passes its token as the subject", async (t) => {
  const SENTINEL = "sentinel-pack-token-5d1";
  const { projectPath } = makeProject(t, [FAKE_ENTRY]);
  const token = (name) => `${SENTINEL}-${name}`;
  const file = writeTokenFile(t, [
    { token: token("reader"), subject: "reader", actor: "human:reader", scopes: ["okf.read"] },
    {
      token: token("fake"),
      subject: "fake",
      actor: "human:fake",
      scopes: ["okf.read", "fake.read"],
    },
    {
      token: token("admin"),
      subject: "admin",
      actor: "human:admin",
      scopes: ["okf.read", "fake.read", "fake.admin"],
    },
    { token: token("noread"), subject: "noread", actor: "human:noread", scopes: ["fake.read"] },
  ]);
  const child = spawn(
    process.execPath,
    [binary, "--project", projectPath, "mcp", "--http", "--port", "0", "--auth", `tokens:${file}`],
    { env: Object.assign({}, process.env, ENV), stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no listening line: ${logs}`)), 20000);
    child.stderr.on("data", () => {
      const match = logs.match(/listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
  const url = `http://127.0.0.1:${port}/mcp`;
  const seen = [];
  const record = (value) => {
    seen.push(JSON.stringify(value));
    return value;
  };

  // Scope gating per principal.
  const reader = await connectHttp(t, url, { token: token("reader") });
  const fake = await connectHttp(t, url, { token: token("fake") });
  const admin = await connectHttp(t, url, { token: token("admin") });
  const readerNames = await names(reader);
  for (const name of FAKE_TOOLS) assert.equal(readerNames.includes(name), false, name);
  assert.equal(record(await callOutcome(reader, "fake_echo", { text: "x" })).code, -32602);
  const fakeNames = await names(fake);
  assert.deepEqual(fakeNames.slice(-4), ["fake_echo", "fake_fail", "fake_slow", "fake_whoami"]);
  assert.equal(fakeNames.includes("fake_admin"), false);
  assert.equal(record(await callOutcome(fake, "fake_admin", {})).code, -32602);
  assert.deepEqual((await names(admin)).slice(-5), FAKE_TOOLS.concat("fake_whoami"));
  const noRead = await httpExchange(port, {
    method: "POST",
    headers: Object.assign({ authorization: `Bearer ${token("noread")}` }, MCP_POST_HEADERS),
    body: INITIALIZE_BODY,
  });
  assert.equal(noRead.status, 403);

  // The subject token reaches the handler (it returns only the token's hash).
  const echoed = record(await callJson(fake, "fake_echo", { text: "hi" }));
  assert.equal(echoed.payload.hasSubjectToken, true);
  assert.equal(echoed.payload.subjectTokenSha256, sha256(token("fake")));
  assert.equal(echoed.payload.actor, "human:fake");
  assert.deepEqual(echoed.payload.scopes, ["okf.read", "fake.read"]);

  // Arguments are validated against the declared schema, without coercion.
  for (const args of [
    { text: 5 },
    { text: "x", extra: 1 },
    { text: "x", pair: [1, "a"] },
    { text: "x", pair: ["a", "1"] },
    {},
  ]) {
    const refused = record(await fake.callTool({ name: "fake_echo", arguments: args }));
    assert.equal(refused.isError, true, JSON.stringify(args));
    assert.match(refused.content[0].text, /Invalid arguments/i);
  }

  // Handler errors become bounded codes; the message is never forwarded.
  const failure = async (mode) => record(await callJson(fake, "fake_fail", { mode })).payload;
  assert.deepEqual(await failure("coded"), {
    error: "Tool execution failed",
    tool: "fake_fail",
    message: "The tool pack could not complete the call.",
    code: "access_denied",
    details: { section: "crons", count: 2 },
  });
  for (const mode of ["plain", "badcode", "throwstring"]) {
    assert.equal((await failure(mode)).code, "tool_pack_execution_failed", mode);
  }
  assert.equal((await failure("secret")).code, "tool_pack_secret_not_allowed");
  // The text content carries the fixed message and one JSON line with the
  // bounded code and details, the same as the structured content.
  const coded = record(await fake.callTool({ name: "fake_fail", arguments: { mode: "coded" } }));
  assert.equal(coded.isError, true);
  assert.equal(
    coded.content[0].text,
    'The tool pack could not complete the call.\n{"code":"access_denied","details":{"section":"crons","count":2}}',
  );
  const [, line] = coded.content[0].text.split("\n");
  assert.deepEqual(JSON.parse(line), {
    code: coded.structuredContent.code,
    details: coded.structuredContent.details,
  });
  const plain = record(await fake.callTool({ name: "fake_fail", arguments: { mode: "plain" } }));
  assert.equal(
    plain.content[0].text,
    'The tool pack could not complete the call.\n{"code":"tool_pack_execution_failed"}',
  );
  // Detail strings up to 500 characters pass; longer ones are truncated.
  const long = await failure("long");
  assert.equal(long.code, "query_error");
  assert.equal(long.details.short, "a".repeat(499));
  assert.equal(long.details.exact, "b".repeat(500));
  assert.equal(long.details.long, `${"c".repeat(499)}…`);

  for (const entry of seen) {
    assert.equal(entry.includes(SENTINEL), false, entry.slice(0, 200));
    assert.equal(entry.includes("Catalog text"), false, entry.slice(0, 200));
    assert.equal(entry.includes(ENV.FAKE_KEY), false, entry.slice(0, 200));
  }
  assert.equal(logs.includes(SENTINEL), false, logs);
});

test("over HTTP the server advertises the core scopes and every scope its packs declare", async (t) => {
  const client = { clientId: "okf-mcp", clientSecret: "secret" };
  const fake = await startFakeIntrospectionServer(client);
  t.after(() => fake.close());
  const publicUrl = "https://mcp.example.com/mcp";
  const start = async (entries) => {
    const server = await runMcpHttpServer([], {
      projectPath: makeProject(t, entries).projectPath,
      toolPackEnv: ENV,
      http: {
        port: 0,
        mcpPath: "/mcp",
        publicUrl,
        auth: { mode: "introspect", url: fake.url, issuer: "https://auth.example.com" },
        env: {
          OKF_INTROSPECTION_CLIENT_ID: client.clientId,
          OKF_INTROSPECTION_CLIENT_SECRET: client.clientSecret,
        },
      },
    });
    t.after(() => server.close());
    const metadata = await httpExchange(server.port, {
      path: "/.well-known/oauth-protected-resource/mcp",
    });
    const challenge = await httpExchange(server.port, {
      method: "POST",
      headers: MCP_POST_HEADERS,
      body: INITIALIZE_BODY,
    });
    assert.equal(challenge.status, 401);
    return {
      supported: JSON.parse(metadata.body).scopes_supported,
      challenge: challenge.headers["www-authenticate"],
    };
  };
  const withPack = await start([FAKE_ENTRY]);
  assert.deepEqual(withPack.supported, ["okf.read", "okf.write", "fake.read", "fake.admin"]);
  assert.ok(withPack.challenge.includes('scope="okf.read okf.write fake.read fake.admin"'));
  const without = await start(null);
  assert.deepEqual(without.supported, ["okf.read", "okf.write"]);
  assert.ok(without.challenge.includes('scope="okf.read okf.write"'));
});

test("a tool that requires a subject token is offered only to authenticated HTTP callers", async (t) => {
  const { projectPath } = makeProject(t, [FAKE_ENTRY]);
  // Stdio: the operator holds the scope (okf.read) but carries no token.
  const stdio = (await connectMcp(t, [], { projectPath, toolPackEnv: ENV })).client;
  assert.equal((await names(stdio)).includes("fake_whoami"), false);
  assert.equal((await callOutcome(stdio, "fake_whoami", {})).code, -32602);
  // HTTP without --auth: anonymous callers hold okf.read but carry no token.
  const anonymous = await runMcpHttpServer([], {
    projectPath,
    toolPackEnv: ENV,
    http: { port: 0 },
  });
  t.after(() => anonymous.close());
  const guest = await connectHttp(t, anonymous.url);
  assert.equal((await names(guest)).includes("fake_whoami"), false);
  assert.equal((await callOutcome(guest, "fake_whoami", {})).code, -32602);
  // Authenticated HTTP: a principal with okf.read only sees and calls it.
  const file = writeTokenFile(t, [
    { token: "tok-reader", subject: "reader", actor: "human:reader", scopes: ["okf.read"] },
  ]);
  const server = await runMcpHttpServer([], {
    projectPath,
    toolPackEnv: ENV,
    http: { port: 0, auth: { mode: "tokens", file } },
  });
  t.after(() => server.close());
  const reader = await connectHttp(t, server.url, { token: "tok-reader" });
  assert.equal((await names(reader)).includes("fake_whoami"), true);
  const whoami = await callJson(reader, "fake_whoami", {});
  assert.deepEqual(whoami.payload, { subject: "reader", hasSubjectToken: true });
  // The flag must be a boolean.
  const project = {
    toolPacks: [{ package: "@fixture/x", config: {}, timeoutMs: 1000 }],
    errors: [],
  };
  const okfToolPack = {
    apiVersion: "1",
    id: "pack",
    validateConfig: () => ({ valid: true }),
    tools: {
      a_tool: {
        description: "A tool.",
        annotations: {},
        inputSchema: { type: "object", properties: {} },
        scope: "okf.read",
        requiresSubjectToken: "yes",
        handler: () => ({}),
      },
    },
  };
  await assert.rejects(
    loadToolPacks(project, { loader: async () => ({ okfToolPack }), env: {} }),
    (error) => error.code === "incompatible_tool_pack",
  );
});

test("error details: tool packs keep 500 characters and truncate, producers keep 200 and drop", () => {
  const error = {
    code: "query_error",
    details: {
      short: "a".repeat(499),
      exact: "b".repeat(500),
      long: "c".repeat(501),
      secret: `${"d".repeat(600)} key-123`,
      multiline: "line\nline",
      nested: { a: 1 },
      position: 12,
    },
  };
  assert.deepEqual(boundedErrorDetails(error, ["key-123"], TOOL_PACK_DETAILS), {
    short: "a".repeat(499),
    exact: "b".repeat(500),
    long: `${"c".repeat(499)}…`,
    position: 12,
  });
  assert.equal(boundedErrorDetails(error, [], TOOL_PACK_DETAILS).long.length, 500);
  // Producers (plan A9) are unchanged: at most 200 characters, longer dropped.
  const producer = {
    details: { fits: "e".repeat(200), over: "f".repeat(201), short: "a".repeat(499) },
  };
  assert.deepEqual(boundedErrorDetails(producer, []), { fits: "e".repeat(200) });
});

test("a pack call is bounded by its timeout and by the request's abort signal", async (t) => {
  const quick = makeProject(t, [Object.assign({ timeoutMs: 200 }, FAKE_ENTRY)]);
  const pack = installedFakePack(quick.root);
  const { client } = await connectMcp(t, [], { projectPath: quick.projectPath, toolPackEnv: ENV });
  const started = Date.now();
  const timedOut = await callJson(client, "fake_slow", { ms: 5000 });
  assert.equal(timedOut.result.isError, true);
  assert.equal(timedOut.payload.code, "tool_pack_timeout");
  assert.ok(Date.now() - started < 3000);
  assert.deepEqual(pack.events, ["start", "aborted"]);

  const patient = makeProject(t, [FAKE_ENTRY]);
  const patientPack = installedFakePack(patient.root);
  const second = await connectMcp(t, [], { projectPath: patient.projectPath, toolPackEnv: ENV });
  const aborter = new AbortController();
  setTimeout(() => aborter.abort(), 100);
  await assert.rejects(
    second.client.callTool(
      { name: "fake_slow", arguments: { ms: 5000 } },
      { signal: aborter.signal },
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(patientPack.events, ["start", "aborted"]);
});

test("pack tools run outside the call queue unless the pack serializes", async (t) => {
  const { projectPath } = makeProject(t, [
    FAKE_ENTRY,
    { package: "@fixture/serial-pack", config: {} },
  ]);
  const realLoader = (project, name) =>
    require(fs.realpathSync(path.join(project.root, "node_modules", ...name.split("/"))));
  const serialPack = {
    okfToolPack: {
      apiVersion: "1",
      id: "serial",
      serialize: true,
      validateConfig: () => ({ valid: true }),
      tools: {
        serial_ping: {
          description: "Answer in queue order.",
          annotations: { readOnlyHint: true },
          inputSchema: { type: "object", properties: {} },
          scope: "fake.read",
          handler: () => ({ pong: true }),
        },
      },
    },
  };
  const state = await createStateAsync([], {
    projectPath,
    toolPackEnv: ENV,
    toolPackLoader: async (project, name) =>
      name === "@fixture/serial-pack" ? serialPack : realLoader(project, name),
  });
  const { client } = await connectFactory(t, () => registerMcpInterface(state));
  let release;
  state.callQueue = new Promise((resolve) => {
    release = resolve;
  });
  // A read pack does not wait for knowledge calls in flight.
  const echoed = await callJson(client, "fake_echo", { text: "free" });
  assert.equal(echoed.payload.text, "free");
  // A serializing pack does.
  let answered = false;
  const queued = callJson(client, "serial_ping", {}).then((result) => {
    answered = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(answered, false);
  release();
  assert.equal((await queued).payload.pong, true);
});

test("tool packs that collide, are not installed, or are misconfigured stop the server at startup", async (t) => {
  const cases = [
    [[FAKE_ENTRY, { package: "@fixture/okf-colliding-pack" }], "tool_pack_name_collision"],
    [[FAKE_ENTRY, { package: "@fixture/okf-twin-pack" }], "tool_pack_name_collision"],
    [[{ package: "@fixture/okf-missing-pack" }], "tool_pack_package_not_installed"],
    [[{ package: "./node_modules/@fixture/okf-fake-pack" }], "invalid_tool_pack_package"],
    [[{ package: FAKE, config: {} }], "invalid_tool_pack_config"],
    [[{ package: FAKE, config: { label: "x", password: "p" } }], "unsafe_tool_pack_config"],
    [
      [{ package: FAKE, config: { label: "x", keyEnv: "not a name" } }],
      "invalid_tool_pack_secret_reference",
    ],
    [[Object.assign({ timeoutMs: 0 }, FAKE_ENTRY)], "invalid_tool_pack_timeout"],
    [[FAKE_ENTRY, FAKE_ENTRY], "duplicate_tool_pack_package"],
  ];
  for (const [entries, code] of cases) {
    const { projectPath } = makeProject(t, entries);
    await assert.rejects(createMcpServer([], { projectPath, toolPackEnv: ENV }), (error) => {
      assert.equal(error.code, code, JSON.stringify(entries));
      assert.equal(error.message.includes('p"'), false);
      return true;
    });
  }
  // The binary exits 1 with the reason.
  const { projectPath } = makeProject(t, [FAKE_ENTRY, { package: "@fixture/okf-colliding-pack" }]);
  const result = spawnSync(process.execPath, [binary, "--project", projectPath, "mcp"], {
    encoding: "utf8",
    env: Object.assign({}, process.env, ENV),
    timeout: 20000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /repeats an existing tool name/);

  // Descriptors the host does not accept.
  const tool = {
    description: "A tool.",
    annotations: {},
    inputSchema: { type: "object", properties: {} },
    scope: "fake.read",
    handler: () => ({}),
  };
  const project = {
    toolPacks: [{ package: "@fixture/x", config: {}, timeoutMs: 1000 }],
    errors: [],
  };
  const descriptor = (overrides, tools) =>
    Object.assign(
      { apiVersion: "1", id: "pack", validateConfig: () => ({ valid: true }), tools },
      overrides,
    );
  for (const okfToolPack of [
    descriptor({ apiVersion: "2" }, { a_tool: tool }),
    descriptor({ id: "Bad id" }, { a_tool: tool }),
    descriptor({ serialize: "yes" }, { a_tool: tool }),
    descriptor({}, { "Bad-Name": tool }),
    descriptor({}, { ab: tool }),
    descriptor({}, { a_tool: Object.assign({}, tool, { scope: undefined }) }),
    descriptor({}, { a_tool: Object.assign({}, tool, { description: "" }) }),
    descriptor({}, { a_tool: Object.assign({}, tool, { inputSchema: { type: "array" } }) }),
    descriptor({}, { a_tool: Object.assign({}, tool, { outputSchema: { type: "string" } }) }),
    descriptor({}, { a_tool: Object.assign({}, tool, { handler: "nope" }) }),
  ]) {
    await assert.rejects(
      loadToolPacks(project, { loader: async () => ({ okfToolPack }), env: {} }),
      (error) => error.code === "incompatible_tool_pack",
    );
  }
});
