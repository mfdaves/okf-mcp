"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main } = require("../src/cli");
const { introspectionPrincipal, loadTokenFile } = require("../src/mcp/auth");
const { runMcpHttpServer } = require("../src/mcp/http");
const { startFakeIntrospectionServer } = require("./fake-introspection-server");
const {
  INITIALIZE_BODY,
  MCP_POST_HEADERS,
  callJson,
  connectHttp,
  httpExchange,
} = require("./mcp-client");

const ACTIVE = require("./fixtures/introspection/active.json");
const INACTIVE = require("./fixtures/introspection/inactive.json");

const repositoryRoot = path.resolve(__dirname, "..");
const binary = path.join(repositoryRoot, "bin", "okf-mcp.js");
const PUBLIC_URL = "https://mcp.example.com/mcp";
const METADATA_URL = "https://mcp.example.com/.well-known/oauth-protected-resource/mcp";
const ISSUER = "https://auth.example.com";
// A secret with characters that RFC 6749 form-urlencoding changes.
const CLIENT = { clientId: "okf-mcp", clientSecret: "s3cret/+= x" };
const ENV = {
  OKF_INTROSPECTION_CLIENT_ID: CLIENT.clientId,
  OKF_INTROSPECTION_CLIENT_SECRET: CLIENT.clientSecret,
};
const SERVICE_ACTOR = "process:okf-http";

// The shared fixture's own exp is a fixed date, so live runs move it ahead.
function activeAnswer(overrides) {
  return Object.assign({}, ACTIVE, { exp: Math.floor(Date.now() / 1000) + 3600 }, overrides);
}

function git(root, args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const result = spawnSync("git", ["-C", root].concat(args), { encoding: "utf8", env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-http-auth-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "index.md"),
    ["---", 'okf_version: "0.2"', "---", "", "# Auth fixture", "", "- [Note](note.md)", ""].join(
      "\n",
    ),
  );
  fs.writeFileSync(
    path.join(root, "note.md"),
    ["---", "type: Reference", "title: Note", "---", "", "# Note", "", "Shared note.", ""].join(
      "\n",
    ),
  );
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Repo Committer"]);
  git(root, ["config", "user.email", "committer@example.invalid"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return root;
}

async function startServer(t, root, auth, extra) {
  const server = await runMcpHttpServer(
    [],
    Object.assign(
      {
        rootPath: root,
        allowWrite: true,
        actor: SERVICE_ACTOR,
        gitCommit: true,
        http: {
          port: 0,
          mcpPath: "/mcp",
          publicUrl: auth.mode === "introspect" ? PUBLIC_URL : null,
          allowedHosts: ["mcp.example.com"],
          allowedOrigins: [],
          auth,
          env: ENV,
        },
      },
      extra,
    ),
  );
  t.after(() => server.close());
  return server;
}

function post(server, token) {
  return httpExchange(server.port, {
    method: "POST",
    headers: Object.assign(
      token === undefined ? {} : { authorization: `Bearer ${token}` },
      MCP_POST_HEADERS,
    ),
    body: INITIALIZE_BODY,
  });
}

async function callError(client, name, args) {
  try {
    return { result: await client.callTool({ name, arguments: args }) };
  } catch (error) {
    return { code: error.code };
  }
}

function create(file, title) {
  return { changes: [{ op: "create", path: file, type: "Reference", title }] };
}

test("the shared introspection answers map to principals", () => {
  const before = ACTIVE.exp - 60;
  assert.deepEqual(introspectionPrincipal(ACTIVE, PUBLIC_URL, before), {
    principal: {
      subject: "42",
      actor: "human:mrossi",
      scopes: new Set(["okf.read", "okf.write"]),
      name: "Mario Rossi",
      email: "mrossi@example.com",
    },
    exp: 1794000000,
    clientId: "c_9a…",
  });
  assert.equal(introspectionPrincipal(INACTIVE, PUBLIC_URL, before), null);
  assert.equal(introspectionPrincipal(ACTIVE, PUBLIC_URL, ACTIVE.exp), null);
  for (const change of [
    { active: "true" },
    { aud: "https://other.example.com/mcp" },
    { aud: [PUBLIC_URL] },
    { aud: `${PUBLIC_URL}//` },
    { aud: undefined },
    { exp: undefined },
    { exp: "1794000000" },
    { username: undefined },
    { username: "" },
    { sub: undefined },
  ]) {
    const answer = Object.assign({}, ACTIVE, change);
    assert.equal(introspectionPrincipal(answer, PUBLIC_URL, before), null, JSON.stringify(change));
  }
  const variant = (change) =>
    introspectionPrincipal(Object.assign({}, ACTIVE, change), PUBLIC_URL, before).principal;
  assert.deepEqual(variant({ scope: "okf.read" }).scopes, new Set(["okf.read"]));
  assert.deepEqual(variant({ scope: "okf.write" }).scopes, new Set(["okf.write"]));
  assert.deepEqual(variant({ scope: "openid okf.read odoo.read" }).scopes, new Set(["okf.read"]));
  assert.equal(variant({ username: "Mario Rossi\tx\u0007" }).actor, "human:Mario-Rossi-x-");
  assert.equal(variant({ sub: 42 }).subject, "42");
  // name and email are each optional; an unusable one is dropped alone.
  const anonymous = variant({ name: undefined, email: undefined });
  assert.equal(Object.hasOwn(anonymous, "name") || Object.hasOwn(anonymous, "email"), false);
  const noEmail = variant({ email: undefined });
  assert.equal(noEmail.name, "Mario Rossi");
  assert.equal(Object.hasOwn(noEmail, "email"), false);
  assert.equal(Object.hasOwn(variant({ name: undefined }), "name"), false);
  const injected = variant({ email: "a@b.c\nX-Injected: 1" });
  assert.equal(Object.hasOwn(injected, "email"), false);
  assert.equal(injected.name, "Mario Rossi");
  // One trailing slash is ignored on either side of the audience comparison.
  const slashed = Object.assign({}, ACTIVE, { aud: `${PUBLIC_URL}/` });
  assert.equal(introspectionPrincipal(slashed, PUBLIC_URL, before).principal.subject, "42");
  assert.equal(
    introspectionPrincipal(ACTIVE, `${PUBLIC_URL}/`, before).principal.actor,
    "human:mrossi",
  );
});

test("introspection gates MCP over HTTP: challenge, metadata, scopes, writes and cache", async (t) => {
  const fake = await startFakeIntrospectionServer(CLIENT);
  t.after(() => fake.close());
  const root = makeRepo(t);
  const server = await startServer(t, root, { mode: "introspect", url: fake.url, issuer: ISSUER });

  // No token: a challenge that points at the protected-resource metadata.
  const missing = await post(server);
  assert.equal(missing.status, 401);
  assert.match(missing.headers["www-authenticate"], /^Bearer /);
  assert.ok(missing.headers["www-authenticate"].includes(`resource_metadata="${METADATA_URL}"`));
  for (const location of [
    new URL(METADATA_URL).pathname,
    "/.well-known/oauth-protected-resource",
  ]) {
    const metadata = await httpExchange(server.port, { path: location });
    assert.equal(metadata.status, 200, location);
    assert.deepEqual(JSON.parse(metadata.body), {
      resource: PUBLIC_URL,
      authorization_servers: [ISSUER],
      scopes_supported: ["okf.read", "okf.write"],
    });
  }

  // Tokens the contract does not accept.
  fake.answer("tok-inactive", INACTIVE);
  fake.answer("tok-audience", activeAnswer({ aud: "https://other.example.com/mcp" }));
  fake.answer("tok-expired", activeAnswer({ exp: 1000 }));
  for (const token of ["tok-inactive", "tok-audience", "tok-expired", "tok-unknown"]) {
    const refused = await post(server, token);
    assert.equal(refused.status, 401, token);
    assert.equal(JSON.parse(refused.body).error, "invalid_token");
  }
  fake.answer("tok-write-only", activeAnswer({ scope: "okf.write" }));
  const writeOnly = await post(server, "tok-write-only");
  assert.equal(writeOnly.status, 403);
  assert.match(writeOnly.headers["www-authenticate"], /insufficient_scope/);

  // okf.read only: reads work, write tools are neither listed nor callable.
  fake.answer("tok-reader", activeAnswer({ scope: "okf.read", username: "reader" }));
  const reader = await connectHttp(t, server.url, { token: "tok-reader" });
  const readerTools = (await reader.listTools()).tools.map((tool) => tool.name);
  assert.equal(readerTools.includes("okf_apply_changes"), false);
  assert.equal(readerTools.includes("okf_validate_changes"), false);
  const found = await callJson(reader, "search_concepts", { query: "shared note" });
  assert.equal(found.payload.results[0].title, "Note");
  const denied = await callError(reader, "okf_apply_changes", create("notes/x.md", "X"));
  assert.equal(denied.code, -32602);

  // okf.write: the write is stamped and committed for the principal.
  fake.answer("tok-writer", activeAnswer());
  const writer = await connectHttp(t, server.url, { token: "tok-writer", mode: "auto" });
  assert.ok((await writer.listTools()).tools.some((tool) => tool.name === "okf_apply_changes"));
  const applied = await callJson(
    writer,
    "okf_apply_changes",
    create("notes/by-http.md", "By HTTP"),
  );
  assert.equal(applied.payload.applied, true);
  assert.equal(applied.payload.generated.by, "human:mrossi");
  assert.equal(applied.payload.git.committed, true);
  assert.match(
    fs.readFileSync(path.join(root, "notes", "by-http.md"), "utf8"),
    /^ {2}by: human:mrossi$/m,
  );
  assert.equal(
    git(root, ["log", "-1", "--format=%an <%ae>/%cn <%ce>"]),
    "Mario Rossi <mrossi@example.com>/Repo Committer <committer@example.invalid>",
  );
  const read = await callJson(reader, "get_concept", {
    uri: `okf://${path.basename(root)}/notes/by-http`,
  });
  assert.equal(read.payload.title, "By HTTP");

  // An answer without email (and with the audience's trailing slash): the
  // author's email falls back to the configured identity.
  const withoutEmail = activeAnswer({ aud: `${PUBLIC_URL}/` });
  delete withoutEmail.email;
  fake.answer("tok-no-email", withoutEmail);
  const noEmail = await connectHttp(t, server.url, { token: "tok-no-email" });
  const signed = await callJson(
    noEmail,
    "okf_apply_changes",
    create("notes/no-email.md", "No email"),
  );
  assert.equal(signed.payload.applied, true);
  assert.equal(
    git(root, ["log", "-1", "--format=%an <%ae>/%cn <%ce>"]),
    "Mario Rossi <committer@example.invalid>/Repo Committer <committer@example.invalid>",
  );

  // Each token reached the authorization server once, with client credentials.
  assert.equal(fake.callsFor("tok-reader"), 1);
  assert.equal(fake.callsFor("tok-writer"), 1);
  assert.ok(
    fake.requests.every(
      (entry) =>
        entry.authorized &&
        entry.method === "POST" &&
        entry.contentType === "application/x-www-form-urlencoded",
    ),
  );

  // An authorization server that fails or is gone: 503 without detail; a
  // cached answer keeps serving.
  fake.control.status = 500;
  const failing = await post(server, "tok-new");
  assert.equal(failing.status, 503);
  assert.deepEqual(JSON.parse(failing.body), { error: "temporarily_unavailable" });
  await fake.close();
  const gone = await post(server, "tok-newer");
  assert.equal(gone.status, 503);
  assert.deepEqual(JSON.parse(gone.body), { error: "temporarily_unavailable" });
  assert.equal((await post(server, "tok-writer")).status, 200);
});

test("a token file grants the principals it lists", async (t) => {
  const root = makeRepo(t);
  const file = path.join(os.tmpdir(), `okf-tokens-${process.pid}-${Date.now()}.yaml`);
  t.after(() => fs.rmSync(file, { force: true }));
  const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
  fs.writeFileSync(
    file,
    [
      "tokens:",
      `  - sha256: ${hash("tok-ci")}`,
      "    subject: ci",
      "    actor: process:ci-nightly",
      "    scopes: [okf.read, okf.write]",
      `  - sha256: ${hash("tok-viewer").toUpperCase()}`,
      "    subject: viewer",
      "    actor: human:viewer",
      "    scopes: [okf.read, odoo.read]",
      "",
    ].join("\n"),
  );
  const server = await startServer(t, root, { mode: "tokens", file });
  const missing = await post(server);
  assert.equal(missing.status, 401);
  assert.equal(missing.headers["www-authenticate"].includes("resource_metadata"), false);
  assert.equal((await post(server, "tok-other")).status, 401);
  assert.equal(
    (await httpExchange(server.port, { path: "/.well-known/oauth-protected-resource" })).status,
    404,
  );

  const viewer = await connectHttp(t, server.url, { token: "tok-viewer" });
  const viewerTools = (await viewer.listTools()).tools.map((tool) => tool.name);
  assert.equal(viewerTools.includes("okf_apply_changes"), false);
  const ci = await connectHttp(t, server.url, { token: "tok-ci" });
  const applied = await callJson(ci, "okf_apply_changes", create("notes/nightly.md", "Nightly"));
  assert.equal(applied.payload.generated.by, "process:ci-nightly");
  assert.equal(git(root, ["log", "-1", "--format=%an"]), "Repo Committer");

  // Errors name the entry and field, never a value.
  const broken = [
    [
      [
        "tokens:",
        "  - sha256: abc",
        "    subject: x",
        "    actor: human:x",
        "    scopes: [okf.read]",
      ],
      /tokens\[0\]\.sha256/,
    ],
    [
      [
        "tokens:",
        `  - sha256: ${hash("a")}`,
        "    subject: x",
        "    actor: nobody",
        "    scopes: [okf.read]",
      ],
      /tokens\[0\]\.actor/,
    ],
    [
      [
        "tokens:",
        `  - sha256: ${hash("a")}`,
        "    subject: x",
        "    actor: human:x",
        "    scopes: [okf.admin]",
      ],
      /tokens\[0\]\.scopes/,
    ],
    [
      [
        "tokens:",
        `  - sha256: ${hash("a")}`,
        "    subject: x",
        "    actor: human:x",
        "    scopes: [okf.read]",
        "    token: a",
      ],
      /tokens\[0\]\.token/,
    ],
    [
      [
        "tokens:",
        `  - sha256: ${hash("a")}`,
        "    subject: x",
        "    actor: human:x",
        "    scopes: [okf.read]",
        `  - sha256: ${hash("a")}`,
        "    subject: y",
        "    actor: human:y",
        "    scopes: [okf.read]",
      ],
      /tokens\[1\]\.sha256 repeats/,
    ],
    [["users: []"], /one `tokens` list/],
  ];
  for (const [lines, message] of broken) {
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
    assert.throws(
      () => loadTokenFile(file),
      (error) => {
        assert.match(error.message, message);
        assert.equal(error.message.includes(hash("a")), false);
        return true;
      },
    );
  }
});

test("--auth flags are parsed strictly", async (t) => {
  const calls = [];
  const runtime = {
    runMcpHttpServer: async (_bundleArgs, options) => {
      calls.push(options.http);
      return { url: "http://127.0.0.1:1/mcp" };
    },
  };
  const stderr = process.stderr.write;
  process.stderr.write = () => true;
  t.after(() => {
    process.stderr.write = stderr;
  });
  const root = path.join(repositoryRoot, "okf", "okf-mcp");
  const base = ["--root", root, "--write", "--actor", SERVICE_ACTOR, "mcp", "--http"];
  await main(base.concat(["--host", "0.0.0.0", "--auth", "tokens:/etc/okf/tokens.yaml"]), runtime);
  await main(
    base.concat([
      "--public-url",
      PUBLIC_URL,
      "--auth=introspect:https://auth.example.com/introspect",
      "--authorization-server",
      ISSUER,
    ]),
    runtime,
  );
  await main(
    base.concat([
      "--public-url",
      PUBLIC_URL,
      "--auth",
      "introspect:http://127.0.0.1:8069/introspect",
      "--authorization-server",
      "http://localhost:8069",
    ]),
    runtime,
  );
  assert.deepEqual(calls[0].auth, { mode: "tokens", file: "/etc/okf/tokens.yaml" });
  assert.equal(calls[0].host, "0.0.0.0");
  assert.deepEqual(calls[1].auth, {
    mode: "introspect",
    url: "https://auth.example.com/introspect",
    issuer: ISSUER,
  });
  assert.equal(calls[2].auth.url, "http://127.0.0.1:8069/introspect");
  const introspect = ["--auth", "introspect:https://auth.example.com/introspect"];
  const refused = [
    [["--auth", "password:x"], /tokens:<file> or introspect:<url>/],
    [["--auth", "tokens:"], /tokens:<file> or introspect:<url>/],
    [introspect, /requires --authorization-server/],
    [introspect.concat(["--authorization-server", ISSUER]), /requires --public-url/],
    [["--auth", "introspect:http://auth.example.com/introspect"], /https/],
    [["--auth", "introspect:https://id:secret@auth.example.com/introspect"], /without credentials/],
    [["--auth", "introspect:https://auth.example.com/introspect?x=1"], /query/],
    [["--auth", "tokens:/x", "--authorization-server", ISSUER], /requires --auth introspect/],
  ];
  for (const [extra, message] of refused) {
    await assert.rejects(main(base.concat(extra), runtime), (error) => {
      assert.equal(error.exitCode, 2, extra.join(" "));
      assert.match(error.message, message);
      return true;
    });
  }
  await assert.rejects(
    main(["--root", root, "mcp", "--auth", "tokens:/x"], runtime),
    /require --http/,
  );
  assert.equal(calls.length, 3);
});

test("a sentinel token never appears in a response, an error or a log line", async (t) => {
  const SENTINEL = "sentinel-7c1e-token";
  const fake = await startFakeIntrospectionServer(CLIENT);
  t.after(() => fake.close());
  const root = makeRepo(t);
  const child = spawn(
    process.execPath,
    [
      binary,
      "--root",
      root,
      "--write",
      "--actor",
      SERVICE_ACTOR,
      "mcp",
      "--http",
      "--port",
      "0",
      "--public-url",
      PUBLIC_URL,
      "--auth",
      `introspect:${fake.url}`,
      "--authorization-server",
      ISSUER,
    ],
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
  const record = (value) => seen.push(typeof value === "string" ? value : JSON.stringify(value));

  // Accepted: listing, a write, a refused write and a failing read.
  fake.answer(`${SENTINEL}-writer`, activeAnswer());
  const writer = await connectHttp(t, url, { token: `${SENTINEL}-writer` });
  record((await writer.listTools()).tools);
  record(
    await writer.callTool({ name: "okf_apply_changes", arguments: create("notes/s.md", "S") }),
  );
  record(await writer.callTool({ name: "okf_apply_changes", arguments: create("../x.md", "X") }));
  record(await writer.callTool({ name: "get_concept", arguments: { uri: "okf://nowhere/x" } }));
  record(await callError(writer, "no_such_tool", {}));
  // Refused: inactive, malformed headers, an authorization server that fails.
  const raw = async (headers) => {
    const answer = await httpExchange(port, {
      method: "POST",
      headers: Object.assign({}, MCP_POST_HEADERS, headers),
      body: INITIALIZE_BODY,
    });
    record(answer);
    return answer.status;
  };
  assert.equal(await raw({ authorization: `Bearer ${SENTINEL}-inactive` }), 401);
  assert.equal(await raw({ authorization: `Bearer ${SENTINEL}-a extra` }), 401);
  assert.equal(await raw({ authorization: `Basic ${SENTINEL}-b` }), 401);
  assert.equal(await raw({ authorization: `${SENTINEL}-c` }), 401);
  assert.equal(await raw({ authorization: `Bearer ${SENTINEL}-d, Bearer ${SENTINEL}-e` }), 401);
  fake.control.status = 502;
  assert.equal(await raw({ authorization: `Bearer ${SENTINEL}-f` }), 503);
  record(
    await httpExchange(port, {
      method: "POST",
      path: `/mcp?access_token=${SENTINEL}-g`,
      headers: MCP_POST_HEADERS,
      body: INITIALIZE_BODY,
    }),
  );
  assert.ok(seen.length >= 11);
  for (const entry of seen) assert.equal(entry.includes(SENTINEL), false, entry.slice(0, 200));
  assert.equal(logs.includes(SENTINEL), false, logs);
  assert.ok(fake.callsFor(`${SENTINEL}-writer`) === 1);
});
