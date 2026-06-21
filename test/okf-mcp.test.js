"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildIndex, buildProjectIndex, buildProjectIndexAsync } = require("../src/indexer");
const { main: cliMain, parseArgs } = require("../src/cli");
const { loadProjectConfig } = require("../src/project");
const { generateProject } = require("../src/plugins");
const { fetchGitHubBundle, parseGitHubBundleUrl } = require("../src/remote");
const { ConceptAuthoringService } = require("../src/authoring");
const { FileConceptStore } = require("../src/store");
const { createHttpHandler } = require("../src/http-server");
const { searchConcepts } = require("../src/search");
const { exportGraph, findPaths, getGraph, getNeighbors, getSubgraph, graphSummary } = require("../src/graph");
const { createServer, createServerAsync } = require("../src/mcp-server");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-"));
  fs.mkdirSync(path.join(root, "specs"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.md"), "# Fixture\n\n- [Alpha](/specs/alpha.md)\n", "utf8");
  fs.writeFileSync(path.join(root, "specs", "index.md"), "# Specs\n\n- [Alpha](alpha.md)\n- [Beta](beta.md)\n", "utf8");
  fs.writeFileSync(path.join(root, "specs", "alpha.md"), [
    "---",
    "type: Concept",
    "title: Alpha",
    "description: First concept",
    "tags:",
    "  - Spec",
    "  - Endpoint",
    "priority: 2",
    "---",
    "",
    "# Alpha",
    "",
    "Links to [Beta](beta.md).",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "specs", "beta.md"), [
    "---",
    "type: Concept",
    "title: Beta",
    "description: Second concept",
    "tags: [spec, report]",
    "active: true",
    "---",
    "",
    "# Beta",
    "",
    "Links to [Missing](missing.md).",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "specs", "bad.md"), [
    "---",
    "title: Bad",
    "---",
    "",
    "# Bad",
    "",
  ].join("\n"), "utf8");
  return root;
}

function makeGitHubFetchMock(files) {
  const byPath = new Map();
  files.forEach((file) => byPath.set(file.path, file.text));
  return async function mockFetch(url) {
    const textUrl = String(url);
    if (textUrl.startsWith("https://api.github.com/repos/acme/widgets/contents/")) {
      const parsed = new URL(textUrl);
      const apiPath = decodeURIComponent(parsed.pathname.split("/contents/")[1] || "");
      const children = files.filter((file) => path.posix.dirname(file.path) === apiPath);
      const dirs = Array.from(new Set(files
        .filter((file) => file.path.startsWith(`${apiPath}/`))
        .map((file) => file.path.slice(apiPath.length + 1).split("/")[0])
        .filter((part) => part && !children.some((file) => path.posix.basename(file.path) === part))));
      return {
        ok: true,
        json: async () => children.map((file) => ({
          type: "file",
          name: path.posix.basename(file.path),
          path: file.path,
          size: Buffer.byteLength(file.text),
          download_url: `https://raw.example/${file.path}`,
        })).concat(dirs.map((dir) => ({
          type: "dir",
          name: dir,
          path: `${apiPath}/${dir}`,
        }))),
      };
    }
    if (textUrl.startsWith("https://raw.example/")) {
      const filePath = textUrl.slice("https://raw.example/".length);
      return {
        ok: byPath.has(filePath),
        status: byPath.has(filePath) ? 200 : 404,
        statusText: byPath.has(filePath) ? "OK" : "Not Found",
        text: async () => byPath.get(filePath),
      };
    }
    return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
  };
}

test("indexes valid concepts, reserved files, warnings, and links", () => {
  const root = makeFixture();
  const index = buildIndex([`fixture=${root}`]);
  assert.equal(index.concepts.length, 2);
  assert.equal(index.reserved.length, 2);
  assert.equal(index.warnings.some((warning) => warning.code === "missing_type" && warning.path === "specs/bad.md"), true);
  assert.equal(index.warnings.some((warning) => warning.code === "broken_link"), true);
  assert.equal(index.edges.some((edge) => edge.source.endsWith("/specs/alpha.md") && edge.target.endsWith("/specs/beta.md") && !edge.broken), true);
});

test("structured search supports query, tags, type, path, frontmatter, and links", () => {
  const root = makeFixture();
  const index = buildIndex([`fixture=${root}`]);
  assert.equal(searchConcepts(index, { query: "Alpha" }).total, 1);
  assert.equal(searchConcepts(index, { tagsAny: ["endpoint"] }).total, 1);
  assert.equal(searchConcepts(index, { tagsAll: ["spec", "report"] }).total, 1);
  assert.equal(searchConcepts(index, { types: ["concept"], pathPrefix: "specs/" }).total, 2);
  assert.equal(searchConcepts(index, { frontmatter: { active: true } }).total, 1);
  const beta = "okf://fixture/specs/beta.md";
  const alpha = "okf://fixture/specs/alpha.md";
  assert.equal(searchConcepts(index, { linkedTo: beta }).results[0].uri, alpha);
  assert.equal(searchConcepts(index, { linkedFrom: alpha }).results[0].uri, beta);
});

test("graph tools expose graph, neighbors, subgraph, paths, summary, and exports", () => {
  const root = makeFixture();
  const index = buildIndex([`fixture=${root}`]);
  const graph = getGraph(index, {});
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  const alpha = "okf://fixture/specs/alpha.md";
  const beta = "okf://fixture/specs/beta.md";
  assert.equal(getNeighbors(index, alpha).outbound.length, 1);
  assert.equal(getSubgraph(index, { uri: alpha, depth: 1 }).nodes.length, 2);
  assert.deepEqual(findPaths(index, alpha, beta).paths, [[alpha, beta]]);
  assert.equal(graphSummary(index).concepts, 2);
  assert.match(exportGraph(index, { format: "dot" }), /digraph OKF/);
  assert.match(exportGraph(index, { format: "mermaid" }), /graph TD/);
});

test("duplicate bundle ids are reported instead of mutating stable URIs", () => {
  const a = makeFixture();
  const b = makeFixture();
  const index = buildIndex([`same=${a}`, `same=${b}`]);
  assert.equal(index.bundles.length, 2);
  assert.deepEqual(index.bundles.map((bundle) => bundle.id), ["same", "same"]);
  assert.equal(index.errors.some((error) => error.code === "duplicate_bundle_id"), true);
});

test("include and exclude filters control indexed Markdown files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-filter-"));
  fs.mkdirSync(path.join(root, "keep"), { recursive: true });
  fs.mkdirSync(path.join(root, "skip"), { recursive: true });
  fs.writeFileSync(path.join(root, "keep", "alpha.md"), [
    "---",
    "type: Concept",
    "title: Alpha",
    "---",
    "",
    "# Alpha",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "skip", "beta.md"), [
    "---",
    "type: Concept",
    "title: Beta",
    "---",
    "",
    "# Beta",
    "",
  ].join("\n"), "utf8");
  const index = buildIndex([{ id: "fixture", root, include: ["keep/**"], exclude: ["skip/**"] }]);
  assert.equal(index.concepts.length, 1);
  assert.equal(index.concepts[0].path, "keep/alpha.md");
});

test("frontmatter can close at EOF and invalid stable ids warn", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-frontmatter-"));
  fs.writeFileSync(path.join(root, "alpha.md"), [
    "---",
    "id: alpha",
    "type: Concept",
    "title: Alpha",
    "---",
  ].join("\n"), "utf8");
  const index = buildIndex([`fixture=${root}`]);
  assert.equal(index.errors.length, 0);
  assert.equal(index.concepts.length, 1);
  assert.equal(index.warnings.some((warning) => warning.code === "invalid_id" && warning.bundle === "fixture"), true);
});

test("path traversal links are warned and not converted to readable edges", () => {
  const root = makeFixture();
  fs.writeFileSync(path.join(root, "specs", "alpha.md"), [
    "---",
    "type: Concept",
    "title: Alpha",
    "---",
    "",
    "[Outside](../../outside.md)",
    "",
  ].join("\n"), "utf8");
  const index = buildIndex([`fixture=${root}`]);
  assert.equal(index.warnings.some((warning) => warning.code === "link_outside_root"), true);
  assert.equal(index.edges.some((edge) => edge.href === "../../outside.md"), false);
});

test("project config loads multiple bundles and validates typed cross-bundle relations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-project-"));
  const app = path.join(root, "okf", "bundles", "app");
  const tables = path.join(root, "okf", "bundles", "tables");
  fs.mkdirSync(path.join(app, "services"), { recursive: true });
  fs.mkdirSync(path.join(tables, "tables"), { recursive: true });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: Fixture",
    "bundles:",
    "  - id: app",
    "    root: okf/bundles/app",
    "  - id: tables",
    "    root: okf/bundles/tables",
    "relationTypes:",
    "  - verifies",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(app, "services", "alpha.md"), [
    "---",
    "id: okf://app/services/alpha",
    "type: Service",
    "title: Alpha",
    "description: Alpha service",
    "aliases: [alpha-service]",
    "relations:",
    "  - type: persists_to",
    "    target: okf://tables/tables/raw_alpha",
    "  - type: configured_by",
    "    target: repo://specs/alpha.json",
    "---",
    "",
    "# Alpha",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(tables, "tables", "raw_alpha.md"), [
    "---",
    "id: okf://tables/tables/raw_alpha",
    "type: Table",
    "title: raw_alpha",
    "description: Raw alpha table",
    "---",
    "",
    "# raw_alpha",
    "",
  ].join("\n"), "utf8");

  const index = buildProjectIndex(path.join(root, "okf.project.yaml"));
  assert.equal(index.project.name, "Fixture");
  assert.equal(index.errors.length, 0);
  assert.equal(index.bundles.length, 2);
  assert.equal(index.edges.some((edge) => edge.kind === "relation" && edge.relationType === "persists_to" && edge.target === "okf://tables/tables/raw_alpha"), true);
  assert.equal(index.externalReferences.length, 1);
  assert.equal(searchConcepts(index, { query: "alpha-service" }).total, 1);
  assert.deepEqual(findPaths(index, "okf://app/services/alpha", "okf://tables/tables/raw_alpha").paths, [["okf://app/services/alpha", "okf://tables/tables/raw_alpha"]]);
  assert.equal(getGraph(index, { includeExternal: true }).nodes.some((node) => node.id === "repo://specs/alpha.json"), true);
});

test("project validation reports broken and invalid typed relations as errors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-project-bad-"));
  const bundle = path.join(root, "okf", "bundle");
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: BadFixture",
    "bundles:",
    "  - id: bad",
    "    root: okf/bundle",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(bundle, "alpha.md"), [
    "---",
    "type: Spec",
    "title: Alpha",
    "relations:",
    "  - type: impossible",
    "    target: okf://bad/missing.md",
    "---",
    "",
    "# Alpha",
    "",
  ].join("\n"), "utf8");
  const index = buildProjectIndex(path.join(root, "okf.project.yaml"));
  assert.equal(index.errors.some((error) => error.code === "invalid_relation_type"), true);
  assert.equal(index.errors.some((error) => error.code === "broken_relation"), true);
});

test("project validation reports config and plugin boundary errors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-project-config-bad-"));
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: BadConfig",
    "bundles:",
    "  - id: app",
    "    root: ../outside",
    "  - id: app",
    "    root: okf/app",
    "plugins:",
    "  - name: escaped",
    "    type: filesystem",
    "    root: docs",
    "    output: ../generated",
    "    bundle: missing",
    "",
  ].join("\n"), "utf8");
  const index = buildProjectIndex(path.join(root, "okf.project.yaml"));
  assert.equal(index.errors.some((error) => error.code === "project_path_outside_root"), true);
  assert.equal(index.errors.some((error) => error.code === "duplicate_bundle_id"), true);
  assert.equal(index.errors.some((error) => error.code === "unknown_plugin_bundle"), true);
});

test("GitHub remote bundle URLs are parsed with safe tree paths", () => {
  assert.deepEqual(
    parseGitHubBundleUrl("https://github.com/acme/widgets/tree/main/okf/bundles/docs"),
    {
      owner: "acme",
      repo: "widgets",
      ref: "main",
      path: "okf/bundles/docs",
      url: "https://github.com/acme/widgets/tree/main/okf/bundles/docs",
    },
  );
  assert.throws(() => parseGitHubBundleUrl("https://example.com/acme/widgets/tree/main/okf"), /github.com/);
  assert.throws(() => parseGitHubBundleUrl("https://github.com/acme/widgets/blob/main/okf"), /tree URL/);
  assert.throws(() => parseGitHubBundleUrl("https://github.com/acme/widgets/tree/main/../secrets"), /tree URL|safe bundle path/);
});

test("GitHub remote bundles load Markdown concepts without local checkout", async () => {
  const fetch = makeGitHubFetchMock([
    {
      path: "okf/bundles/docs/index.md",
      text: "# Remote Docs\n\n- [Alpha](concepts/alpha.md)\n",
    },
    {
      path: "okf/bundles/docs/concepts/alpha.md",
      text: [
        "---",
        "type: Concept",
        "title: Remote Alpha",
        "tags: [remote]",
        "---",
        "",
        "# Remote Alpha",
        "",
        "[Beta](beta.md)",
        "",
      ].join("\n"),
    },
    {
      path: "okf/bundles/docs/concepts/beta.md",
      text: [
        "---",
        "type: Concept",
        "title: Remote Beta",
        "---",
        "",
        "# Remote Beta",
        "",
      ].join("\n"),
    },
    {
      path: "okf/bundles/docs/data.json",
      text: "{}",
    },
  ]);
  const bundle = await fetchGitHubBundle(
    { id: "docs", url: "https://github.com/acme/widgets/tree/main/okf/bundles/docs" },
    { fetch },
  );
  assert.equal(bundle.remote, true);
  assert.equal(bundle.remoteSource.fileCount, 3);
  assert.deepEqual(bundle.documents.map((doc) => doc.path).sort(), ["concepts/alpha.md", "concepts/beta.md", "index.md"]);

  const index = buildIndex([bundle]);
  assert.equal(index.errors.length, 0);
  assert.equal(index.concepts.length, 2);
  assert.equal(searchConcepts(index, { tagsAny: ["remote"] }).results[0].uri, "okf://docs/concepts/alpha.md");
  assert.equal(index.edges.some((edge) => edge.source === "okf://docs/concepts/alpha.md" && edge.target === "okf://docs/concepts/beta.md"), true);
});

test("project configs can include remote bundles", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-project-remote-"));
  const local = path.join(root, "okf", "local");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: RemoteProject",
    "bundles:",
    "  - id: local",
    "    root: okf/local",
    "remoteBundles:",
    "  - id: docs",
    "    url: https://github.com/acme/widgets/tree/main/okf/bundles/docs",
    "    include: [remote.md]",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(local, "local.md"), [
    "---",
    "type: Concept",
    "title: Local Concept",
    "---",
    "",
    "# Local Concept",
    "",
  ].join("\n"), "utf8");

  const index = await buildProjectIndexAsync(path.join(root, "okf.project.yaml"), {
    fetch: makeGitHubFetchMock([
      {
        path: "okf/bundles/docs/remote.md",
        text: [
          "---",
          "type: Concept",
          "title: Remote Concept",
          "---",
          "",
          "# Remote Concept",
          "",
        ].join("\n"),
      },
      {
        path: "okf/bundles/docs/ignored.md",
        text: [
          "---",
          "type: Concept",
          "title: Ignored Concept",
          "---",
          "",
          "# Ignored Concept",
          "",
        ].join("\n"),
      },
    ]),
  });
  assert.equal(index.project.name, "RemoteProject");
  assert.equal(index.errors.length, 0);
  assert.equal(index.bundles.some((bundle) => bundle.id === "docs" && bundle.remote), true);
  assert.equal(index.byUri.has("okf://docs/remote.md"), true);
  assert.equal(index.byUri.has("okf://docs/ignored.md"), false);
});

test("MCP can load and list remote bundles at runtime", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = makeGitHubFetchMock([
    {
      path: "okf/bundles/docs/remote.md",
      text: [
        "---",
        "type: Concept",
        "title: Runtime Remote",
        "---",
        "",
        "# Runtime Remote",
        "",
      ].join("\n"),
    },
  ]);
  try {
    const server = createServer([]);
    const loaded = await server.handle({
      method: "tools/call",
      params: {
        name: "load_remote_bundle",
        arguments: {
          id: "runtime",
          url: "https://github.com/acme/widgets/tree/main/okf/bundles/docs",
        },
      },
    });
    assert.match(loaded.content[0].text, /"fileCount": 1/);
    const bundles = await server.handle({ method: "tools/call", params: { name: "list_bundles", arguments: {} } });
    assert.match(bundles.content[0].text, /"remote": true/);
    const remotes = await server.handle({ method: "tools/call", params: { name: "list_remote_bundles", arguments: {} } });
    assert.match(remotes.content[0].text, /github/);
    const concept = await server.handle({ method: "tools/call", params: { name: "get_concept", arguments: { uri: "okf://runtime/remote.md" } } });
    assert.match(concept.content[0].text, /Runtime Remote/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("MCP project mode can preload configured remote bundles", async () => {
  const previousFetch = globalThis.fetch;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-project-remote-"));
  const local = path.join(root, "okf", "local");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: McpRemote",
    "bundles:",
    "  - id: local",
    "    root: okf/local",
    "remoteBundles:",
    "  - id: docs",
    "    url: https://github.com/acme/widgets/tree/main/okf/bundles/docs",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(local, "local.md"), [
    "---",
    "type: Concept",
    "title: Local",
    "---",
    "",
    "# Local",
    "",
  ].join("\n"), "utf8");
  globalThis.fetch = makeGitHubFetchMock([
    {
      path: "okf/bundles/docs/remote.md",
      text: [
        "---",
        "type: Concept",
        "title: Preloaded Remote",
        "---",
        "",
        "# Preloaded Remote",
        "",
      ].join("\n"),
    },
  ]);
  try {
    const server = await createServerAsync([], { projectPath: path.join(root, "okf.project.yaml") });
    assert.equal(server.index.byUri.has("okf://docs/remote.md"), true);
    const remoteBundles = await server.handle({ method: "tools/call", params: { name: "list_remote_bundles", arguments: {} } });
    assert.match(remoteBundles.content[0].text, /Preloaded|github/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

function makeAuthoringProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-authoring-"));
  const bundle = path.join(root, "okf", "bundle");
  const proposals = path.join(root, ".okf-proposals");
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: Authoring",
    "bundles:",
    "  - id: app",
    "    root: okf/bundle",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(bundle, "existing.md"), [
    "---",
    "id: okf://app/existing",
    "type: Concept",
    "title: Existing",
    "---",
    "",
    "# Existing",
    "",
  ].join("\n"), "utf8");
  const store = FileConceptStore.fromProject(path.join(root, "okf.project.yaml"), { proposalRoot: proposals });
  const service = new ConceptAuthoringService(store);
  return { root, bundle, proposals, store, service };
}

test("authoring validates OKF concepts and suggests safe nested paths", () => {
  const { service } = makeAuthoringProject();
  assert.equal(
    service.suggestConceptPath({ bundle: "app", type: "MCP Tool", title: "Create Order", prefix: "tools" }).path,
    "tools/mcp-tool/create-order.md",
  );
  const valid = service.validateConcept({
    bundle: "app",
    path: "tools/create-order.md",
    frontmatter: {
      id: "okf://app/tools/create-order",
      type: "MCP Tool",
      title: "Create Order",
      tags: ["tool", "orders"],
      relations: [{ type: "related_to", target: "okf://app/existing" }],
    },
    body: "# Create Order\n",
  });
  assert.equal(valid.valid, true);
  assert.match(valid.markdown, /relations:\n  - type: related_to\n    target: "okf:\/\/app\/existing"/);
  assert.equal(valid.concept.uri, "okf://app/tools/create-order");
});

test("authoring rejects unsafe paths, duplicate ids, and invalid relations", () => {
  const { service } = makeAuthoringProject();
  assert.throws(
    () => service.validateConcept({ bundle: "app", path: "../outside.md", frontmatter: { type: "Concept", title: "Bad" }, body: "# Bad" }),
    /inside the bundle|safe relative/,
  );
  const duplicate = service.validateConcept({
    bundle: "app",
    path: "new.md",
    frontmatter: { id: "okf://app/existing", type: "Concept", title: "Duplicate" },
    body: "# Duplicate",
  });
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.errors.some((error) => error.code === "duplicate_uri"), true);
  const badRelation = service.validateConcept({
    bundle: "app",
    path: "bad-relation.md",
    frontmatter: { type: "Concept", title: "Bad", relations: [{ type: "impossible", target: "okf://app/missing" }] },
    body: "# Bad",
  });
  assert.equal(badRelation.valid, false);
  assert.equal(badRelation.errors.some((error) => error.code === "invalid_relation_type"), true);
  assert.equal(badRelation.errors.some((error) => error.code === "broken_relation"), true);
});

test("authoring proposals are accepted into new subdirectories", async () => {
  const { bundle, service } = makeAuthoringProject();
  const proposed = await service.proposeConcept({
    bundle: "app",
    path: "tools/create-order.md",
    frontmatter: { type: "MCP Tool", title: "Create Order" },
    body: "# Create Order",
    message: "Add tool concept",
  });
  assert.equal(proposed.created, true);
  assert.equal(fs.existsSync(path.join(bundle, "tools", "create-order.md")), false);
  const accepted = await service.acceptProposal({ proposalId: proposed.proposal.id });
  assert.equal(accepted.accepted, true);
  assert.equal(fs.existsSync(path.join(bundle, "tools", "create-order.md")), true);
  assert.equal(service.store.getIndex().byUri.has("okf://app/tools/create-order.md"), true);
});

test("MCP authoring tools create and accept concept proposals in project mode", async () => {
  const { root, bundle, proposals } = makeAuthoringProject();
  const server = await createServerAsync([], {
    projectPath: path.join(root, "okf.project.yaml"),
    proposalRoot: proposals,
  });
  const tools = await server.handle({ method: "tools/list" });
  assert.equal(tools.tools.some((tool) => tool.name === "okf_propose_concept"), true);
  const proposed = await server.handle({
    method: "tools/call",
    params: {
      name: "okf_propose_concept",
      arguments: {
        bundle: "app",
        path: "mcp/runtime-tool.md",
        frontmatter: { type: "MCP Tool", title: "Runtime Tool" },
        body: "# Runtime Tool",
      },
    },
  });
  const proposal = JSON.parse(proposed.content[0].text).proposal;
  const accepted = await server.handle({
    method: "tools/call",
    params: { name: "okf_accept_proposal", arguments: { proposalId: proposal.id } },
  });
  assert.equal(JSON.parse(accepted.content[0].text).accepted, true);
  assert.equal(fs.existsSync(path.join(bundle, "mcp", "runtime-tool.md")), true);
  const concept = await server.handle({
    method: "tools/call",
    params: { name: "get_concept", arguments: { uri: "okf://app/mcp/runtime-tool.md" } },
  });
  assert.match(concept.content[0].text, /Runtime Tool/);
});

async function callHttp(handler, options) {
  const bodyText = options.body === undefined ? "" : JSON.stringify(options.body);
  const req = Readable.from(bodyText ? [Buffer.from(bodyText)] : []);
  req.method = options.method || "GET";
  req.url = options.url || "/";
  req.headers = Object.assign({}, options.headers || {});
  const response = { status: 0, headers: {}, text: "" };
  const res = {
    writeHead(status, headers) {
      response.status = status;
      response.headers = headers || {};
    },
    end(text) {
      response.text = String(text || "");
    },
  };
  await handler(req, res);
  response.json = response.text ? JSON.parse(response.text) : null;
  return response;
}

test("HTTP authoring API protects proposal mutations with bearer auth", async () => {
  const { root, bundle, proposals } = makeAuthoringProject();
  const store = FileConceptStore.fromProject(path.join(root, "okf.project.yaml"), { proposalRoot: proposals });
  const service = new ConceptAuthoringService(store);
  const handler = createHttpHandler(service, { writeToken: "test-token" });

  const validate = await callHttp(handler, {
    method: "POST",
    url: "/v1/concepts/validate",
    headers: { "content-type": "application/json" },
    body: {
      bundle: "app",
      path: "http/tool.md",
      frontmatter: { type: "MCP Tool", title: "HTTP Tool" },
      body: "# HTTP Tool",
    },
  });
  assert.equal(validate.status, 200);
  assert.equal(validate.json.valid, true);

  const unauthorized = await callHttp(handler, {
    method: "POST",
    url: "/v1/proposals",
    headers: { "content-type": "application/json" },
    body: {
      bundle: "app",
      path: "http/tool.md",
      frontmatter: { type: "MCP Tool", title: "HTTP Tool" },
      body: "# HTTP Tool",
    },
  });
  assert.equal(unauthorized.status, 401);

  const proposed = await callHttp(handler, {
    method: "POST",
    url: "/v1/proposals",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: {
      bundle: "app",
      path: "http/tool.md",
      frontmatter: { type: "MCP Tool", title: "HTTP Tool" },
      body: "# HTTP Tool",
    },
  });
  assert.equal(proposed.status, 200);
  const accepted = await callHttp(handler, {
    method: "POST",
    url: `/v1/proposals/${proposed.json.proposal.id}/accept`,
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.accepted, true);
  assert.equal(fs.existsSync(path.join(bundle, "http", "tool.md")), true);
});

test("generator plugins write project concepts into configured outputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-generate-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\n", "utf8");
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: Generated",
    "bundles:",
    "  - id: generated",
    "    root: okf/bundles/generated",
    "plugins:",
    "  - name: docs",
    "    type: filesystem",
    "    root: docs",
    "    output: okf/bundles/generated/generated/docs",
    "    bundle: generated",
    "",
  ].join("\n"), "utf8");
  const project = loadProjectConfig(path.join(root, "okf.project.yaml"));
  const results = generateProject(project);
  assert.equal(results[0].files, 1);
  assert.equal(fs.existsSync(path.join(root, "okf", "bundles", "generated", "generated", "docs", "docs-guide.md")), true);
});

test("generator plugins reject output paths outside the project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-generate-bad-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\n", "utf8");
  const project = {
    root,
    plugins: [
      {
        name: "bad",
        type: "filesystem",
        root: "docs",
        output: "../outside",
        bundle: "generated",
      },
    ],
  };
  assert.throws(() => generateProject(project), /outside the project root/);
});

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = function write(chunk) {
    output += String(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}

test("CLI subcommands support project validation and search", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-cli-"));
  const bundle = path.join(root, "okf", "bundle");
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: CliFixture",
    "bundles:",
    "  - id: cli",
    "    root: okf/bundle",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(bundle, "alpha.md"), [
    "---",
    "type: Spec",
    "title: Alpha",
    "description: CLI alpha",
    "---",
    "",
    "# Alpha",
    "",
  ].join("\n"), "utf8");
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  const validate = await captureStdout(() => cliMain(["--project", path.join(root, "okf.project.yaml"), "validate"]));
  assert.equal(process.exitCode, 0);
  assert.match(validate, /"valid": true/);
  const search = await captureStdout(() => cliMain(["--project", path.join(root, "okf.project.yaml"), "search", "Alpha"]));
  assert.match(search, /Alpha/);
  process.exitCode = previousExitCode;
});

test("CLI rejects dangling option flags", () => {
  assert.throws(() => parseArgs(["--bundle"]), /requires a value/);
  assert.throws(() => parseArgs(["--project"]), /requires a value/);
  assert.throws(() => parseArgs(["--host"]), /requires a value/);
  assert.equal(parseArgs(["--project", "okf.project.yaml", "serve", "--host", "0.0.0.0", "--port", "9000"]).host, "0.0.0.0");
  assert.equal(parseArgs(["--project", "okf.project.yaml", "serve", "--host", "0.0.0.0", "--port", "9000"]).port, 9000);
});

test("MCP resources and tools operate over the in-memory index", async () => {
  const root = makeFixture();
  const server = createServer([`fixture=${root}`]);
  const initialized = await server.handle({ method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(initialized.serverInfo.name, "okf-mcp");
  const resources = await server.handle({ method: "resources/list" });
  assert.equal(resources.resources.length, 5);
  const read = await server.handle({ method: "resources/read", params: { uri: "okf://fixture/specs/alpha.md" } });
  assert.match(read.contents[0].text, /# Alpha/);
  const tools = await server.handle({ method: "tools/list" });
  assert.equal(tools.tools.some((tool) => tool.name === "search_concepts"), true);
  const search = await server.handle({ method: "tools/call", params: { name: "search_concepts", arguments: { tagsAny: ["endpoint"] } } });
  assert.match(search.content[0].text, /Alpha/);
});

test("MCP validation and required argument errors are surfaced", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-invalid-"));
  fs.writeFileSync(path.join(root, "bad.md"), "# Bad\n", "utf8");
  const server = createServer([`fixture=${root}`]);
  const validation = await server.handle({ method: "tools/call", params: { name: "validate_bundle", arguments: { bundle: "fixture" } } });
  assert.match(validation.content[0].text, /missing_frontmatter/);
  assert.match(validation.content[0].text, /"valid": false/);
  await assert.rejects(
    () => server.handle({ method: "tools/call", params: { name: "find_paths", arguments: {} } }),
    /source and target/,
  );
});

test("bundle mode indexes a neutral multi-directory concept graph", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-neutral-"));
  fs.mkdirSync(path.join(root, "services"), { recursive: true });
  fs.mkdirSync(path.join(root, "tables"), { recursive: true });
  fs.writeFileSync(path.join(root, "services", "alpha.md"), [
    "---",
    "type: Service",
    "title: Alpha Service",
    "description: Example service.",
    "tags: [service]",
    "---",
    "",
    "# Alpha Service",
    "",
    "- [Raw Alpha](../tables/raw_alpha.md)",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "tables", "raw_alpha.md"), [
    "---",
    "type: Table",
    "title: raw_alpha",
    "description: Example raw table.",
    "tags: [table]",
    "---",
    "",
    "# raw_alpha",
    "",
  ].join("\n"), "utf8");
  const index = buildIndex([`neutral=${root}`]);
  assert.equal(index.errors.length, 0);
  assert.equal(index.warnings.length, 0);
  assert.equal(index.concepts.filter((doc) => doc.type === "Service").length, 1);
  assert.equal(index.concepts.some((doc) => doc.path === "tables/raw_alpha.md"), true);
  assert.equal(
    index.edges.some((edge) => (
      edge.source === "okf://neutral/services/alpha.md" &&
      edge.target === "okf://neutral/tables/raw_alpha.md"
    )),
    true,
  );
});
