"use strict";

// The real okf-odoo tool pack (sibling checkout, or OKF_ODOO_PATH) served over
// HTTP against a fake o3p_mcp data API (shared contract 2). Skipped when the
// checkout is absent.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runMcpHttpServer } = require("../src/mcp/http");
const {
  INITIALIZE_BODY,
  MCP_POST_HEADERS,
  callJson,
  callOutcome,
  connectHttp,
  httpExchange,
  writeTokenFile,
} = require("./mcp-client");

const ODOO = process.env.OKF_ODOO_PATH || path.resolve(__dirname, "..", "..", "okf-odoo");
const SKIP = fs.existsSync(path.join(ODOO, "src", "tool-pack.js"))
  ? false
  : `okf-odoo not found at ${ODOO}; set OKF_ODOO_PATH to run the real tool pack test`;
const CLIENT = { id: "okf-mcp-rs", secret: "rs-secret/+=" };
const ODOO_TOOLS = [
  "odoo_find_models",
  "odoo_describe_model",
  "odoo_search",
  "odoo_read",
  "odoo_group",
];

// A fake data API: Basic client credentials, { token, params }, and a fixed
// result per operation; `control.error` answers with a contract error.
async function startDataApi(t) {
  const requests = [];
  const control = { error: null };
  const expected = `Basic ${Buffer.from(
    `${new URLSearchParams([["", CLIENT.id]]).toString().slice(1)}:${new URLSearchParams([
      ["", CLIENT.secret],
    ])
      .toString()
      .slice(1)}`,
  ).toString("base64")}`;
  const results = {
    models: [{ model: "res.partner", name: "Contact" }],
    describe: {
      model: "res.partner",
      name: "Contact",
      fields: [{ name: "name", string: "Name", type: "char", required: true, readonly: false }],
    },
    search: { records: [{ id: 1, name: "Azure Interior" }], count: 1, truncated: false },
    read: { records: [{ id: 1, name: "Azure Interior" }] },
    // Group values in the web client's format: [id, name] for a relation,
    // [start, label] for a date bucket.
    group: {
      groups: [
        {
          partner_id: [1, "Azure Interior"],
          "date:month": ["2026-01-01", "January 2026"],
          __count: 2,
        },
      ],
    },
  };
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const op = request.url.replace("/o3p_mcp/api/v1/", "");
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      requests.push({ op, authorized: request.headers.authorization === expected, body });
      const send = (status, value) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.headers.authorization !== expected) {
        return send(401, { error: { code: "invalid_client", message: "Bad client." } });
      }
      if (control.error) {
        return send(403, {
          error: { code: control.error, message: "Odoo text that never leaves." },
        });
      }
      return send(200, { result: results[op] });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, control };
}

function makeProject(t, apiUrl) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-odoo-pack-"));
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
  // A linked install, as a workspace or `npm link` would make it.
  fs.mkdirSync(path.join(root, "node_modules", "@mfdaves"), { recursive: true });
  fs.symlinkSync(ODOO, path.join(root, "node_modules", "@mfdaves", "okf-odoo"), "dir");
  const config = {
    url: apiUrl,
    clientIdEnv: "ODOO_CLIENT_ID",
    clientSecretEnv: "ODOO_CLIENT_SECRET",
  };
  fs.writeFileSync(
    path.join(root, "okf.project.yaml"),
    [
      "project: Odoo pack",
      "bundles:",
      "  - id: notes",
      "    root: okf/notes",
      `toolPacks: ${JSON.stringify([{ package: "@mfdaves/okf-odoo", config }])}`,
      "",
    ].join("\n"),
  );
  return path.join(root, "okf.project.yaml");
}

test("the okf-odoo tool pack answers over HTTP for odoo.read principals with their token", {
  skip: SKIP,
}, async (t) => {
  const api = await startDataApi(t);
  const file = writeTokenFile(t, [
    {
      token: "tok-odoo-user",
      subject: "42",
      actor: "human:mrossi",
      scopes: ["okf.read", "odoo.read"],
    },
    { token: "tok-plain-user", subject: "7", actor: "human:reader", scopes: ["okf.read"] },
  ]);
  const server = await runMcpHttpServer([], {
    projectPath: makeProject(t, api.url),
    toolPackEnv: { ODOO_CLIENT_ID: CLIENT.id, ODOO_CLIENT_SECRET: CLIENT.secret },
    http: { port: 0, auth: { mode: "tokens", file } },
  });
  t.after(() => server.close());

  // A client signing in is told to ask for the pack's scope too.
  const challenge = await httpExchange(server.port, {
    method: "POST",
    headers: MCP_POST_HEADERS,
    body: INITIALIZE_BODY,
  });
  assert.equal(challenge.status, 401);
  // Core scopes, then the ones the loaded pack declares, each once in order.
  const { okfToolPack } = require(path.join(ODOO, "src", "tool-pack.js"));
  const advertised = [
    ...new Set(
      ["okf.read", "okf.write"].concat(Object.values(okfToolPack.tools).map((tool) => tool.scope)),
    ),
  ];
  assert.ok(advertised.includes("odoo.read"));
  assert.ok(challenge.headers["www-authenticate"].includes(`scope="${advertised.join(" ")}"`));

  // Without odoo.read the tools are neither listed nor callable.
  const plain = await connectHttp(t, server.url, { token: "tok-plain-user" });
  const plainNames = (await plain.listTools()).tools.map((tool) => tool.name);
  for (const name of ODOO_TOOLS) assert.equal(plainNames.includes(name), false, name);
  assert.equal((await callOutcome(plain, "odoo_find_models", {})).code, -32602);

  const user = await connectHttp(t, server.url, { token: "tok-odoo-user" });
  const listed = (await user.listTools()).tools.map((tool) => tool.name);
  assert.deepEqual(listed.slice(-5), ODOO_TOOLS);
  const domain = ["|", ["name", "ilike", "azure"], ["partner_id.country_id.code", "=", "BE"]];
  const calls = [
    ["odoo_find_models", { query: "partner" }, "models", (payload) => payload.models.length === 1],
    [
      "odoo_describe_model",
      { model: "res.partner" },
      "describe",
      (payload) => payload.fields.length === 1,
    ],
    [
      "odoo_search",
      { model: "res.partner", fields: ["name"], domain, order: "name desc, id" },
      "search",
      (payload) => payload.count === 1,
    ],
    [
      "odoo_read",
      { model: "res.partner", ids: [1], fields: ["name"] },
      "read",
      (payload) => payload.records.length === 1,
    ],
    [
      "odoo_group",
      {
        model: "sale.order",
        groupby: ["partner_id", "date:month"],
        aggregates: ["amount_total:sum", "__count"],
        domain,
      },
      "group",
      (payload) =>
        payload.groups[0].__count === 2 &&
        payload.groups[0]["date:month"][1] === "January 2026" &&
        payload.groups[0].partner_id[0] === 1,
    ],
  ];
  for (const [name, args, op, check] of calls) {
    const answer = await callJson(user, name, args);
    assert.equal(answer.result.isError, undefined, name);
    assert.ok(check(answer.payload), name);
    const sent = api.requests.at(-1);
    assert.equal(sent.op, op);
    assert.equal(sent.authorized, true);
    assert.equal(sent.body.token, "tok-odoo-user", "the caller's token is the subject");
    assert.equal(JSON.stringify(answer.result).includes("tok-odoo-user"), false);
  }
  assert.deepEqual(api.requests.at(-1).body.params.domain, domain);

  // The host validates the declared schema (prefixItems, anyOf) before the pack runs.
  const before = api.requests.length;
  for (const bad of [[["name", "xx", "a"]], [["Name!", "=", "a"]], [["name", "="]], ["^"]]) {
    const refused = await user.callTool({
      name: "odoo_search",
      arguments: { model: "res.partner", fields: ["name"], domain: bad },
    });
    assert.equal(refused.isError, true, JSON.stringify(bad));
    assert.match(refused.content[0].text, /Invalid arguments/);
  }
  assert.equal(api.requests.length, before);

  // A data API error reaches the caller as its code, never Odoo's text.
  api.control.error = "access_denied";
  const denied = await callJson(user, "odoo_read", {
    model: "res.partner",
    ids: [2],
    fields: ["name"],
  });
  assert.equal(denied.result.isError, true);
  assert.equal(denied.payload.code, "access_denied");
  assert.equal(JSON.stringify(denied.result).includes("Odoo text"), false);
  assert.equal(JSON.stringify(denied.result).includes("tok-odoo-user"), false);
});
