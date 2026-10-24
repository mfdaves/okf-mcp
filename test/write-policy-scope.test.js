"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ConceptAuthoringService } = require("../src/authoring");
const { main, parseArgs } = require("../src/cli");
const { runHttpServer } = require("../src/http-server");
const { loadProjectConfig } = require("../src/project");
const { ProducerService } = require("../src/producers");
const { FileConceptStore } = require("../src/store");
const { callJson, connectMcp } = require("./mcp-client");

// The write policy's scope (plan W-1): live batches (covered by
// write-policy-enforcement.test.js), proposals at creation and again at
// acceptance, and producers only when the policy opts them in.

const REVIEWER = "human:reviewer";
const AGENT = "openai/gpt-5.6";
const TOKEN = "scope-token";

function write(root, relativePath, text) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
}

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// One bundle with one concept; `policyLines` become the writePolicy mapping.
function makeCatalogProject(t, policyLines) {
  const root = tempRoot(t, "okf-policy-scope-");
  const bundle = path.join(root, "bundles", "notes");
  write(
    bundle,
    "index.md",
    ["---", 'okf_version: "0.2"', "---", "", "# Notes", "", "- [Topic](topic.md)", ""].join("\n"),
  );
  write(
    bundle,
    "topic.md",
    ["---", "type: Note", "title: Topic", "---", "", "# Topic", ""].join("\n"),
  );
  write(
    root,
    "okf.project.yaml",
    [
      "project: Scope",
      "bundles:",
      "  - id: notes",
      "    root: bundles/notes",
      "writePolicy:",
      ...policyLines.map((line) => `  ${line}`),
      "",
    ].join("\n"),
  );
  return { root, bundle, projectPath: path.join(root, "okf.project.yaml") };
}

// A store on the same project whose service carries an allow-all policy and
// the given actor: how a proposal gets recorded before a stricter server
// sees it.
async function storeProposal(projectPath, actor, input) {
  const service = new ConceptAuthoringService(FileConceptStore.fromProject(projectPath), {
    actor,
    writePolicy: { defaultEffect: "allow" },
  });
  const result = await (input.uri ? service.proposeUpdate(input) : service.proposeConcept(input));
  assert.equal(result.created, true);
  return result.proposal;
}

const NEW_NOTE = {
  bundle: "notes",
  path: "new-note.md",
  frontmatter: { type: "Note", title: "New note" },
  body: "# New note",
};
const UPDATE_TOPIC = { uri: "okf://notes/topic", body: "# Topic\n\nRevised." };

test("proposals are judged at creation against the proposing actor and refused before storage", async (t) => {
  const fixture = makeCatalogProject(t, [
    "defaultEffect: deny",
    "rules:",
    "  - name: reviewers",
    `    actors: ["${REVIEWER}"]`,
    "    defaultStatus: draft",
  ]);
  const topicBefore = fs.readFileSync(path.join(fixture.bundle, "topic.md"), "utf8");
  const agent = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    allowAuthoring: true,
    actor: AGENT,
  });
  for (const [name, args] of [
    ["okf_propose_concept", NEW_NOTE],
    ["okf_propose_update", UPDATE_TOPIC],
  ]) {
    const refused = await callJson(agent.client, name, args);
    assert.equal(refused.result.isError, true, name);
    assert.equal(refused.payload.created, false);
    assert.equal(refused.payload.validation.valid, false);
    assert.deepEqual(
      refused.payload.policyViolations.map(({ code, rule, reason }) => [code, rule, reason]),
      [["policy_violation", null, "actor_denied"]],
    );
    assert.ok(
      refused.payload.validation.errors.some(
        (entry) => entry.layer === "policy" && entry.code === "policy_violation",
      ),
    );
  }
  assert.deepEqual((await callJson(agent.client, "okf_list_proposals", {})).payload, []);

  // The allowed actor's proposal is stored, attributed, and stamped with the
  // rule's default status.
  const reviewer = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    allowAuthoring: true,
    actor: REVIEWER,
  });
  const stored = await callJson(reviewer.client, "okf_propose_concept", NEW_NOTE);
  assert.equal(stored.payload.created, true);
  assert.equal(stored.payload.proposal.proposedBy, REVIEWER);
  assert.equal(stored.payload.proposal.frontmatter.status, "draft");
  assert.match(stored.payload.proposal.markdown, /\nstatus: draft\n/);
  assert.equal(fs.existsSync(path.join(fixture.bundle, "new-note.md")), false);
  assert.equal(fs.readFileSync(path.join(fixture.bundle, "topic.md"), "utf8"), topicBefore);
});

test("acceptance is judged against the recorded actor, else the accepting one, before any write", async (t) => {
  const fixture = makeCatalogProject(t, [
    "defaultEffect: deny",
    "rules:",
    "  - name: reviewers",
    `    actors: ["${REVIEWER}"]`,
  ]);
  const topicPath = path.join(fixture.bundle, "topic.md");
  const topicBefore = fs.readFileSync(topicPath, "utf8");
  const byAgent = await storeProposal(fixture.projectPath, AGENT, UPDATE_TOPIC);
  const unattributed = await storeProposal(fixture.projectPath, null, NEW_NOTE);
  assert.equal(byAgent.proposedBy, AGENT);
  assert.equal(Object.hasOwn(unattributed, "proposedBy"), false);

  // Even the reviewer cannot accept what the agent proposed.
  const reviewer = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    allowAuthoring: true,
    actor: REVIEWER,
  });
  const refused = await callJson(reviewer.client, "okf_accept_proposal", {
    proposalId: byAgent.id,
  });
  assert.equal(refused.result.isError, true);
  assert.equal(refused.payload.accepted, false);
  assert.deepEqual(
    refused.payload.policyViolations.map(({ rule, reason, path: target }) => [
      rule,
      reason,
      target,
    ]),
    [[null, "actor_denied", "topic.md"]],
  );
  assert.equal(refused.payload.errors[0].layer, "policy");
  assert.equal(fs.readFileSync(topicPath, "utf8"), topicBefore);
  assert.equal(
    (await callJson(reviewer.client, "okf_get_proposal", { proposalId: byAgent.id })).payload
      .status,
    "proposed",
  );

  // An unattributed proposal takes the accepting actor: refused for the
  // agent, accepted for the reviewer.
  const agent = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    allowAuthoring: true,
    actor: AGENT,
  });
  const agentAccept = await callJson(agent.client, "okf_accept_proposal", {
    proposalId: unattributed.id,
  });
  assert.equal(agentAccept.payload.accepted, false);
  assert.equal(agentAccept.payload.policyViolations[0].reason, "actor_denied");
  assert.equal(fs.existsSync(path.join(fixture.bundle, "new-note.md")), false);
  const reviewerAccept = await callJson(reviewer.client, "okf_accept_proposal", {
    proposalId: unattributed.id,
  });
  assert.equal(reviewerAccept.payload.accepted, true);
  assert.equal(fs.existsSync(path.join(fixture.bundle, "new-note.md")), true);
});

test("the HTTP authoring API applies the same policy to proposals and acceptance", async (t) => {
  const fixture = makeCatalogProject(t, ["defaultEffect: deny"]);
  const topicPath = path.join(fixture.bundle, "topic.md");
  const topicBefore = fs.readFileSync(topicPath, "utf8");
  const pending = await storeProposal(fixture.projectPath, null, UPDATE_TOPIC);
  const { server, url } = await runHttpServer({
    projectPath: fixture.projectPath,
    port: 0,
    writeToken: TOKEN,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const post = async (route, body) => {
    const response = await fetch(`${url}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return response.json();
  };

  // HTTP carries no actor: the write is unattributed and the deny default decides.
  for (const [route, body] of [
    ["/v1/proposals", NEW_NOTE],
    ["/v1/proposals/update", UPDATE_TOPIC],
  ]) {
    const refused = await post(route, body);
    assert.equal(refused.created, false, route);
    assert.equal(refused.policyViolations[0].reason, "actor_denied");
  }
  const listed = await (
    await fetch(`${url}/v1/proposals`, { headers: { authorization: `Bearer ${TOKEN}` } })
  ).json();
  assert.deepEqual(
    listed.map((entry) => entry.id),
    [pending.id],
  );

  const accepted = await post(`/v1/proposals/${pending.id}/accept`);
  assert.equal(accepted.accepted, false);
  assert.equal(accepted.policyViolations[0].reason, "actor_denied");
  assert.equal(fs.readFileSync(topicPath, "utf8"), topicBefore);
  assert.equal(fs.existsSync(path.join(fixture.bundle, "new-note.md")), false);
});

test("--actor and --policy may accompany --authoring", () => {
  const args = parseArgs(["--root", "catalog", "--authoring", "--actor", REVIEWER]);
  assert.equal(args.actor, REVIEWER);
  assert.equal(parseArgs(["--root", "x", "--authoring", "--policy", "p.yaml"]).policy, "p.yaml");
  assert.throws(() => parseArgs(["--actor", REVIEWER]), /requires --write or --authoring/);
  assert.throws(() => parseArgs(["--authoring", "--actor", "nobody"]), /--actor must use/);
});

// Producers -------------------------------------------------------------

function makeProducerProject(t, policyLines) {
  const root = tempRoot(t, "okf-policy-producer-");
  fs.mkdirSync(path.join(root, "okf", "database"), { recursive: true });
  write(
    root,
    "okf.project.yaml",
    [
      "project: Producer scope",
      "bundles:",
      "  - id: database",
      "    root: okf/database",
      "producers:",
      "  - name: primary-db",
      "    type: postgresql",
      "    package: '@fixture/okf-postgres'",
      "    bundle: database",
      "    config:",
      "      connectionEnv: DATABASE_URL",
      "writePolicy:",
      ...policyLines.map((line) => `  ${line}`),
      "",
    ].join("\n"),
  );
  return {
    root,
    bundle: path.join(root, "okf", "database"),
    projectPath: path.join(root, "okf.project.yaml"),
  };
}

const PRODUCED = [
  {
    path: "index.md",
    content: [
      "---",
      'okf_version: "0.2"',
      "---",
      "",
      "# Database catalog",
      "",
      "- [Database](database.md)",
      "",
    ].join("\n"),
  },
  {
    path: "database.md",
    content: [
      "---",
      "type: Database",
      "title: Application database",
      "description: PostgreSQL database metadata.",
      "sources:",
      "  - resource: postgresql://catalog/application",
      "generated:",
      "  by: process:okf-postgres/0.1.0",
      "  at: 2026-08-20T10:00:00.000Z",
      "---",
      "",
      "# Application database",
      "",
    ].join("\n"),
  },
];

function producerService(fixture) {
  const project = loadProjectConfig(fixture.projectPath);
  assert.deepEqual(project.errors, []);
  return new ProducerService({
    project,
    store: FileConceptStore.fromProject(fixture.projectPath),
    loader: async () => ({
      okfProducer: {
        apiVersion: "1",
        okfVersion: "0.2",
        id: "postgresql",
        name: "okf-postgres",
        version: "0.1.0",
        relationTypes: [],
        validateConfig: (config) => ({ valid: true, config }),
        generate: async () => ({ files: PRODUCED, summary: { files: PRODUCED.length } }),
      },
    }),
    env: { DATABASE_URL: "postgresql://secret.invalid/application" },
    now: () => new Date("2026-08-20T10:00:00.000Z"),
  });
}

test("producers are exempt from the write policy by default", async (t) => {
  const fixture = makeProducerProject(t, ["defaultEffect: deny"]);
  const result = await producerService(fixture).run("primary-db");
  assert.equal(result.applied, true, JSON.stringify(result.diagnostics));
  assert.equal(Object.hasOwn(result, "policyViolations"), false);
  assert.equal(fs.existsSync(path.join(fixture.bundle, "database.md")), true);
});

test("applyToProducers judges producer output against process:<name> before publication", async (t) => {
  const fixture = makeProducerProject(t, [
    "applyToProducers: true",
    "defaultEffect: deny",
    "rules:",
    "  - name: database-producer",
    '    actors: ["process:primary-db"]',
    '    types: ["Database"]',
    '    requiredFields: ["stale_after"]',
  ]);
  const service = producerService(fixture);
  const preview = await service.preview("primary-db");
  assert.equal(preview.valid, false);
  assert.equal(preview.readyToApply, false);
  // The reserved index.md is not a concept write and is not judged.
  assert.deepEqual(
    preview.policyViolations.map(({ rule, reason, field, path: target }) => [
      rule,
      reason,
      field || null,
      target,
    ]),
    [["database-producer", "missing_required_field", "stale_after", "database.md"]],
  );
  assert.ok(preview.diagnostics.some((entry) => entry.layer === "policy"));

  const run = await service.run("primary-db");
  assert.equal(run.applied, false);
  assert.deepEqual(fs.readdirSync(fixture.bundle), []);

  // The MCP receipt carries the structured violations too.
  const mcp = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    allowWrite: true,
    actor: REVIEWER,
    producerService: service,
  });
  const receipt = await callJson(mcp.client, "okf_run_producer", { producer: "primary-db" });
  assert.equal(receipt.payload.applied, false);
  assert.equal(receipt.payload.policyViolations.length, 1);
  assert.deepEqual(fs.readdirSync(fixture.bundle), []);
});

// Follow-up gaps -----------------------------------------------------------

async function httpPost(url, route, body) {
  const response = await fetch(`${url}${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return response.json();
}

test("serve --root --authoring --policy applies the policy file to the HTTP routes", async (t) => {
  const parent = tempRoot(t, "okf-policy-serve-");
  const root = path.join(parent, "catalog");
  write(root, "index.md", ["---", 'okf_version: "0.2"', "---", "", "# Catalog", ""].join("\n"));
  const policyPath = path.join(parent, "policy.yaml");
  fs.writeFileSync(
    policyPath,
    [
      "rules:",
      "  - name: no-drafts",
      '    actors: ["*"]',
      '    paths: ["drafts/**"]',
      "    effect: deny",
      "",
    ].join("\n"),
  );
  const started = [];
  await main(
    ["--root", root, "--authoring", "--policy", policyPath, "--write-token", TOKEN, "serve"],
    {
      runHttpServer: async (options) => {
        const result = await runHttpServer(Object.assign({}, options, { port: 0 }));
        started.push(result);
        return result;
      },
    },
  );
  assert.equal(started.length, 1);
  t.after(() => new Promise((resolve) => started[0].server.close(resolve)));
  const { url } = started[0];
  const draft = { path: "drafts/one.md", frontmatter: { type: "Note", title: "Draft" } };
  const refused = await httpPost(url, "/v1/proposals", draft);
  assert.equal(refused.created, false);
  assert.deepEqual(
    refused.policyViolations.map(({ rule, reason, path: target }) => [rule, reason, target]),
    [["no-drafts", "path_denied", "drafts/one.md"]],
  );
  const allowed = await httpPost(url, "/v1/proposals", {
    path: "notes/one.md",
    frontmatter: { type: "Note", title: "One" },
  });
  assert.equal(allowed.created, true);
  assert.equal(Object.hasOwn(allowed.proposal, "proposedBy"), false);
  assert.equal(fs.existsSync(path.join(root, "drafts")), false);

  // --policy still needs --root, for serve as for mcp.
  await assert.rejects(
    main(["--project", "x.yaml", "--authoring", "--policy", policyPath, "serve"], {
      runHttpServer: async () => assert.fail("must not start"),
    }),
    /--policy requires --root/,
  );
});

test("a legacy proposal accepted without an actor is judged as the actor unknown", async (t) => {
  for (const policyLines of [
    ["rules:", "  - name: nobody-unattributed", '    actors: ["*"]', "    effect: deny"],
    ["defaultEffect: deny", "rules:", `  - actors: ["${REVIEWER}"]`],
  ]) {
    const fixture = makeCatalogProject(t, policyLines);
    const legacy = await storeProposal(fixture.projectPath, null, NEW_NOTE);
    assert.equal(Object.hasOwn(legacy, "proposedBy"), false);
    const service = new ConceptAuthoringService(FileConceptStore.fromProject(fixture.projectPath));
    assert.equal(service.actor, null);
    const refused = await service.acceptProposal({ proposalId: legacy.id });
    assert.equal(refused.accepted, false, policyLines.join(" "));
    assert.equal(refused.policyViolations[0].reason, "actor_denied");
    assert.equal(fs.existsSync(path.join(fixture.bundle, "new-note.md")), false);
  }
});

test("a v0.2 migration is judged before any of its proposals is stored", async (t) => {
  for (const [denied, expectedPath] of [
    ["index.md", "index.md"],
    ["metric.md", "metric.md"],
  ]) {
    const projectRoot = tempRoot(t, "okf-policy-migration-");
    const bundle = path.join(projectRoot, "bundle");
    write(bundle, "index.md", "# Legacy\n\n- [Metric](metric.md)\n");
    write(
      bundle,
      "metric.md",
      ["---", "type: Metric", "timestamp: 2026-05-28T22:53:05Z", "---", "", "# Metric", ""].join(
        "\n",
      ),
    );
    const store = new FileConceptStore({
      bundles: [{ id: "legacy", root: bundle }],
      relationTypes: [],
      proposalRoot: path.join(projectRoot, ".okf-proposals"),
    });
    const service = new ConceptAuthoringService(store, {
      actor: REVIEWER,
      writePolicy: { rules: [{ actors: ["**"], paths: [denied], effect: "deny" }] },
    });
    const result = await service.proposeV02Migration({
      bundle: "legacy",
      actorMappings: { "okf://legacy/metric": { by: "human:catalog-owner", confirmed: true } },
    });
    assert.equal(result.created, false);
    assert.deepEqual(
      result.policyViolations.map(({ rule, reason, path: target }) => [rule, reason, target]),
      [[0, "path_denied", expectedPath]],
    );
    assert.equal(result.errors[0].layer, "policy");
    assert.deepEqual(await store.listProposals({}), []);
    const migrations = path.join(store.proposalRoot, "migrations");
    assert.deepEqual(fs.existsSync(migrations) ? fs.readdirSync(migrations) : [], []);
  }
});

test("acceptance publishes the default status the policy judged a create with", async (t) => {
  const fixture = makeCatalogProject(t, [
    "defaultEffect: deny",
    "rules:",
    "  - name: reviewers",
    `    actors: ["${REVIEWER}"]`,
    '    requiredFields: ["status"]',
    "    defaultStatus: draft",
  ]);
  // Stored before the policy applied, without a status.
  const pending = await storeProposal(fixture.projectPath, REVIEWER, NEW_NOTE);
  assert.equal(Object.hasOwn(pending.frontmatter, "status"), false);
  const reviewer = await connectMcp(t, [], {
    projectPath: fixture.projectPath,
    allowAuthoring: true,
    actor: REVIEWER,
  });
  const accepted = await callJson(reviewer.client, "okf_accept_proposal", {
    proposalId: pending.id,
  });
  assert.equal(accepted.payload.accepted, true, JSON.stringify(accepted.payload));
  const published = fs.readFileSync(path.join(fixture.bundle, "new-note.md"), "utf8");
  assert.match(published, /\nstatus: draft\n/);
});

test("producers never get a virtual default status: a required status must be produced", async (t) => {
  const fixture = makeProducerProject(t, [
    "applyToProducers: true",
    "rules:",
    "  - name: database-producer",
    '    actors: ["process:primary-db"]',
    '    requiredFields: ["status"]',
    "    defaultStatus: draft",
  ]);
  const preview = await producerService(fixture).preview("primary-db");
  assert.equal(preview.readyToApply, false);
  assert.deepEqual(
    preview.policyViolations.map(({ rule, reason, field, path: target }) => [
      rule,
      reason,
      field,
      target,
    ]),
    [["database-producer", "missing_required_field", "status", "database.md"]],
  );
  const run = await producerService(fixture).run("primary-db");
  assert.equal(run.applied, false);
  assert.deepEqual(fs.readdirSync(fixture.bundle), []);
});
