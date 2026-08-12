"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ConceptAuthoringService } = require("../src/authoring");
const {
  checkComputationReceipt,
  getProvenance,
  inspectAttestedComputation,
  prepareAttestedComputation,
  readBundleAsset,
} = require("../src/computation");
const { buildIndex } = require("../src/indexer");
const { fetchGitHubBundle } = require("../src/remote");
const { searchConcepts } = require("../src/search");
const { FileConceptStore } = require("../src/store");
const { connectMcp } = require("./mcp-client");

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-v02-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function markdown(frontmatter, body) {
  return ["---", ...frontmatter, "---", "", body, ""].join("\n");
}

function gitBlobSha(value) {
  const content = Buffer.from(value);
  return crypto.createHash("sha1")
    .update(Buffer.from(`blob ${content.length}\0`))
    .update(content)
    .digest("hex");
}

function computationFixture(t) {
  const root = tempRoot(t);
  write(root, "index.md", [
    "---",
    "okf_version: \"0.2\"",
    "---",
    "",
    "# Finance",
    "",
    "- [Revenue](computations/revenue.md)",
    "- [Policy](policies/revenue.md)",
    "- [Runner](references/run.md)",
    "",
  ].join("\n"));
  write(root, "policies/revenue.md", markdown([
    "type: Policy",
    "title: Revenue Policy",
  ], "# Revenue Policy"));
  write(root, "references/run.md", markdown([
    "type: Execution Skill",
    "title: Run SQLite",
  ], "# Run SQLite"));
  write(root, "artifacts/revenue.sql", "SELECT SUM(amount) AS revenue FROM revenue WHERE year = :year;\n");
  write(root, "artifacts/attest.py", "def attest(receipt): return receipt.get('result') is not None\n");
  write(root, "artifacts/ignored.py", "raise RuntimeError('must never be loaded')\n");
  write(root, "computations/revenue.md", markdown([
    "type: Attested Computation",
    "title: Attested Revenue",
    "runtime: sqlite",
    "parameters:",
    "  - name: year",
    "    type: integer",
    "    required: true",
    "computation: ../artifacts/revenue.sql",
    "executor:",
    "  resource: ../references/run.md",
    "  receipt: [job_id, result]",
    "attester:",
    "  resource: ../artifacts/attest.py",
    "sources:",
    "  - id: policy",
    "    resource: ../policies/revenue.md",
    "verified:",
    "  by: process:nightly",
    "  at: 2026-08-10T02:00:00Z",
    "status: stable",
    "stale_after: 2026-08-20",
  ], "# Attested Revenue"));
  return root;
}

test("v0.2 indexing exposes canonical aliases, semantic edges, inert assets, signals, and static computation tools", (t) => {
  const root = computationFixture(t);
  const index = buildIndex([{ id: "finance", root }], { asOf: "2026-08-11" });
  assert.equal(index.conformant, true);
  assert.equal(index.validForProject, true);
  assert.equal(index.bundles[0].okfVersion, "0.2");

  const canonical = "okf://finance/computations/revenue";
  assert.equal(index.byUri.get(`${canonical}.md`).uri, canonical);
  const computation = index.byUri.get(canonical);
  assert.equal(computation.conceptId, "computations/revenue");
  assert.equal(computation.signals.trustTier, "machine-confirmed");
  assert.equal(computation.signals.freshness, "fresh");
  assert.equal(computation.signals.computation.attestationReady, true);

  assert.deepEqual(index.assets.map((asset) => asset.path), [
    "artifacts/attest.py",
    "artifacts/revenue.sql",
  ]);
  assert.equal(index.assets.some((asset) => asset.path.includes("ignored")), false);
  assert.equal(index.edges.some((edge) => edge.source === canonical && edge.kind === "source" && edge.target === "okf://finance/policies/revenue"), true);
  assert.equal(index.edges.some((edge) => edge.source === canonical && edge.kind === "executor" && edge.target === "okf://finance/references/run"), true);
  assert.equal(index.edges.some((edge) => edge.source === canonical && edge.kind === "computation" && edge.resolvedAs === "asset"), true);

  const results = searchConcepts(index, {
    statuses: ["stable"],
    trustTiers: ["machine-confirmed"],
    freshness: ["fresh"],
    runtime: "sqlite",
    attestationReady: true,
    hasSources: true,
    asOf: "2026-08-11",
  });
  assert.equal(results.total, 1);
  assert.equal(results.results[0].uri, canonical);

  const inspection = inspectAttestedComputation(index, `${canonical}.md`);
  assert.equal(inspection.uri, canonical);
  assert.equal(inspection.readiness.attestationReady, true);
  assert.equal(inspection.computation.contentIncluded, false);
  assert.match(inspection.computation.sha256, /^sha256:/);
  assert.equal(inspection.capabilities.execution, "not_supported");

  const prepared = prepareAttestedComputation(index, canonical, { year: 2026 });
  assert.equal(prepared.prepared, true);
  assert.deepEqual(prepared.parameterNames, ["year"]);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, "parameters"), false, "parameter values must not be returned");
  const receipt = checkComputationReceipt(index, canonical, { job_id: "secret-job", result: { value: 3 } });
  assert.equal(receipt.shapeComplete, true);
  assert.equal(JSON.stringify(receipt).includes("secret-job"), false, "receipt values must not be returned");

  const asset = index.assets.find((entry) => entry.path.endsWith("revenue.sql"));
  const read = readBundleAsset(index, { uri: asset.uri });
  assert.equal(read.contentEncoding, "utf-8");
  assert.match(read.content, /SELECT SUM/);
  const provenance = getProvenance(index, canonical);
  assert.equal(provenance.nodes.some((node) => node.id === "okf://finance/policies/revenue"), true);
  assert.equal(provenance.externalFetched, false);
});

test("broken Markdown links are advisory by default and opt-in strict", (t) => {
  const root = tempRoot(t);
  write(root, "concept.md", markdown(["type: Concept"], "# Concept\n\n[Missing](missing.md)"));
  const tolerant = buildIndex([{ id: "demo", root }]);
  const strict = buildIndex([{ id: "demo", root }], { strictLinks: true });
  assert.equal(tolerant.conformant, true);
  assert.equal(tolerant.validForProject, true);
  assert.equal(strict.conformant, true);
  assert.equal(strict.validForProject, false);
});

test("binary bundle assets are returned from the bounded indexed snapshot", (t) => {
  const root = tempRoot(t);
  write(root, "blob.bin", Buffer.from([0x00, 0x01, 0xfe, 0xff]));
  write(root, "artifact.md", markdown([
    "type: Artifact",
    "resource: blob.bin",
  ], "# Artifact"));
  const index = buildIndex([{ id: "binary", root }]);
  const asset = index.assets.find((entry) => entry.path === "blob.bin");
  assert.ok(asset);
  assert.equal(Object.prototype.propertyIsEnumerable.call(asset, "_contentBytes"), false);
  const result = readBundleAsset(index, { uri: asset.uri });
  assert.equal(result.contentEncoding, "base64");
  assert.equal(result.content, Buffer.from([0x00, 0x01, 0xfe, 0xff]).toString("base64"));
});

test("path-like missing sources stay unresolved instead of becoming opaque external provenance", (t) => {
  const root = tempRoot(t);
  write(root, "concept.md", markdown([
    "type: Concept",
    "sources:",
    "  - resource: ../missing.sql",
  ], "# Concept"));
  const index = buildIndex([{ id: "demo", root }]);
  const edge = index.edges.find((entry) => entry.kind === "source");
  assert.equal(edge.broken, true);
  assert.equal(edge.external, false);
  assert.equal(edge.resolvedAs, "unresolved");
  assert.equal(index.warnings.some((entry) => entry.code === "asset_outside_root"), true);
});

test("invalid or reserved Markdown cannot satisfy computation dependencies", (t) => {
  const root = tempRoot(t);
  write(root, "index.md", "# Index\n\n- [Compute](compute.md)\n");
  write(root, "executor.md", "# Missing type\n");
  write(root, "attester.md", "# Missing type\n");
  write(root, "compute.md", markdown([
    "type: Attested Computation",
    "runtime: python",
    "executor:",
    "  resource: executor.md",
    "  receipt: [result]",
    "attester:",
    "  resource: attester.md",
  ], "# Compute\n\n# Computation\n\n```python\nprint('static')\n```"));
  const index = buildIndex([{ id: "invalid-targets", root }]);
  const uri = "okf://invalid-targets/compute";
  const contract = index.byUri.get(uri).signals.computation;
  assert.equal(contract.assetsReady, false);
  assert.equal(contract.attestationReady, false);
  const inspection = inspectAttestedComputation(index, uri);
  assert.equal(inspection.executor.resolved, false);
  assert.equal(inspection.attester.resolved, false);
  assert.throws(() => prepareAttestedComputation(index, uri, {}), /not statically ready/);

  const store = new FileConceptStore({ bundles: [{ id: "invalid-targets", root }], relationTypes: [] });
  const service = new ConceptAuthoringService(store);
  const validation = service.validateAttestedComputation({
    bundle: "invalid-targets",
    path: "new-compute.md",
    frontmatter: {
      type: "Attested Computation",
      runtime: "python",
      executor: { resource: "executor.md", receipt: ["result"] },
      attester: { resource: "attester.md" },
    },
    body: "# New\n\n# Computation\n\n```python\nprint('static')\n```",
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((entry) => /Markdown resource/.test(entry.message)), true);
});

test("invalid UTF-8 in a text computation asset prevents static readiness", (t) => {
  const root = tempRoot(t);
  write(root, "runner.md", markdown(["type: Execution Skill"], "# Runner"));
  write(root, "attester.py", "def attest(receipt): return True\n");
  write(root, "bad.sql", Buffer.from([0xc3, 0x28]));
  write(root, "compute.md", markdown([
    "type: Attested Computation",
    "runtime: sqlite",
    "computation: bad.sql",
    "executor:",
    "  resource: runner.md",
    "  receipt: [result]",
    "attester:",
    "  resource: attester.py",
  ], "# Compute"));
  const index = buildIndex([{ id: "invalid-utf8", root }]);
  const contract = index.byUri.get("okf://invalid-utf8/compute").signals.computation;
  assert.equal(contract.assetsReady, false);
  assert.equal(contract.attestationReady, false);
  assert.equal(index.warnings.some((entry) => entry.code === "asset_invalid_utf8"), true);
});

test("MCP exposes v0.2 read tools by default and gates coordinated computation authoring separately", async (t) => {
  const root = computationFixture(t);
  const readOnly = await connectMcp(t, [{ id: "finance", root }]);
  const readNames = (await readOnly.client.listTools()).tools.map((tool) => tool.name);
  assert.equal(readNames.includes("inspect_attested_computation"), true);
  assert.equal(readNames.includes("get_provenance"), true);
  assert.equal(readNames.includes("read_bundle_asset"), true);
  assert.equal(readNames.includes("okf_propose_attested_computation"), false);

  const store = new FileConceptStore({ bundles: [{ id: "finance", root }], relationTypes: [] });
  const service = new ConceptAuthoringService(store);
  const enabled = await connectMcp(t, [], {
    authoringService: service,
    allowAuthoring: true,
    allowComputationAuthoring: true,
  });
  const enabledNames = (await enabled.client.listTools()).tools.map((tool) => tool.name);
  assert.equal(enabledNames.includes("okf_propose_attested_computation"), true);
});

test("coordinated computation proposals write neither file before review and accept concept plus computation together", async (t) => {
  const root = computationFixture(t);
  const proposalRoot = path.join(root, ".proposals");
  const store = new FileConceptStore({ bundles: [{ id: "finance", root }], relationTypes: [], proposalRoot });
  const service = new ConceptAuthoringService(store);
  const input = {
    bundle: "finance",
    path: "computations/net-revenue.md",
    frontmatter: {
      type: "Attested Computation",
      title: "Net Revenue",
      runtime: "sqlite",
      parameters: [{ name: "year", type: "integer", required: true }],
      computation: "../artifacts/net-revenue.sql",
      executor: { resource: "../references/run.md", receipt: ["job_id", "result"] },
      attester: { resource: "../artifacts/attest.py" },
    },
    body: "# Net Revenue",
    computationPath: "artifacts/net-revenue.sql",
    computationContent: "SELECT SUM(net_amount) FROM revenue WHERE year = :year;\n",
  };
  const generic = await service.proposeConcept(input);
  assert.equal(generic.created, false);
  assert.equal(generic.validation.errors.some((entry) => entry.code === "computation_authoring_requires_capability"), true);

  const proposed = await service.proposeAttestedComputation(input);
  assert.equal(proposed.created, true);
  assert.equal(fs.existsSync(path.join(root, input.path)), false);
  assert.equal(fs.existsSync(path.join(root, input.computationPath)), false);
  const accepted = await service.acceptProposal({ proposalId: proposed.proposal.id, allowComputation: true });
  assert.equal(accepted.accepted, true);
  assert.equal(fs.existsSync(path.join(root, input.path)), true);
  assert.equal(fs.existsSync(path.join(root, input.computationPath)), true);
  assert.equal(store.getIndex().byUri.get("okf://finance/computations/net-revenue").signals.computation.attestationReady, true);
});

test("ordinary acceptance failures roll back all coordinated computation files", async (t) => {
  const root = computationFixture(t);
  const proposalRoot = path.join(root, ".proposals");
  const store = new FileConceptStore({ bundles: [{ id: "finance", root }], relationTypes: [], proposalRoot });
  const service = new ConceptAuthoringService(store);
  const proposed = await service.proposeAttestedComputation({
    bundle: "finance",
    path: "computations/rollback.md",
    frontmatter: {
      type: "Attested Computation",
      runtime: "sqlite",
      computation: "../artifacts/rollback.sql",
      executor: { resource: "../references/run.md", receipt: ["result"] },
      attester: { resource: "../artifacts/attest.py" },
    },
    body: "# Rollback",
    computationPath: "artifacts/rollback.sql",
    computationContent: "SELECT 1;\n",
  });
  assert.equal(proposed.created, true);
  store.saveExistingProposal = () => {
    throw new Error("injected status persistence failure");
  };
  await assert.rejects(
    () => service.acceptProposal({ proposalId: proposed.proposal.id, allowComputation: true }),
    /injected status persistence failure/,
  );
  assert.equal(fs.existsSync(path.join(root, "computations/rollback.md")), false);
  assert.equal(fs.existsSync(path.join(root, "artifacts/rollback.sql")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(proposalRoot, `${proposed.proposal.id}.json`), "utf8")).status, "proposed");
});

test("computation proposals conflict when reviewed dependencies change", async (t) => {
  const root = computationFixture(t);
  const store = new FileConceptStore({
    bundles: [{ id: "finance", root }],
    relationTypes: [],
    proposalRoot: path.join(root, ".proposals"),
  });
  const service = new ConceptAuthoringService(store);
  const proposed = await service.proposeAttestedComputation({
    bundle: "finance",
    path: "computations/review-bound.md",
    frontmatter: {
      type: "Attested Computation",
      runtime: "sqlite",
      computation: "../artifacts/revenue.sql",
      executor: { resource: "../references/run.md", receipt: ["job_id", "result"] },
      attester: { resource: "../artifacts/attest.py" },
    },
    body: "# Review Bound",
  });
  assert.equal(proposed.created, true);
  assert.equal(proposed.proposal.dependencyRevisions.length, 3);
  write(root, "artifacts/revenue.sql", "SELECT 'changed after review';\n");

  const accepted = await service.acceptProposal({
    proposalId: proposed.proposal.id,
    allowComputation: true,
  });
  assert.equal(accepted.accepted, false);
  assert.equal(accepted.conflict, true);
  assert.equal(accepted.proposal.conflict.code, "computation_dependency_changed");
  assert.equal(fs.existsSync(path.join(root, "computations/review-bound.md")), false);
});

test("internal concept computation dependencies are revision-bound", async (t) => {
  const root = computationFixture(t);
  const store = new FileConceptStore({
    bundles: [{ id: "finance", root }],
    relationTypes: [],
    proposalRoot: path.join(root, ".proposals"),
  });
  const service = new ConceptAuthoringService(store);
  const proposed = await service.proposeAttestedComputation({
    bundle: "finance",
    path: "computations/concept-bound.md",
    frontmatter: {
      type: "Attested Computation",
      runtime: "sqlite",
      executor: { resource: "okf://finance/references/run", receipt: ["result"] },
      attester: { resource: "okf://finance/policies/revenue" },
    },
    body: "# Concept Bound\n\n# Computation\n\n```sql\nSELECT 1;\n```",
  });
  assert.equal(proposed.created, true);
  assert.equal(proposed.proposal.dependencyRevisions.length, 2);
  write(root, "references/run.md", markdown(["type: Execution Skill", "title: Changed"], "# Changed"));

  const accepted = await service.acceptProposal({ proposalId: proposed.proposal.id, allowComputation: true });
  assert.equal(accepted.accepted, false);
  assert.equal(accepted.conflict, true);
  assert.equal(accepted.proposal.conflict.code, "computation_dependency_changed");
});

test("acceptance rejects a tampered metadata-only computation update", async (t) => {
  const root = computationFixture(t);
  const proposalRoot = path.join(root, ".proposals");
  const store = new FileConceptStore({ bundles: [{ id: "finance", root }], relationTypes: [], proposalRoot });
  const service = new ConceptAuthoringService(store);
  const proposed = await service.proposeUpdate({
    uri: "okf://finance/computations/revenue",
    frontmatter: { title: "Reviewed title" },
  });
  assert.equal(proposed.created, true);
  const proposalPath = path.join(proposalRoot, `${proposed.proposal.id}.json`);
  const stored = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
  stored.frontmatter.runtime = "tampered-runtime";
  stored.body = "# Tampered\n\n# Computation\n\n```sql\nDROP TABLE revenue;\n```";
  fs.writeFileSync(proposalPath, JSON.stringify(stored, null, 2) + "\n", "utf8");

  const accepted = await service.acceptProposal({ proposalId: proposed.proposal.id });
  assert.equal(accepted.accepted, false);
  assert.equal(accepted.validation.errors.some((entry) => entry.code === "immutable_computation_contract"), true);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "computations/revenue.md"), "utf8"), /tampered-runtime/);
});

test("Stage-A migration creates a manifest and per-file proposals without automatic acceptance", async (t) => {
  const projectRoot = tempRoot(t);
  const bundle = path.join(projectRoot, "bundle");
  fs.mkdirSync(bundle, { recursive: true });
  write(bundle, "index.md", "# Legacy\n\n- [Metric](metric.md)\n");
  write(bundle, "metric.md", markdown([
    "type: Metric",
    "timestamp: 2026-05-28T22:53:05Z",
  ], "# Metric\n\n# Citations\n\n- [Policy](https://example.test/policy)"));
  const store = new FileConceptStore({
    bundles: [{ id: "legacy", root: bundle }],
    relationTypes: [],
    proposalRoot: path.join(projectRoot, ".okf-proposals"),
  });
  const service = new ConceptAuthoringService(store);
  const before = fs.readFileSync(path.join(bundle, "metric.md"), "utf8");
  const result = await service.proposeV02Migration({
    bundle: "legacy",
    actorMappings: {
      "okf://legacy/metric": { by: "human:catalog-owner", confirmed: true },
    },
  });
  assert.equal(result.created, true);
  assert.equal(result.proposals.length, 2);
  assert.equal(result.proposals.every((proposal) => proposal.status === "proposed"), true);
  assert.equal(fs.readFileSync(path.join(bundle, "metric.md"), "utf8"), before);
  assert.equal(fs.existsSync(path.join(store.proposalRoot, "migrations", `${result.manifest.id}.json`)), true);
});

test("Stage-A can propose metadata-only updates for existing Attested Computations", async (t) => {
  const projectRoot = tempRoot(t);
  const bundle = path.join(projectRoot, "bundle");
  fs.mkdirSync(bundle, { recursive: true });
  write(bundle, "index.md", "# Legacy\n\n- [Compute](compute.md)\n- [Runner](runner.md)\n- [Attester](attester.md)\n");
  write(bundle, "runner.md", markdown(["type: Execution Skill"], "# Runner"));
  write(bundle, "attester.md", markdown(["type: Attester"], "# Attester"));
  write(bundle, "compute.md", markdown([
    "type: Attested Computation",
    "timestamp: 2026-08-11T10:00Z",
    "runtime: sqlite",
    "executor:",
    "  resource: runner.md",
    "  receipt: [result]",
    "attester:",
    "  resource: attester.md",
  ], "# Compute\n\n# Computation\n\n```sql\nSELECT 1;\n```"));
  const store = new FileConceptStore({
    bundles: [{ id: "legacy-compute", root: bundle }],
    relationTypes: [],
    proposalRoot: path.join(projectRoot, ".okf-proposals"),
  });
  const service = new ConceptAuthoringService(store);
  const result = await service.proposeV02Migration({
    bundle: "legacy-compute",
    actorMappings: {
      "okf://legacy-compute/compute": { by: "human:catalog-owner", confirmed: true },
    },
  });
  assert.equal(result.created, true);
  assert.equal(result.proposals[0].op, "update");
  assert.deepEqual(result.proposals[0].frontmatter.generated, {
    by: "human:catalog-owner",
    at: "2026-08-11T10:00Z",
  });
  assert.equal(result.proposals[0].frontmatter.runtime, "sqlite");
});

test("migration index acceptance rejects a tampered version declaration", async (t) => {
  const projectRoot = tempRoot(t);
  const bundle = path.join(projectRoot, "bundle");
  fs.mkdirSync(bundle, { recursive: true });
  write(bundle, "index.md", "# Legacy\n\n- [Metric](metric.md)\n");
  write(bundle, "metric.md", markdown([
    "type: Metric",
    "timestamp: 2026-05-28T22:53:05Z",
  ], "# Metric"));
  const proposalRoot = path.join(projectRoot, ".okf-proposals");
  const store = new FileConceptStore({ bundles: [{ id: "tamper", root: bundle }], relationTypes: [], proposalRoot });
  const service = new ConceptAuthoringService(store);
  const result = await service.proposeV02Migration({
    bundle: "tamper",
    actorMappings: { "okf://tamper/metric": { by: "human:owner", confirmed: true } },
  });
  const child = result.proposals.find((proposal) => proposal.op === "update");
  const version = result.proposals.find((proposal) => proposal.op === "migration_index");
  assert.equal((await service.acceptProposal({ proposalId: child.id })).accepted, true);
  const file = path.join(proposalRoot, `${version.id}.json`);
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  stored.frontmatter.okf_version = "0.1";
  stored.markdown = stored.markdown.replace('okf_version: "0.2"', 'okf_version: "0.1"');
  fs.writeFileSync(file, JSON.stringify(stored, null, 2) + "\n", "utf8");

  const accepted = await service.acceptProposal({ proposalId: version.id });
  assert.equal(accepted.accepted, false);
  assert.equal(accepted.validation.errors.some((entry) => entry.code === "invalid_migration_version_declaration"), true);
  assert.doesNotMatch(fs.readFileSync(path.join(bundle, "index.md"), "utf8"), /okf_version/);
});

test("remote loading uses two passes and fetches only explicitly referenced inert assets", async () => {
  const files = new Map([
    ["okf/bundle/index.md", "---\nokf_version: \"0.2\"\n---\n\n# Remote\n\n- [Compute](computations/revenue.md)\n"],
    ["okf/bundle/computations/revenue.md", markdown([
      "type: Attested Computation",
      "runtime: sqlite",
      "computation: ../artifacts/revenue.sql",
      "executor:",
      "  resource: ../references/run.md",
      "  receipt: [job_id, result]",
      "attester:",
      "  resource: ../artifacts/attest.py",
    ], "# Revenue")],
    ["okf/bundle/references/run.md", markdown(["type: Execution Skill"], "# Run")],
    ["okf/bundle/artifacts/revenue.sql", "SELECT 1;\n"],
    ["okf/bundle/artifacts/attest.py", "def attest(receipt): return True\n"],
    ["okf/bundle/artifacts/unreferenced.py", "raise RuntimeError('never fetch')\n"],
  ]);
  const fetchedRaw = [];
  const fetch = async (url) => {
    const target = String(url);
    if (target.includes("/commits/main")) {
      return { ok: true, json: async () => ({ sha: "a".repeat(40) }) };
    }
    if (target.includes("/contents/")) {
      return {
        ok: true,
        json: async () => Array.from(files.entries()).map(([filePath, text]) => ({
          type: "file",
          name: path.posix.basename(filePath),
          path: filePath,
          size: Buffer.byteLength(text),
          sha: gitBlobSha(text),
          download_url: `https://raw.example/${filePath}`,
        })),
      };
    }
    if (target.startsWith("https://raw.example/")) {
      const filePath = target.slice("https://raw.example/".length);
      fetchedRaw.push(filePath);
      const content = files.get(filePath);
      return {
        ok: content !== undefined,
        status: content === undefined ? 404 : 200,
        arrayBuffer: async () => Buffer.from(content),
      };
    }
    return { ok: false, status: 404, statusText: "Not Found" };
  };
  const remote = await fetchGitHubBundle({
    id: "remote",
    url: "https://github.com/acme/catalog/tree/main/okf/bundle",
    include: ["*.md", "**/*.md"],
  }, { fetch });
  assert.equal(remote.documents.length, 3);
  assert.deepEqual(remote.assets.map((asset) => asset.path).sort(), [
    "artifacts/attest.py",
    "artifacts/revenue.sql",
  ]);
  assert.equal(fetchedRaw.includes("okf/bundle/artifacts/unreferenced.py"), false);
  assert.equal(remote.remoteSource.commitSha, "a".repeat(40));
  const index = buildIndex([remote]);
  assert.equal(index.byUri.get("okf://remote/computations/revenue").signals.computation.attestationReady, true);
});

test("remote loading requires an immutable revision and diagnoses invalid UTF-8 text assets", async () => {
  await assert.rejects(
    () => fetchGitHubBundle({
      id: "unresolved",
      url: "https://github.com/acme/catalog/tree/main/okf/bundle",
    }, {
      fetch: async () => ({ ok: false, status: 404, statusText: "Not Found" }),
    }),
    /GitHub request failed|immutable commit SHA/,
  );

  const files = new Map([
    ["okf/bundle/index.md", "# Remote\n\n- [Evidence](evidence.md)\n"],
    ["okf/bundle/evidence.md", markdown([
      "type: Artifact",
      "resource: artifacts/evidence.sql",
    ], "# Evidence")],
    ["okf/bundle/artifacts/evidence.sql", Buffer.from([0xc3, 0x28])],
  ]);
  const fetch = async (url) => {
    const target = String(url);
    if (target.includes("/commits/main")) {
      return { ok: true, json: async () => ({ sha: "c".repeat(40) }) };
    }
    if (target.includes("/contents/")) {
      return {
        ok: true,
        json: async () => Array.from(files.entries()).map(([filePath, content]) => ({
          type: "file",
          name: path.posix.basename(filePath),
          path: filePath,
          size: Buffer.byteLength(content),
          sha: gitBlobSha(content),
          download_url: `https://raw.example/${filePath}`,
        })),
      };
    }
    if (target.startsWith("https://raw.example/")) {
      const content = files.get(target.slice("https://raw.example/".length));
      return { ok: content !== undefined, arrayBuffer: async () => Buffer.from(content) };
    }
    return { ok: false, status: 404, statusText: "Not Found" };
  };
  const remote = await fetchGitHubBundle({
    id: "utf8",
    url: "https://github.com/acme/catalog/tree/main/okf/bundle",
  }, { fetch });
  assert.equal(remote.assets[0].kind, "binary");
  assert.equal(remote.remoteSource.unresolvedReferences.some((entry) => entry.code === "asset_invalid_utf8"), true);
  assert.equal(buildIndex([remote]).warnings.some((entry) => entry.code === "asset_invalid_utf8"), true);
});
