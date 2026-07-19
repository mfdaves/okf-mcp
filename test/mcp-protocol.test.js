"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  ERROR_CODES,
  assertSupportedSchema,
  responseFor,
  validateToolArguments,
} = require("../src/mcp-protocol");
const {
  SUPPORTED_PROTOCOL_VERSIONS,
  createServer,
  createServerAsync,
  runStdioServer,
} = require("../src/mcp-server");

function writeConcept(root, name, title, body) {
  fs.writeFileSync(path.join(root, name), [
    "---",
    "type: Concept",
    `title: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
    body || "",
    "",
  ].join("\n"), "utf8");
}

function makeBundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-protocol-"));
  writeConcept(root, "alpha.md", "Alpha", "alpha-only-token");
  writeConcept(root, "beta.md", "Beta", "beta-only-token");
  return root;
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-protocol-project-"));
  const bundle = path.join(root, "bundle");
  fs.mkdirSync(bundle);
  writeConcept(bundle, "existing.md", "Existing", "existing");
  const projectPath = path.join(root, "okf.project.yaml");
  fs.writeFileSync(projectPath, [
    "project: Protocol",
    "bundles:",
    "  - id: local",
    "    root: bundle",
    "",
  ].join("\n"), "utf8");
  return { root, projectPath };
}

async function exchange(lines, bundle) {
  const input = new PassThrough();
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => {
    stdout += String(chunk);
  });
  const server = await runStdioServer([`local=${bundle}`], input, output);
  input.end(lines.join("\n") + "\n");
  await server.closed;
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test("stdio maps JSON-RPC errors, preserves valid ids, and never answers notifications", async () => {
  const bundle = makeBundle();
  const responses = await exchange([
    "{",
    JSON.stringify({ jsonrpc: "1.0", id: "bad-version", method: "ping" }),
    JSON.stringify([]),
    JSON.stringify({ jsonrpc: "2.0", id: "null-params", method: "ping", params: null }),
    JSON.stringify({ jsonrpc: "2.0", id: "unknown", method: "unknown/method", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: "missing-uri", method: "resources/read", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: "unknown-uri", method: "resources/read", params: { uri: "okf://local/missing" } }),
    JSON.stringify({ jsonrpc: "2.0", id: "bad-arguments", method: "tools/call", params: { name: "list_bundles", arguments: null } }),
    JSON.stringify({ jsonrpc: "2.0", id: "unknown-tool", method: "tools/call", params: { name: "missing", arguments: {} } }),
    JSON.stringify({ jsonrpc: "2.0", method: "unknown/notification", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: "ping", method: "ping", params: {} }),
  ], bundle);

  assert.deepEqual(
    responses.map((response) => response.id),
    [null, "bad-version", null, "null-params", "unknown", "missing-uri", "unknown-uri", "bad-arguments", "unknown-tool", "ping"],
  );
  assert.deepEqual(
    responses.slice(0, 9).map((response) => response.error.code),
    [
      ERROR_CODES.PARSE_ERROR,
      ERROR_CODES.INVALID_REQUEST,
      ERROR_CODES.INVALID_REQUEST,
      ERROR_CODES.INVALID_REQUEST,
      ERROR_CODES.METHOD_NOT_FOUND,
      ERROR_CODES.INVALID_PARAMS,
      ERROR_CODES.RESOURCE_NOT_FOUND,
      ERROR_CODES.INVALID_PARAMS,
      ERROR_CODES.INVALID_PARAMS,
    ],
  );
  assert.equal(responses[8].error.data.detail, "Unknown or unavailable tool");
  assert.deepEqual(responses[9].result, {});
});

test("initialize accepts known revisions and falls back for unknown revisions", async () => {
  const server = createServer([`local=${makeBundle()}`]);
  assert.equal(SUPPORTED_PROTOCOL_VERSIONS[0], "2025-11-25");
  for (const protocolVersion of SUPPORTED_PROTOCOL_VERSIONS) {
    const result = await server.handle({
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "protocol-test", version: "1" },
      },
    });
    assert.equal(result.protocolVersion, protocolVersion);
  }
  const future = await server.handle({
    method: "initialize",
    params: {
      protocolVersion: "2099-12-31",
      capabilities: {},
      clientInfo: { name: "protocol-test", version: "1" },
    },
  });
  assert.equal(future.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
  await assert.rejects(
    () => server.handle({
      method: "initialize",
      params: {
        protocolVersion: 20251125,
        capabilities: {},
        clientInfo: { name: "protocol-test", version: "1" },
      },
    }),
    (error) => error.code === ERROR_CODES.INVALID_PARAMS,
  );

  const protocolVersion = "2025-11-25";
  const validClient = { name: "protocol-test", version: "1" };
  const malformed = [
    { protocolVersion, clientInfo: validClient },
    { protocolVersion, capabilities: [], clientInfo: validClient },
    { protocolVersion, capabilities: {} },
    { protocolVersion, capabilities: {}, clientInfo: {} },
    { protocolVersion, capabilities: {}, clientInfo: { name: "", version: "1" } },
    { protocolVersion, capabilities: {}, clientInfo: { name: "protocol-test", version: "" } },
  ];
  for (const params of malformed) {
    await assert.rejects(
      () => server.handle({ method: "initialize", params }),
      (error) => error.code === ERROR_CODES.INVALID_PARAMS,
    );
  }
});

test("stdio enforces the line limit by UTF-8 bytes", async () => {
  const multibyteLine = "é".repeat((1024 * 1024 / 2) + 1);
  assert.equal(multibyteLine.length < 1024 * 1024, true);
  assert.equal(Buffer.byteLength(multibyteLine, "utf8") > 1024 * 1024, true);
  const responses = await exchange([multibyteLine], makeBundle());
  assert.equal(responses.length, 1);
  assert.equal(responses[0].error.code, ERROR_CODES.INVALID_REQUEST);
  assert.match(responses[0].error.data.detail, /exceeds 1 MiB/);
});

test("advertised schemas enforce the built-in subset without coercion", async () => {
  const server = createServer([`local=${makeBundle()}`], {
    allowRuntimeRemoteLoad: true,
  });
  const tools = await server.handle({ method: "tools/list" });
  const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
  const searchSchema = byName.get("search_concepts").inputSchema;

  assert.deepEqual(validateToolArguments(searchSchema, {
    limit: "20",
    unexpectedField: true,
  }), [
    { path: "/limit", message: "must be an integer" },
    { path: "/unexpectedField", message: "is not allowed" },
  ]);
  assert.deepEqual(validateToolArguments(searchSchema, { limit: 251 }), [
    { path: "/limit", message: "must be less than or equal to 250" },
  ]);
  assert.throws(
    () => assertSupportedSchema({ type: "object", patternProperties: {} }),
    /Unsupported tool schema keyword/,
  );
  assert.equal(searchSchema.properties.limit.type, "integer");
  assert.equal(searchSchema.properties.limit.default, 25);
  assert.equal(searchSchema.properties.offset.minimum, 0);
  assert.equal(byName.get("load_remote_bundle").inputSchema.properties.provider.default, "github");
  assert.equal(byName.get("export_graph").inputSchema.properties.format.default, "json");
  assert.equal(byName.get("get_graph").inputSchema.properties.includeExternal.default, false);
  assert.match(
    searchSchema.properties.relationType.description,
    /outgoing relation/,
  );
});

test("the built-in validator covers every supported schema constraint", () => {
  const schema = {
    type: "object",
    description: "Validator coverage fixture.",
    additionalProperties: false,
    required: ["mode", "count", "enabled", "items", "metadata"],
    properties: {
      mode: {
        type: "string",
        description: "Selected mode.",
        enum: ["safe", "fast"],
        minLength: 1,
        default: "safe",
      },
      count: {
        type: "integer",
        description: "Bounded count.",
        minimum: 1,
        maximum: 3,
      },
      enabled: {
        type: "boolean",
        description: "Feature switch.",
      },
      items: {
        type: "array",
        description: "Named values.",
        minItems: 1,
        items: {
          type: "string",
          description: "One value.",
          minLength: 1,
        },
      },
      metadata: {
        type: "object",
        description: "Metadata values.",
        minProperties: 1,
        additionalProperties: true,
      },
      first: {
        type: "string",
        description: "First alternative.",
      },
      second: {
        type: "string",
        description: "Second alternative.",
      },
    },
    anyOf: [
      { required: ["first"] },
      { required: ["second"] },
    ],
  };
  assertSupportedSchema(schema);
  assert.deepEqual(validateToolArguments(schema, {
    mode: "safe",
    count: 2,
    enabled: true,
    items: ["one"],
    metadata: { source: "test" },
    first: "chosen",
  }), []);

  const issues = validateToolArguments(schema, {
    mode: "other",
    count: 0,
    enabled: "yes",
    items: [],
    metadata: {},
    extra: true,
  });
  assert.deepEqual(issues.map((issue) => issue.path), [
    "/mode",
    "/count",
    "/enabled",
    "/items",
    "/metadata",
    "/extra",
    "",
  ]);
});

test("tool schema and business failures return ToolResult errors", async () => {
  const server = createServer([`local=${makeBundle()}`]);
  const invalid = await server.handle({
    method: "tools/call",
    params: {
      name: "search_concepts",
      arguments: { limit: "twenty", unexpectedField: true },
    },
  });
  assert.equal(invalid.isError, true);
  const invalidPayload = JSON.parse(invalid.content[0].text);
  assert.equal(invalidPayload.error, "Invalid tool arguments");
  assert.deepEqual(invalidPayload.issues.map((issue) => issue.path), ["/limit", "/unexpectedField"]);

  const missing = await server.handle({
    method: "tools/call",
    params: {
      name: "get_concept",
      arguments: { uri: "okf://local/missing" },
    },
  });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /Unknown OKF concept URI/);

  const missingGraphConcept = await server.handle({
    method: "tools/call",
    params: {
      name: "get_neighbors",
      arguments: { uri: "okf://local/missing" },
    },
  });
  assert.equal(missingGraphConcept.isError, true);
  assert.match(missingGraphConcept.content[0].text, /Unknown valid OKF concept/);

  const unknownBundle = await server.handle({
    method: "tools/call",
    params: {
      name: "validate_bundle",
      arguments: { bundle: "missing" },
    },
  });
  assert.equal(unknownBundle.isError, true);
  assert.match(unknownBundle.content[0].text, /Unknown OKF bundle/);

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("network unavailable");
  };
  try {
    const remoteServer = createServer([`local=${makeBundle()}`], {
      allowRuntimeRemoteLoad: true,
    });
    const remoteFailure = await remoteServer.handle({
      method: "tools/call",
      params: {
        name: "load_remote_bundle",
        arguments: {
          id: "unavailable",
          url: "https://github.com/acme/unavailable/tree/main/okf",
        },
      },
    });
    assert.equal(remoteFailure.isError, true);
    assert.match(remoteFailure.content[0].text, /network unavailable/);
  } finally {
    globalThis.fetch = previousFetch;
  }

  const { root, projectPath } = makeProject();
  const authoring = await createServerAsync([], {
    projectPath,
    proposalRoot: path.join(root, "proposals"),
    allowAuthoring: true,
  });
  const validation = await authoring.handle({
    method: "tools/call",
    params: {
      name: "okf_validate_concept",
      arguments: { bundle: "local", path: "invalid.md", frontmatter: {} },
    },
  });
  assert.equal(validation.isError, undefined);
  assert.equal(JSON.parse(validation.content[0].text).valid, false);

  const proposal = await authoring.handle({
    method: "tools/call",
    params: {
      name: "okf_propose_concept",
      arguments: { bundle: "local", path: "invalid.md", frontmatter: {} },
    },
  });
  assert.equal(proposal.isError, true);
  assert.equal(JSON.parse(proposal.content[0].text).created, false);

  const emptyUpdate = await authoring.handle({
    method: "tools/call",
    params: {
      name: "okf_propose_update",
      arguments: { uri: "okf://local/existing.md", frontmatter: {} },
    },
  });
  assert.equal(emptyUpdate.isError, true);
  assert.deepEqual(
    JSON.parse(emptyUpdate.content[0].text).issues.map((issue) => issue.path),
    ["/frontmatter"],
  );

  const proposedUpdate = await authoring.handle({
    method: "tools/call",
    params: {
      name: "okf_propose_update",
      arguments: {
        uri: "okf://local/existing.md",
        body: "# Existing\n\nProposed replacement.",
      },
    },
  });
  const proposedUpdatePayload = JSON.parse(proposedUpdate.content[0].text);
  assert.equal(proposedUpdate.isError, undefined);
  assert.equal(proposedUpdatePayload.created, true);
  const proposalId = proposedUpdatePayload.proposal.id;
  fs.appendFileSync(
    path.join(root, "bundle", "existing.md"),
    "\nExternal change during review.\n",
    "utf8",
  );
  const conflict = await authoring.handle({
    method: "tools/call",
    params: {
      name: "okf_accept_proposal",
      arguments: { proposalId },
    },
  });
  const conflictPayload = JSON.parse(conflict.content[0].text);
  assert.equal(conflict.isError, true);
  assert.equal(conflictPayload.accepted, false);
  assert.equal(conflictPayload.conflict, true);
});

test("unexpected implementation failures propagate and serialize as internal errors", async () => {
  const server = createServer([`local=${makeBundle()}`]);
  Object.defineProperty(server.index, "concepts", {
    configurable: true,
    get() {
      throw new Error("private implementation detail");
    },
  });
  let rawError;
  await assert.rejects(
    () => server.handle({
      method: "tools/call",
      params: { name: "list_types", arguments: {} },
    }),
    (error) => {
      rawError = error;
      assert.equal(error.message, "private implementation detail");
      return true;
    },
  );
  const response = responseFor(7, null, rawError);
  assert.equal(response.error.code, ERROR_CODES.INTERNAL_ERROR);
  assert.equal(response.error.message, "Internal error");
  assert.equal(response.error.data, undefined);

  const authoringServer = createServer([`local=${makeBundle()}`], {
    allowAuthoring: true,
    authoringService: {
      async proposeConcept() {
        throw new TypeError("authoring implementation defect");
      },
    },
  });
  await assert.rejects(
    () => authoringServer.handle({
      method: "tools/call",
      params: {
        name: "okf_propose_concept",
        arguments: {
          bundle: "local",
          path: "new.md",
          frontmatter: { type: "Concept", title: "New" },
        },
      },
    }),
    (error) => error instanceof TypeError && /implementation defect/.test(error.message),
  );
});

test("list_concepts honors its documented text query", async () => {
  const server = createServer([`local=${makeBundle()}`]);
  const result = await server.handle({
    method: "tools/call",
    params: {
      name: "list_concepts",
      arguments: { query: "beta-only-token" },
    },
  });
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.total, 1);
  assert.equal(payload.results[0].title, "Beta");
});

test("the real CLI keeps stdio parseable and silent for successful and failing notifications", () => {
  const bundle = makeBundle();
  const input = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "protocol-test", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { jsonrpc: "2.0", method: "notifications/unknown", params: {} },
    {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "get_concept",
        arguments: { uri: "okf://local/missing" },
      },
    },
    { jsonrpc: "2.0", id: 2, method: "ping", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
  ].map((message) => JSON.stringify(message)).join("\n") + "\n";
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../bin/okf-mcp.js"), "--bundle", `local=${bundle}`, "mcp"],
    {
      encoding: "utf8",
      input,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error) {
    throw result.error;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const responses = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(responses.map((response) => response.id), [1, 2, 3]);
  assert.equal(responses[0].result.protocolVersion, "2025-11-25");
  assert.deepEqual(responses[1].result, {});
  assert.equal(
    responses[2].result.tools.some((tool) => tool.name === "get_concept"),
    true,
  );
});
