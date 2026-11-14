"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

const { ConceptAuthoringService } = require("../src/authoring");
const { proposalServiceFor } = require("../src/authoring/proposal-policy");
const { main, parseArgs, usage } = require("../src/cli");
const { LiveAuthoringService } = require("../src/live-authoring");
const { createMcpServer, callTool, createStateAsync } = require("../src/mcp/server");
const { loadProjectConfig } = require("../src/project");
const { FileConceptStore } = require("../src/store");
const { callJson, connectMcp } = require("./mcp-client");

const repositoryRoot = path.resolve(__dirname, "..");
const binary = path.join(repositoryRoot, "bin", "okf-mcp.js");
const MODEL = "openai/gpt-5.6";

const POLICY_YAML = [
  "defaultEffect: deny",
  "rules:",
  "  - name: humans",
  '    actors: ["human:*"]',
  "  - name: nightly",
  '    actors: ["process:nightly-*", "openai/*"]',
  '    bundles: ["customers-*"]',
  '    paths: ["findings/**"]',
  '    types: ["SEO Finding"]',
  '    requiredFields: ["sources", "stale_after"]',
  "    defaultStatus: draft",
  "    maxConceptsPerBatch: 2",
];

function write(root, relativePath, text) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
}

function seedBundle(root, title) {
  write(
    root,
    "index.md",
    [
      "---",
      'okf_version: "0.2"',
      "---",
      "",
      `# ${title}`,
      "",
      "- [Source](references/source.md)",
      "",
    ].join("\n"),
  );
  write(
    root,
    "references/source.md",
    ["---", "type: Reference", "title: Source", "---", "", "# Source", ""].join("\n"),
  );
}

function makeProject(t, policyLines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-write-policy-project-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBundle(path.join(root, "bundles", "customers-a"), "Customers A");
  seedBundle(path.join(root, "bundles", "internal"), "Internal");
  write(
    root,
    "okf.project.yaml",
    [
      "project: Policy",
      "bundles:",
      "  - id: customers-a",
      "    root: bundles/customers-a",
      "  - id: internal",
      "    root: bundles/internal",
      "writePolicy:",
      ...(policyLines || POLICY_YAML).map((line) => `  ${line}`),
      "",
    ].join("\n"),
  );
  return { root, projectPath: path.join(root, "okf.project.yaml") };
}

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-write-policy-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBundle(path.join(root, "customers-a"), "Customers A");
  write(root, "policy.yaml", `${POLICY_YAML.join("\n")}\n`);
  return { root: path.join(root, "customers-a"), policyPath: path.join(root, "policy.yaml") };
}

function finding(overrides) {
  return Object.assign(
    {
      op: "create",
      path: "findings/one.md",
      type: "SEO Finding",
      title: "Finding One",
      sources: ["/references/source.md"],
      metadata: { stale_after: "2027-01-01" },
    },
    overrides,
  );
}

function listFiles(root) {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath || entry.path, entry.name)))
    .sort();
}

function summary(violations) {
  return violations.map((entry) => [
    entry.rule,
    entry.reason,
    entry.field || null,
    entry.path || null,
  ]);
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
    { name: "okf-write-policy-test", version: "1" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(transport);
  t.after(() => client.close());
  return { client, stderr: () => stderr };
}

test("a project writePolicy is reported read-only by validate and refused by apply before any write", async (t) => {
  const { root, projectPath } = makeProject(t);
  const customers = path.join(root, "bundles", "customers-a");
  const { client } = await connectMcp(t, [], { projectPath, allowWrite: true, actor: MODEL });
  const filesBefore = listFiles(root);
  const graphBefore = (await callJson(client, "export_graph", { format: "json" })).payload;

  // The tools take no policy or actor input: configuration cannot be changed by a caller (B-5).
  const listed = await client.listTools();
  const apply = listed.tools.find((tool) => tool.name === "okf_apply_changes");
  assert.equal(apply.inputSchema.additionalProperties, false);
  for (const key of ["policy", "writePolicy", "actor"]) {
    assert.equal(Object.hasOwn(apply.inputSchema.properties, key), false);
  }
  assert.ok(apply.outputSchema.properties.policyViolations);
  assert.match(apply.description, /write policy/);
  const smuggled = await client.callTool({
    name: "okf_apply_changes",
    arguments: {
      bundle: "customers-a",
      changes: [finding()],
      writePolicy: { defaultEffect: "allow" },
    },
  });
  assert.equal(smuggled.isError, true);
  assert.match(smuggled.content[0].text, /Invalid arguments/i);

  // Bundle outside the rule: the nearest allow rule and its failing selector are named.
  const denied = await callJson(client, "okf_validate_changes", {
    bundle: "internal",
    changes: [finding()],
  });
  assert.equal(denied.result.isError, undefined);
  assert.equal(denied.payload.valid, false);
  assert.equal(denied.payload.readyToApply, false);
  assert.equal(denied.payload.status, "invalid");
  assert.deepEqual(denied.payload.policyViolations, [
    {
      code: "policy_violation",
      rule: "nightly",
      reason: "bundle_denied",
      path: "findings/one.md",
      bundleId: "internal",
      uri: "okf://internal/findings/one",
    },
  ]);
  const diagnostic = denied.payload.validation.diagnostics.find(
    (entry) => entry.code === "policy_violation",
  );
  assert.equal(diagnostic.layer, "policy");
  assert.equal(diagnostic.severity, "error");
  assert.equal(diagnostic.rule, "nightly");
  assert.equal(diagnostic.reason, "bundle_denied");
  assert.match(diagnostic.message, /rule nightly/);
  assert.doesNotMatch(diagnostic.message, /Finding One/);

  // Path, type and required fields.
  const wrongPath = await callJson(client, "okf_validate_changes", {
    bundle: "customers-a",
    changes: [finding({ path: "notes/one.md" })],
  });
  assert.deepEqual(summary(wrongPath.payload.policyViolations), [
    ["nightly", "path_denied", null, "notes/one.md"],
  ]);
  const wrongType = await callJson(client, "okf_validate_changes", {
    bundle: "customers-a",
    changes: [finding({ type: "Reference" })],
  });
  assert.deepEqual(summary(wrongType.payload.policyViolations), [
    ["nightly", "type_denied", null, "findings/one.md"],
  ]);
  const missing = await callJson(client, "okf_validate_changes", {
    bundle: "customers-a",
    changes: [finding({ sources: undefined, metadata: undefined })],
  });
  assert.deepEqual(summary(missing.payload.policyViolations), [
    ["nightly", "missing_required_field", "sources", "findings/one.md"],
    ["nightly", "missing_required_field", "stale_after", "findings/one.md"],
  ]);
  const tooMany = await callJson(client, "okf_validate_changes", {
    bundle: "customers-a",
    changes: [
      finding({ path: "findings/a.md", title: "A" }),
      finding({ path: "findings/b.md", title: "B" }),
      finding({ path: "findings/c.md", title: "C" }),
    ],
  });
  assert.deepEqual(summary(tooMany.payload.policyViolations), [
    ["nightly", "batch_too_large", null, null],
  ]);
  assert.equal(tooMany.payload.policyViolations[0].limit, 2);
  assert.equal(tooMany.payload.policyViolations[0].count, 3);

  // Apply refuses every one of those before staging: nothing on disk changes.
  for (const input of [
    { bundle: "internal", changes: [finding()] },
    { bundle: "customers-a", changes: [finding({ sources: undefined })] },
    {
      bundle: "customers-a",
      changes: [
        finding({ path: "findings/a.md", title: "A" }),
        finding({ path: "findings/b.md", title: "B" }),
        finding({ path: "findings/c.md", title: "C" }),
      ],
    },
  ]) {
    const refused = await callJson(client, "okf_apply_changes", input);
    assert.equal(refused.result.isError, true);
    assert.equal(refused.payload.applied, false);
    assert.equal(refused.payload.filesChanged, false);
    assert.equal(refused.payload.status, "rejected");
    assert.equal(refused.payload.durability.state, "not_persisted");
    assert.ok(refused.payload.policyViolations.length >= 1);
    assert.ok(refused.payload.policyViolations.every((entry) => entry.code === "policy_violation"));
  }
  assert.deepEqual(listFiles(root), filesBefore);
  assert.deepEqual(
    (await callJson(client, "export_graph", { format: "json" })).payload,
    graphBefore,
  );

  // A compliant batch applies; the created concept takes the default status.
  const applied = await callJson(client, "okf_apply_changes", {
    bundle: "customers-a",
    changes: [
      finding(),
      finding({
        path: "findings/two.md",
        title: "Finding Two",
        metadata: { stale_after: "2027-01-01", status: "stable" },
      }),
    ],
  });
  assert.equal(applied.result.isError, undefined);
  assert.equal(applied.payload.applied, true);
  assert.deepEqual(applied.payload.policyViolations, []);
  const one = fs.readFileSync(path.join(customers, "findings", "one.md"), "utf8");
  assert.match(one, /^status: draft$/m);
  assert.ok(one.indexOf("status: draft") < one.indexOf("generated:"));
  const two = fs.readFileSync(path.join(customers, "findings", "two.md"), "utf8");
  assert.match(two, /^status: stable$/m);
  assert.doesNotMatch(two, /draft/);
  const read = await callJson(client, "get_concept", { uri: "okf://customers-a/findings/one" });
  assert.equal(read.payload.signals.status, "draft");
  assert.equal(read.payload.frontmatter.stale_after, "2027-01-01");

  // An update is judged on its merged frontmatter; removing a required field is refused.
  const stripped = await callJson(client, "okf_validate_changes", {
    bundle: "customers-a",
    changes: [
      { op: "update", uri: "okf://customers-a/findings/one", removeMetadataKeys: ["stale_after"] },
    ],
  });
  assert.deepEqual(summary(stripped.payload.policyViolations), [
    ["nightly", "missing_required_field", "stale_after", "findings/one.md"],
  ]);
  const retagged = await callJson(client, "okf_validate_changes", {
    bundle: "customers-a",
    changes: [{ op: "update", uri: "okf://customers-a/findings/one", tags: { add: ["reviewed"] } }],
  });
  assert.equal(retagged.payload.valid, true);
  assert.deepEqual(retagged.payload.policyViolations, []);

  // A human actor matches the first rule and may write anywhere.
  const human = await connectMcp(t, [], { projectPath, allowWrite: true, actor: "human:alice" });
  const anywhere = await callJson(human.client, "okf_apply_changes", {
    bundle: "internal",
    changes: [{ op: "create", path: "notes/free.md", type: "Reference", title: "Free" }],
  });
  assert.equal(anywhere.payload.applied, true);
  assert.deepEqual(anywhere.payload.policyViolations, []);
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, "bundles", "internal", "notes", "free.md"), "utf8"),
    /status:/,
  );
});

test("a refused apply leaves the server index object and the catalog bytes untouched", async (t) => {
  const { root, projectPath } = makeProject(t);
  const state = await createStateAsync([], { projectPath, allowWrite: true, actor: MODEL });
  const indexBefore = state.index;
  const conceptsBefore = state.index.concepts.map((doc) => [doc.uri, doc.text]);
  const filesBefore = listFiles(root);
  const refused = await callTool(state, "okf_apply_changes", {
    bundle: "customers-a",
    changes: [finding({ path: "notes/one.md" })],
  });
  assert.equal(refused.isError, true);
  const receipt = JSON.parse(refused.content[0].text);
  assert.equal(receipt.applied, false);
  assert.deepEqual(summary(receipt.policyViolations), [
    ["nightly", "path_denied", null, "notes/one.md"],
  ]);
  assert.equal(state.index, indexBefore);
  assert.deepEqual(
    state.index.concepts.map((doc) => [doc.uri, doc.text]),
    conceptsBefore,
  );
  assert.deepEqual(listFiles(root), filesBefore);
  assert.equal(state.liveAuthoringService.takePublication(), null);
});

test("--root --policy enforces the same rules through the stdio binary", async (t) => {
  const { root, policyPath } = makeRoot(t);
  const { client, stderr } = await connectBinary(t, [
    "--root",
    root,
    "--write",
    "--actor",
    MODEL,
    "--policy",
    policyPath,
  ]);
  const bundleId = path.basename(root);
  const denied = await callJson(client, "okf_validate_changes", {
    changes: [finding({ path: "notes/one.md" })],
  });
  assert.equal(denied.payload.valid, false);
  assert.deepEqual(summary(denied.payload.policyViolations), [
    ["nightly", "path_denied", null, "notes/one.md"],
  ]);
  const refused = await callJson(client, "okf_apply_changes", {
    changes: [finding({ sources: undefined })],
  });
  assert.equal(refused.result.isError, true);
  assert.equal(refused.payload.applied, false);
  assert.deepEqual(summary(refused.payload.policyViolations), [
    ["nightly", "missing_required_field", "sources", "findings/one.md"],
  ]);
  assert.equal(fs.existsSync(path.join(root, "findings")), false);
  const applied = await callJson(client, "okf_apply_changes", { changes: [finding()] });
  assert.equal(applied.payload.applied, true);
  assert.deepEqual(applied.payload.policyViolations, []);
  assert.match(fs.readFileSync(path.join(root, "findings", "one.md"), "utf8"), /^status: draft$/m);
  assert.equal(applied.payload.changes[0].uri, `okf://${bundleId}/findings/one`);
  assert.equal(stderr(), "");

  // Without --policy the same root accepts the write and receipts carry no policy field.
  const open = await connectBinary(t, ["--root", root, "--write", "--actor", MODEL]);
  const free = await callJson(open.client, "okf_validate_changes", {
    changes: [finding({ path: "notes/two.md", title: "Two" })],
  });
  assert.equal(free.payload.valid, true);
  assert.equal(Object.hasOwn(free.payload, "policyViolations"), false);
});

test("--policy is parsed strictly and an invalid policy never yields a writable server", async (t) => {
  const { root, policyPath } = makeRoot(t);
  assert.match(usage(), /--policy <file>/);
  assert.equal(parseArgs(["--write", "--actor", MODEL, "--policy", policyPath]).policy, policyPath);
  assert.equal(
    parseArgs(["--write", "--actor", MODEL, `--policy=${policyPath}`]).policy,
    policyPath,
  );
  assert.throws(() => parseArgs(["--policy", policyPath]), /--policy requires --write/);
  assert.throws(() => parseArgs(["--write", "--actor", MODEL, "--policy"]), /requires a value/);
  assert.throws(() => parseArgs(["--write", "--actor", MODEL, "--policy="]), /requires a value/);
  assert.throws(
    () => parseArgs(["--write", "--actor", MODEL, "--policy", policyPath, "--policy", policyPath]),
    /only once/,
  );
  const calls = [];
  const runtime = {
    runStdioServer: async (...call) => {
      calls.push(call[3]);
    },
  };
  await main(["--root", root, "--write", "--actor", MODEL, "--policy", policyPath, "mcp"], runtime);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].writePolicy.rules.length, 2);
  assert.equal(calls[0].writePolicy.defaultEffect, "deny");

  const project = makeProject(t);
  await assert.rejects(
    main(
      [
        "--project",
        project.projectPath,
        "--write",
        "--actor",
        MODEL,
        "--policy",
        policyPath,
        "mcp",
      ],
      runtime,
    ),
    /--policy requires --root/,
  );
  await assert.rejects(
    main(
      ["--root", root, "--write", "--actor", MODEL, "--policy", policyPath, "producer", "run", "x"],
      runtime,
    ),
    /--policy is available only with the mcp command/,
  );
  const broken = path.join(path.dirname(policyPath), "broken.yaml");
  fs.writeFileSync(
    broken,
    ["rules:", "  - actors: ['**']", "    paths: ['../escape/**']", ""].join("\n"),
    "utf8",
  );
  await assert.rejects(
    main(["--root", root, "--write", "--actor", MODEL, "--policy", broken, "mcp"], runtime),
    (error) =>
      error.code === "invalid_write_policy" &&
      /writePolicy\.rules\[0\]\.paths\[0\]/.test(error.message),
  );
  assert.equal(calls.length, 1);
  // Programmatic hosts get the same strictness.
  await assert.rejects(
    createMcpServer([], {
      rootPath: root,
      allowWrite: true,
      actor: MODEL,
      writePolicy: { defaultEffect: "maybe" },
    }),
    /Invalid write policy: writePolicy\.defaultEffect/,
  );

  // A malformed writePolicy in okf.project.yaml is a project error; the writable store refuses to start.
  const invalid = makeProject(t, [
    "rules:",
    "  - actors: ['human:*']",
    "    paths: ['/absolute/**']",
  ]);
  const loaded = loadProjectConfig(invalid.projectPath);
  assert.deepEqual(
    loaded.errors.map((entry) => [entry.code, entry.field]),
    [["invalid_write_policy_pattern", "writePolicy.rules[0].paths[0]"]],
  );
  assert.equal(loaded.writePolicy, null);
  await assert.rejects(
    createMcpServer([], { projectPath: invalid.projectPath, allowWrite: true, actor: MODEL }),
    /invalid project configuration/,
  );
});

function git(repository, args) {
  // The caller's GIT_* variables would override the repository identity.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const result = spawnSync("git", ["-C", repository].concat(args), { encoding: "utf8", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function note(file, title) {
  return { bundle: "internal", changes: [{ op: "create", path: file, type: "Reference", title }] };
}

test("one live service judges and stamps each call with that call's actor", async (t) => {
  const { root, projectPath } = makeProject(t);
  const store = FileConceptStore.fromProject(projectPath);
  const service = new LiveAuthoringService(store, { actor: MODEL });

  // The configured actor and an explicit one are judged alike: the nightly
  // rule does not cover the internal bundle.
  for (const context of [undefined, { actor: MODEL }]) {
    const denied = await service.validateChanges(note("notes/one.md", "One"), context);
    assert.equal(denied.valid, false);
    assert.equal(denied.generated.by, MODEL);
    assert.deepEqual(summary(denied.policyViolations), [
      ["nightly", "bundle_denied", null, "notes/one.md"],
    ]);
  }
  // A human caller of the same service matches the first rule.
  const applied = await service.applyChanges(note("notes/one.md", "One"), { actor: "human:alice" });
  assert.equal(applied.applied, true);
  assert.equal(applied.generated.by, "human:alice");
  assert.deepEqual(applied.policyViolations, []);
  assert.match(
    fs.readFileSync(path.join(root, "bundles", "internal", "notes", "one.md"), "utf8"),
    /^ {2}by: human:alice$/m,
  );
  const refused = await service.applyChanges(note("notes/two.md", "Two"), { actor: MODEL });
  assert.equal(refused.applied, false);
  assert.deepEqual(summary(refused.policyViolations), [
    ["nightly", "bundle_denied", null, "notes/two.md"],
  ]);
  assert.equal(fs.existsSync(path.join(root, "bundles", "internal", "notes", "two.md")), false);
  // A batch refused before planning still names the call's actor.
  const malformed = await service.validateChanges(
    { changes: [{ op: "move" }] },
    { actor: "human:alice" },
  );
  assert.equal(malformed.status, "invalid");
  assert.equal(malformed.generated.by, "human:alice");
  assert.equal(malformed.snapshot.generatedBy, "human:alice");
  await assert.rejects(
    service.validateChanges(note("notes/three.md", "Three"), { actor: "nobody" }),
    /actor must use/,
  );
  assert.equal(service.actor, MODEL);

  // Proposals record and are judged against the call's actor too.
  const authoring = new ConceptAuthoringService(store, { actor: MODEL });
  assert.equal(proposalServiceFor(authoring, MODEL), authoring);
  assert.equal(proposalServiceFor(authoring, undefined), authoring);
  const proposal = {
    bundle: "internal",
    path: "notes/proposed.md",
    frontmatter: { type: "Reference", title: "Proposed" },
    body: "# Proposed",
  };
  const byModel = await proposalServiceFor(authoring, MODEL).proposeConcept(proposal);
  assert.equal(byModel.created, false);
  assert.deepEqual(summary(byModel.policyViolations), [
    ["nightly", "bundle_denied", null, "notes/proposed.md"],
  ]);
  const byAlice = await proposalServiceFor(authoring, "human:alice").proposeConcept(proposal);
  assert.equal(byAlice.created, true);
  assert.equal(byAlice.proposal.proposedBy, "human:alice");
  assert.equal(authoring.actor, MODEL);
  assert.throws(() => proposalServiceFor(authoring, "nobody"), /actor must use/);
});

test("a call's author signs the git commit while the configured identity commits", async (t) => {
  const { root, projectPath } = makeProject(t);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Repo Committer"]);
  git(root, ["config", "user.email", "committer@example.invalid"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  const service = new LiveAuthoringService(FileConceptStore.fromProject(projectPath), {
    actor: MODEL,
    gitCommit: true,
  });
  const author = { name: "Mario Rossi", email: "mrossi@example.com" };
  const signed = await service.applyChanges(note("notes/signed.md", "Signed"), {
    actor: "human:mrossi",
    author,
  });
  assert.equal(signed.applied, true);
  assert.equal(signed.git.committed, true);
  assert.equal(signed.generated.by, "human:mrossi");
  assert.equal(
    git(root, ["log", "-1", "--format=%an/%ae/%cn/%ce"]),
    "Mario Rossi/mrossi@example.com/Repo Committer/committer@example.invalid",
  );
  // Without an author both roles stay the configured identity.
  const plain = await service.applyChanges(note("notes/plain.md", "Plain"), {
    actor: "human:alice",
  });
  assert.equal(plain.git.committed, true);
  assert.equal(git(root, ["log", "-1", "--format=%an/%cn"]), "Repo Committer/Repo Committer");
  for (const malformed of [
    { name: "Mario Rossi" },
    { name: "Mario\nRossi", email: "mrossi@example.com" },
    { name: "Mario <Rossi>", email: "mrossi@example.com" },
  ]) {
    await assert.rejects(
      service.applyChanges(note("notes/bad.md", "Bad"), { actor: "human:x", author: malformed }),
      /author must carry/,
    );
  }
  assert.equal(git(root, ["status", "--porcelain"]), "");
});
