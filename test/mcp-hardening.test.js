"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { callJson, connectMcp } = require("./mcp-client");

function makeBundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-hardening-"));
  fs.writeFileSync(path.join(root, "concept.md"), [
    "---",
    "type: Concept",
    "title: Concept",
    "---",
    "",
    "# Concept",
    "",
  ].join("\n"), "utf8");
  return root;
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-mcp-hardening-project-"));
  const bundle = path.join(root, "bundle");
  fs.mkdirSync(bundle);
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: Hardening",
    "bundles:",
    "  - id: local",
    "    root: bundle",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(bundle, "concept.md"), [
    "---",
    "type: Concept",
    "title: Concept",
    "---",
    "",
    "# Concept",
    "",
  ].join("\n"), "utf8");
  return { root, bundle, projectPath: path.join(root, "okf.project.yaml") };
}

function toolNames(listed) {
  return new Set(listed.tools.map((tool) => tool.name));
}

function installRemoteFetch(t) {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    const commitMatch = textUrl.match(/^https:\/\/api\.github\.com\/repos\/acme\/([^/]+)\/commits\//);
    if (commitMatch) {
      return { ok: true, async json() { return { sha: "a".repeat(40) }; } };
    }
    const apiMatch = textUrl.match(/^https:\/\/api\.github\.com\/repos\/acme\/([^/]+)\/contents\/([^?]+)\?ref=[^&]+$/);
    if (apiMatch) {
      const repo = apiMatch[1];
      const rootPath = decodeURIComponent(apiMatch[2]);
      const fileName = `${repo}.md`;
      return {
        ok: true,
        async json() {
          return [{
            type: "file",
            name: fileName,
            path: `${rootPath}/${fileName}`,
            size: 100,
            download_url: `https://raw.example/${repo}`,
          }];
        },
      };
    }
    const rawMatch = textUrl.match(/^https:\/\/raw\.example\/([^/]+)$/);
    if (rawMatch) {
      const repo = rawMatch[1];
      return {
        ok: true,
        async text() {
          return [
            "---",
            "type: Concept",
            `title: ${repo}`,
            "---",
            "",
            `# ${repo}`,
            "",
          ].join("\n");
        },
      };
    }
    return { ok: false, status: 404, statusText: "Not Found" };
  };
}

test("tools/list and tools/call enforce configured MCP capabilities", async (t) => {
  const bundle = makeBundle();
  const readOnly = await connectMcp(t, [`local=${bundle}`]);
  const readOnlyNames = toolNames(await readOnly.client.listTools());
  assert.equal(readOnlyNames.has("search_concepts"), true);
  assert.equal(readOnlyNames.has("okf_validate_concept"), false);
  assert.equal(readOnlyNames.has("okf_propose_concept"), false);
  assert.equal(readOnlyNames.has("load_remote_bundle"), false);
  await assert.rejects(
    () => readOnly.client.callTool({
      name: "load_remote_bundle",
      arguments: {
        id: "blocked",
        url: "https://github.com/acme/blocked/tree/main/okf",
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /not found/);
      return true;
    },
  );

  const { projectPath } = makeProject();
  const project = await connectMcp(t, [], { projectPath });
  const projectNames = toolNames(await project.client.listTools());
  assert.equal(projectNames.has("okf_validate_concept"), true);
  assert.equal(projectNames.has("okf_get_proposal"), true);
  assert.equal(projectNames.has("okf_propose_concept"), false);
  assert.equal(projectNames.has("okf_accept_proposal"), false);
  await assert.rejects(
    () => project.client.callTool({
      name: "okf_propose_concept",
      arguments: {
        bundle: "local",
        path: "blocked.md",
        frontmatter: { type: "Concept", title: "Blocked" },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /not found/);
      return true;
    },
  );

  const enabled = await connectMcp(t, [], {
    projectPath,
    allowAuthoring: true,
    allowRuntimeRemoteLoad: true,
  });
  const enabledNames = toolNames(await enabled.client.listTools());
  assert.equal(enabledNames.has("okf_propose_concept"), true);
  assert.equal(enabledNames.has("okf_accept_proposal"), true);
  assert.equal(enabledNames.has("load_remote_bundle"), true);
});

test("accepted local proposals retain configured and runtime remote bundles and edges", async (t) => {
  installRemoteFetch(t);
  const { root, bundle, projectPath } = makeProject();
  fs.writeFileSync(projectPath, [
    "project: Hardening",
    "bundles:",
    "  - id: local",
    "    root: bundle",
    "remoteBundles:",
    "  - id: configured",
    "    provider: github",
    "    url: https://github.com/acme/configured/tree/main/okf",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(bundle, "source.md"), [
    "---",
    "type: Concept",
    "title: Source",
    "relations:",
    "  - type: related_to",
    "    target: okf://configured/configured.md",
    "---",
    "",
    "# Source",
    "",
  ].join("\n"), "utf8");

  const { client } = await connectMcp(t, [], {
    projectPath,
    proposalRoot: path.join(root, "proposals"),
    allowAuthoring: true,
    allowRuntimeRemoteLoad: true,
  });
  await callJson(client, "load_remote_bundle", {
    id: "runtime",
    url: "https://github.com/acme/runtime/tree/main/okf",
  });
  for (const uri of ["okf://configured/configured.md", "okf://runtime/runtime.md"]) {
    const concept = await callJson(client, "get_concept", { uri });
    assert.equal(concept.result.isError, undefined);
  }

  const proposed = await callJson(client, "okf_propose_concept", {
    bundle: "local",
    path: "accepted.md",
    frontmatter: { type: "Concept", title: "Accepted" },
  });
  const proposalId = proposed.payload.proposal.id;
  await callJson(client, "okf_accept_proposal", { proposalId });

  for (const uri of [
    "okf://configured/configured.md",
    "okf://runtime/runtime.md",
    "okf://local/accepted.md",
  ]) {
    const concept = await callJson(client, "get_concept", { uri });
    assert.equal(concept.result.isError, undefined);
  }
  const graph = await callJson(client, "get_graph", {});
  assert.equal(graph.payload.edges.some((edge) => (
    edge.source === "okf://local/source"
    && edge.target === "okf://configured/configured"
    && edge.relationType === "related_to"
    && !edge.broken
  )), true);
});

test("SDK project servers rebuild from their configured local registry", async (t) => {
  installRemoteFetch(t);
  const { projectPath } = makeProject();
  const { client } = await connectMcp(t, [], {
    projectPath,
    allowRuntimeRemoteLoad: true,
  });

  await callJson(client, "load_remote_bundle", {
    id: "runtime",
    url: "https://github.com/acme/runtime/tree/main/okf",
  });

  const bundles = await callJson(client, "list_bundles", {});
  assert.deepEqual(new Set(bundles.payload.map((bundle) => bundle.id)), new Set(["local", "runtime"]));
  for (const uri of ["okf://local/concept.md", "okf://runtime/runtime.md"]) {
    const concept = await callJson(client, "get_concept", { uri });
    assert.equal(concept.result.isError, undefined);
  }
});
