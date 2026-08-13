"use strict";

const fs = require("fs");

const {
  attachProject,
  buildIndex,
  buildProjectIndexAsync,
  loadProjectBundles,
  resolveConcept,
  validateIndex,
} = require("./indexer");
const { exportGraph, findPaths, getNeighbors, graphSummary } = require("./graph");
const { searchConcepts } = require("./search");
const { conceptSummary } = require("./indexer");
const { findOkfRoot, findProjectConfig, loadProjectConfig } = require("./project");
const { generateProject } = require("./plugins");
const { runStdioServer } = require("./mcp-server");
const { fetchRemoteBundles } = require("./remote");
const { runHttpServer } = require("./http-server");
const {
  checkComputationReceipt,
  getProvenance,
  inspectAttestedComputation,
  prepareAttestedComputation,
  readBundleAsset,
} = require("./computation");
const { buildV02MigrationPlan, checkV02Migration } = require("./migration");
const { describeConceptGitSources, readConceptGitSource } = require("./git-source");
const { validActor } = require("./v02");
const packageMetadata = require("../package.json");

const COMMANDS = new Set([
  "mcp", "validate", "graph", "search", "concept", "neighbors", "paths", "generate", "serve",
  "provenance", "edge-kinds", "computation", "asset", "source", "migrate",
]);

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.code = "OKF_USAGE_ERROR";
    this.exitCode = 2;
  }
}

function usageError(message) {
  return new UsageError(message);
}

function parseJsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw usageError(`${label} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw usageError(`${label} must be a JSON object.`);
  }
  return parsed;
}

function readJsonObjectSource(source, label, runtime) {
  let text;
  try {
    const readFileSync = runtime && runtime.readFileSync ? runtime.readFileSync : fs.readFileSync;
    text = readFileSync(source === "-" ? 0 : source, "utf8");
  } catch (error) {
    throw usageError(`${label} could not be read from ${source === "-" ? "stdin" : source}.`);
  }
  return parseJsonObject(String(text), label);
}

function exitCodeForError(error) {
  return error && error.exitCode === 2 ? 2 : 1;
}

function parseArgs(argv) {
  const bundles = [];
  const remoteBundles = [];
  const repositories = [];
  const positional = [];
  let project = null;
  let root = null;
  let inspect = false;
  let help = false;
  let host = "127.0.0.1";
  let port = 8765;
  let writeToken = "";
  let proposalRoot = "";
  let version = false;
  let authoring = false;
  let write = false;
  let actor = "";
  let gitCommit = false;
  let allowRemoteTool = false;
  let strictLinks = false;
  let allowComputationAuthoring = false;
  let includeAssets = false;
  let includeExternal = false;
  let parametersFile = "";
  let receiptFile = "";
  let maxContentBytes = 65536;
  const generatedPaths = [];
  const search = {
    types: [],
    tagsAny: [],
    statuses: [],
    trustTiers: [],
    freshness: [],
    frontmatter: {},
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root" || arg === "-r") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      if (root) {
        throw usageError("--root may be supplied only once.");
      }
      root = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      if (root) {
        throw usageError("--root may be supplied only once.");
      }
      root = arg.slice("--root=".length);
      if (!root) {
        throw usageError("--root requires a value.");
      }
      continue;
    }
    if (arg === "--bundle" || arg === "-b") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      bundles.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--bundle=")) {
      const value = arg.slice("--bundle=".length);
      if (!value) {
        throw usageError("--bundle requires a value.");
      }
      bundles.push(value);
      continue;
    }
    if (arg === "--remote-bundle") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      remoteBundles.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--remote-bundle=")) {
      const value = arg.slice("--remote-bundle=".length);
      if (!value) {
        throw usageError("--remote-bundle requires a value.");
      }
      remoteBundles.push(value);
      continue;
    }
    if (arg === "--project" || arg === "-p") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      project = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--project=")) {
      project = arg.slice("--project=".length);
      if (!project) {
        throw usageError("--project requires a value.");
      }
      continue;
    }
    if (arg === "--repo") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError("--repo requires concept-id=path.");
      }
      repositories.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      const value = arg.slice("--repo=".length);
      if (!value) {
        throw usageError("--repo requires concept-id=path.");
      }
      repositories.push(value);
      continue;
    }
    if (arg === "--inspect") {
      inspect = true;
      continue;
    }
    if (arg === "--authoring") {
      authoring = true;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--actor") {
      if (actor) {
        throw usageError("--actor may be supplied only once.");
      }
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError("--actor requires a value.");
      }
      actor = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--actor=")) {
      if (actor) {
        throw usageError("--actor may be supplied only once.");
      }
      actor = arg.slice("--actor=".length);
      if (!actor) {
        throw usageError("--actor requires a value.");
      }
      continue;
    }
    if (arg === "--git-commit") {
      gitCommit = true;
      continue;
    }
    if (arg === "--allow-remote-tool") {
      allowRemoteTool = true;
      continue;
    }
    if (arg === "--allow-computation-authoring") {
      allowComputationAuthoring = true;
      continue;
    }
    if (arg === "--strict-links") {
      strictLinks = true;
      continue;
    }
    if (arg === "--include-assets") {
      includeAssets = true;
      continue;
    }
    if (arg === "--include-external") {
      includeExternal = true;
      continue;
    }
    if (arg === "--generated-path") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      generatedPaths.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--parameters-file" || arg === "--receipt-file") {
      const value = argv[index + 1];
      if (!value || (String(value).startsWith("-") && value !== "-")) {
        throw usageError(`${arg} requires a file path or - for stdin.`);
      }
      if (arg === "--parameters-file") {
        parametersFile = value;
      } else {
        receiptFile = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--max-content-bytes") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 1048576) {
        throw usageError("--max-content-bytes requires an integer from 1 through 1048576.");
      }
      maxContentBytes = value;
      index += 1;
      continue;
    }
    const searchValueOptions = {
      "--type": "types",
      "--tag": "tagsAny",
      "--status": "statuses",
      "--trust-tier": "trustTiers",
      "--freshness": "freshness",
    };
    if (Object.prototype.hasOwnProperty.call(searchValueOptions, arg)) {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      search[searchValueOptions[arg]].push(argv[index + 1]);
      index += 1;
      continue;
    }
    const scalarSearchOptions = {
      "--as-of": "asOf",
      "--runtime": "runtime",
      "--linked-to": "linkedTo",
      "--linked-from": "linkedFrom",
      "--relation-type": "relationType",
      "--path-prefix": "pathPrefix",
    };
    if (Object.prototype.hasOwnProperty.call(scalarSearchOptions, arg)) {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      search[scalarSearchOptions[arg]] = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--frontmatter") {
      const value = argv[index + 1];
      const separator = value && value.indexOf("=");
      if (!value || separator <= 0) {
        throw usageError("--frontmatter requires key=value.");
      }
      search.frontmatter[value.slice(0, separator)] = value.slice(separator + 1);
      index += 1;
      continue;
    }
    if (arg === "--has-sources" || arg === "--no-sources") {
      search.hasSources = arg === "--has-sources";
      continue;
    }
    if (arg === "--attestation-ready") {
      search.attestationReady = true;
      continue;
    }
    if (arg === "--orphan-only") {
      search.orphanOnly = true;
      continue;
    }
    if (arg === "--host") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      host = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
      continue;
    }
    if (arg === "--port") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      port = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
      continue;
    }
    if (arg === "--write-token") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      writeToken = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--write-token=")) {
      writeToken = arg.slice("--write-token=".length);
      continue;
    }
    if (arg === "--proposal-root") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError(`${arg} requires a value.`);
      }
      proposalRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--proposal-root=")) {
      proposalRoot = arg.slice("--proposal-root=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }
    if (arg === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg && arg.startsWith("-")) {
      throw usageError(`Unknown option: ${arg}`);
    }
    if (arg && !arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  if (write && !actor) {
    throw usageError("--write requires --actor <human:id|process:id|provider/model>.");
  }
  if (write && !validActor(actor)) {
    throw usageError("--actor must use human:<id>, process:<id>, or provider/model syntax.");
  }
  if (actor && !write) {
    throw usageError("--actor requires --write.");
  }
  if (gitCommit && !write) {
    throw usageError("--git-commit requires --write.");
  }
  return {
    bundles,
    remoteBundles,
    repositories,
    positional,
    project,
    root,
    inspect,
    help,
    version,
    authoring,
    write,
    actor,
    gitCommit,
    allowRemoteTool,
    allowComputationAuthoring,
    strictLinks,
    includeAssets,
    includeExternal,
    parametersFile,
    receiptFile,
    maxContentBytes,
    generatedPaths,
    host,
    port,
    writeToken,
    proposalRoot,
    search,
  };
}

function usage() {
  return [
    "okf-mcp / okf",
    "",
    "Usage:",
    "  okf-mcp --root <okf-directory> <command>",
    "  okf-mcp --root <okf-directory> [--repo <repository-concept-id=path>] mcp",
    "  okf-mcp --bundle <path-or-id=path> [--bundle <path>] [--inspect]",
    "  okf-mcp --remote-bundle <id=github-tree-url> [--inspect]",
    "  okf-mcp --project <okf.project.yaml> <command>",
    "  okf-mcp [--project <okf.project.yaml>] [--authoring] [--write --actor <actor>] [--git-commit] mcp",
    "  okf-mcp --project <okf.project.yaml> serve [--host 127.0.0.1] [--port 8765]",
    "  okf-mcp <command> --bundle <path-or-id=path>",
    "",
    "Commands:",
    "  mcp                         Start the stdio MCP server.",
    "  validate                    Validate project or bundles.",
    "  graph [json|dot|mermaid]    Export graph.",
    "  search <query>              Search concepts.",
    "  concept <id-or-locator>     Print one concept.",
    "  neighbors <id-or-locator>   Print inbound/outbound neighbors.",
    "  paths <from> <to>           Find directed paths between concept locators.",
    "  provenance <id-or-locator>  Trace source provenance without external fetches.",
    "  edge-kinds                  Count graph edge kinds.",
    "  computation inspect <uri>   Inspect a static computation contract.",
    "  computation prepare <uri> --parameters-file <path|->",
    "  computation check-receipt <uri> --receipt-file <path|->",
    "  asset <okf-asset-uri>       Read one indexed referenced asset.",
    "  source <concept> <source-id> Read one pinned Git source from a mapped repository.",
    "  migrate check [bundle]      Check staged v0.2 migration readiness.",
    "  migrate preview [bundle] [actor-mappings-json]",
    "  generate                    Run configured generator plugins.",
    "  serve                       Start the HTTP OKF API server.",
    "",
    "Options:",
    "  --root, -r <directory>      Load one official OKF bundle root.",
    "  --repo <concept-id=path>    Map a Git Repository concept to a checkout or bare repo; repeatable.",
    "  --authoring                 Enable MCP proposal authoring tools.",
    "  --write                     Enable direct atomic MCP concept writes (requires --actor).",
    "  --actor <actor>             Stamp live writes with human:id, process:id, or provider/model.",
    "  --git-commit                Commit each live write batch when the catalog is in a clean Git repo.",
    "  --allow-remote-tool         Enable runtime remote-bundle loading over MCP.",
    "  --allow-computation-authoring Enable coordinated computation proposals (also requires --authoring).",
    "  --strict-links              Treat broken internal Markdown links as project-invalid.",
    "  --include-assets            Include referenced asset nodes where supported.",
    "  --include-external          Include external provenance or graph leaves.",
    "  --generated-path <path>     Mark a generated migration target; repeat as needed.",
    "  --parameters-file <path|->  Read computation parameters from a file or stdin.",
    "  --receipt-file <path|->     Read a computation receipt from a file or stdin.",
    "  --max-content-bytes <n>     Bound asset reads to 1..1048576 bytes (default 65536).",
    "  Search filters: --status, --trust-tier, --freshness, --as-of, --has-sources,",
    "                  --runtime, --attestation-ready, --frontmatter key=value.",
    "  Text search requires all terms and accepts at most 512 characters and 16 terms.",
    "  --version, -v               Print the package version.",
    "  --help, -h                  Print this help.",
    "  --debug                     Include stack traces in error output.",
    "",
    "When no source is passed, a nearest version-declaring OKF root is preferred;",
    "the nearest okf.project.yaml remains a legacy compatibility fallback.",
    "",
    "Examples:",
    "  node bin/okf-mcp.js --root ./okf/bundles/app validate",
    "  node bin/okf-mcp.js --bundle ./okf/bundles/app --inspect",
    "  node bin/okf-mcp.js --bundle app=./okf/bundles/app",
    "  node bin/okf-mcp.js --remote-bundle docs=https://github.com/org/repo/tree/main/okf/bundles/docs --inspect",
    "  node bin/okf-mcp.js --project okf.project.yaml validate",
    "",
  ].join("\n");
}

function resolveLegacyBundles(args) {
  if (args.root) {
    return [args.root];
  }
  if (args.bundles.length) {
    return args.bundles;
  }
  if (!args.positional.length) {
    return [];
  }
  const first = args.positional[0];
  return COMMANDS.has(first) ? [] : args.positional;
}

function parseRepositoryMappings(values) {
  const mappings = new Map();
  (values || []).forEach((value) => {
    const text = String(value || "");
    const separator = text.indexOf("=");
    const conceptId = separator > 0 ? text.slice(0, separator).replace(/^\/+/, "").replace(/\.md$/i, "") : "";
    const repositoryPath = separator > 0 ? text.slice(separator + 1) : "";
    if (!conceptId || !repositoryPath) {
      throw usageError("--repo requires repository-concept-id=checkout-or-bare-repository-path.");
    }
    if (mappings.has(conceptId)) {
      throw usageError(`Duplicate --repo mapping: ${conceptId}`);
    }
    mappings.set(conceptId, repositoryPath);
  });
  return mappings;
}

function parseRemoteBundleArg(value, index) {
  const text = String(value || "");
  const eq = text.indexOf("=");
  if (eq <= 0) {
    throw usageError("--remote-bundle value must use id=https://github.com/... format.");
  }
  return {
    id: text.slice(0, eq),
    provider: "github",
    url: text.slice(eq + 1),
  };
}

function discoverProject(args, startDir) {
  if (!args.project && !args.root && !args.bundles.length && !args.remoteBundles.length && !resolveLegacyBundles(args).length) {
    args.root = findOkfRoot(startDir);
    if (!args.root) {
      args.project = findProjectConfig(startDir);
    }
  }
  return args;
}

function stdioServerOptions(args) {
  const repositoryMappings = parseRepositoryMappings(args.repositories);
  const options = {
    remoteBundles: args.remoteBundles.map(parseRemoteBundleArg),
    allowAuthoring: Boolean(args.authoring),
    allowRuntimeRemoteLoad: Boolean(args.allowRemoteTool),
  };
  if (repositoryMappings.size) {
    options.repositoryMappings = repositoryMappings;
  }
  if (args.authoring && args.allowComputationAuthoring) {
    options.allowComputationAuthoring = true;
  }
  if (args.write) {
    options.allowWrite = true;
    options.actor = args.actor;
    if (args.gitCommit) {
      options.gitCommit = true;
    }
  }
  if (args.strictLinks) {
    options.strictLinks = true;
  }
  if (args.proposalRoot) {
    options.proposalRoot = args.proposalRoot;
  }
  if (args.project) {
    options.projectPath = args.project;
  } else if (args.root) {
    options.rootPath = args.root;
  }
  return options;
}

async function loadIndex(args) {
  const remoteConfigs = args.remoteBundles.map(parseRemoteBundleArg);
  if (args.project) {
    if (!remoteConfigs.length) {
      return buildProjectIndexAsync(args.project, { strictLinks: args.strictLinks || undefined });
    }
    const loaded = await loadProjectBundles(args.project);
    const remoteBundles = await fetchRemoteBundles(remoteConfigs);
    const index = buildIndex(loaded.bundles.concat(remoteBundles), {
      relationTypes: loaded.project.relationTypes,
      strictLinks: args.strictLinks || loaded.project.strictLinks,
    });
    return attachProject(index, loaded.project);
  }
  const bundles = resolveLegacyBundles(args);
  const fetchedRemoteBundles = await fetchRemoteBundles(remoteConfigs);
  if (!bundles.length && !fetchedRemoteBundles.length) {
    throw usageError("At least one --bundle root or --project config is required.");
  }
  return buildIndex(bundles.concat(fetchedRemoteBundles), {
    strictLinks: args.strictLinks,
    allowCustomRelationTypes: true,
  });
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function requireValidConcept(index, locator) {
  const doc = resolveConcept(index, locator);
  if (!doc) {
    throw new Error(`Unknown OKF concept URI or ID: ${locator || "<missing>"}`);
  }
  if (!doc.valid || doc.reserved) {
    throw new Error(`Locator is not a valid OKF concept: ${locator}`);
  }
  return doc;
}

async function main(argv, runtime) {
  const args = parseArgs(argv || []);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (args.version) {
    process.stdout.write(`${packageMetadata.version}\n`);
    return;
  }
  if (args.root && (args.project || args.bundles.length)) {
    throw usageError("--root cannot be combined with --project or --bundle.");
  }
  discoverProject(args, (runtime && runtime.cwd) || process.cwd());
  if (args.inspect) {
    printJson(graphSummary(await loadIndex(args)));
    return;
  }
  const command = args.positional[0] || "mcp";
  if (!COMMANDS.has(command)) {
    throw usageError(`Unknown OKF command: ${command}`);
  }
  if (command !== "mcp" && (args.write || args.actor || args.gitCommit)) {
    throw usageError("--write, --actor, and --git-commit are available only with the mcp command.");
  }
  if (command === "mcp") {
    const bundles = resolveLegacyBundles(args);
    if (args.project) {
      await ((runtime && runtime.runStdioServer) || runStdioServer)(
        [],
        process.stdin,
        process.stdout,
        stdioServerOptions(args),
      );
      return;
    }
    if (!bundles.length && !args.remoteBundles.length) {
      throw usageError("An OKF --root, --bundle, or --project source is required.");
    }
    await ((runtime && runtime.runStdioServer) || runStdioServer)(
      bundles,
      process.stdin,
      process.stdout,
      stdioServerOptions(args),
    );
    return;
  }
  if (command === "serve") {
    if (!args.project && !args.root) {
      throw usageError("serve requires --root or --project.");
    }
    const result = await runHttpServer({
      projectPath: args.project,
      rootPath: args.root,
      host: args.host,
      port: args.port,
      writeToken: args.writeToken || process.env.OKF_WRITE_TOKEN || "",
      proposalRoot: args.proposalRoot || "",
    });
    process.stderr.write(`OKF HTTP server listening on ${result.url}\n`);
    return;
  }
  if (command === "generate") {
    if (!args.project) {
      throw usageError("generate requires --project.");
    }
    const project = loadProjectConfig(args.project);
    printJson(generateProject(project));
    return;
  }
  const index = await loadIndex(args);
  const repositoryMappings = parseRepositoryMappings(args.repositories);
  if (command === "validate") {
    const result = validateIndex(index);
    printJson(result);
    process.exitCode = result.validForProject ? 0 : 1;
    return;
  }
  if (command === "graph") {
    process.stdout.write(exportGraph(index, {
      format: args.positional[1] || "json",
      includeExternal: args.includeExternal,
      includeAssets: args.includeAssets,
    }) + "\n");
    return;
  }
  if (command === "search") {
    const filters = Object.assign({}, args.search, { query: args.positional.slice(1).join(" ") });
    if (!Object.keys(filters.frontmatter || {}).length) {
      delete filters.frontmatter;
    }
    printJson(searchConcepts(index, filters));
    return;
  }
  if (command === "concept") {
    const locator = args.positional[1];
    if (!locator) {
      throw usageError("concept requires a Concept ID or locator.");
    }
    const doc = requireValidConcept(index, locator);
    printJson(Object.assign(conceptSummary(doc), {
      frontmatter: doc.frontmatter,
      body: doc.body,
      links: doc.links,
      referencedAssets: (index.assets || []).filter((asset) => (
        (asset.referencedBy || []).some((reference) => reference.uri === doc.uri)
      )).map((asset) => ({
        uri: asset.uri,
        path: asset.path,
        mimeType: asset.mimeType,
        size: asset.size,
        sha256: asset.sha256,
        roles: asset.roles,
      })),
      gitSources: describeConceptGitSources(index, doc, repositoryMappings),
    }));
    return;
  }
  if (command === "neighbors") {
    if (!args.positional[1]) {
      throw usageError("neighbors requires a URI.");
    }
    const doc = requireValidConcept(index, args.positional[1]);
    printJson(getNeighbors(index, doc.uri, {
      includeAssets: args.includeAssets,
      includeExternal: args.includeExternal,
    }));
    return;
  }
  if (command === "paths") {
    if (!args.positional[1] || !args.positional[2]) {
      throw usageError("paths requires <from> and <to> URIs.");
    }
    const source = requireValidConcept(index, args.positional[1]);
    const target = requireValidConcept(index, args.positional[2]);
    printJson(findPaths(index, source.uri, target.uri));
    return;
  }
  if (command === "provenance") {
    if (!args.positional[1]) {
      throw usageError("provenance requires a URI.");
    }
    printJson(getProvenance(index, args.positional[1], { includeExternal: args.includeExternal }));
    return;
  }
  if (command === "edge-kinds") {
    const counts = {};
    index.edges.forEach((edge) => {
      if (!counts[edge.kind]) {
        counts[edge.kind] = { total: 0, resolved: 0, broken: 0 };
      }
      counts[edge.kind].total += 1;
      counts[edge.kind][edge.broken ? "broken" : "resolved"] += 1;
    });
    printJson(counts);
    return;
  }
  if (command === "computation") {
    const operation = args.positional[1];
    const uri = args.positional[2];
    if (!operation || !uri) {
      throw usageError("computation requires inspect|prepare|check-receipt and a URI.");
    }
    if (operation === "inspect") {
      printJson(inspectAttestedComputation(index, uri, { asOf: args.search.asOf }));
      return;
    }
    if (operation === "prepare") {
      if (args.positional[3]) {
        throw usageError("Raw computation parameters are not accepted in argv; use --parameters-file <path|->.");
      }
      const parameters = args.parametersFile
        ? readJsonObjectSource(args.parametersFile, "computation parameters", runtime)
        : null;
      if (!parameters) {
        throw usageError("computation prepare requires --parameters-file <path|->.");
      }
      printJson(prepareAttestedComputation(
        index,
        uri,
        parameters,
        { asOf: args.search.asOf },
      ));
      return;
    }
    if (operation === "check-receipt") {
      if (args.positional[3]) {
        throw usageError("Raw computation receipts are not accepted in argv; use --receipt-file <path|->.");
      }
      const receipt = args.receiptFile
        ? readJsonObjectSource(args.receiptFile, "computation receipt", runtime)
        : null;
      if (!receipt) {
        throw usageError("computation check-receipt requires --receipt-file <path|->.");
      }
      printJson(checkComputationReceipt(
        index,
        uri,
        receipt,
      ));
      return;
    }
    throw usageError(`Unknown computation operation: ${operation}`);
  }
  if (command === "asset") {
    if (!args.positional[1]) {
      throw usageError("asset requires an okf-asset URI.");
    }
    printJson(readBundleAsset(index, {
      uri: args.positional[1],
      maxContentBytes: args.maxContentBytes,
    }));
    return;
  }
  if (command === "source") {
    if (!args.positional[1] || !args.positional[2]) {
      throw usageError("source requires <concept-id-or-locator> and <source-id>.");
    }
    printJson(readConceptGitSource(
      index,
      args.positional[1],
      args.positional[2],
      repositoryMappings,
      { maxBytes: args.maxContentBytes },
    ));
    return;
  }
  if (command === "migrate") {
    const operation = args.positional[1];
    if (!["check", "preview"].includes(operation)) {
      throw usageError("migrate requires check or preview.");
    }
    let bundleArgument = args.positional[2] || "";
    let actorMappingsArgument = args.positional[3] || "";
    if (operation === "preview"
      && index.bundles.length === 1
      && !actorMappingsArgument
      && bundleArgument.trim().startsWith("{")) {
      actorMappingsArgument = bundleArgument;
      bundleArgument = "";
    }
    const bundle = bundleArgument || (index.bundles.length === 1 ? index.bundles[0].id : "");
    if (!bundle) {
      throw usageError("migrate requires a bundle id when multiple bundles are loaded.");
    }
    if (!index.bundles.some((entry) => entry.id === bundle)) {
      throw usageError(`Unknown bundle id: ${bundle}`);
    }
    const actorMappings = actorMappingsArgument
      ? parseJsonObject(actorMappingsArgument, "actor mappings")
      : {};
    const result = operation === "check"
      ? checkV02Migration(index, { bundle, actorMappings, generatedPaths: args.generatedPaths })
      : buildV02MigrationPlan(index, { bundle, actorMappings, generatedPaths: args.generatedPaths });
    printJson(result);
    const report = operation === "check" ? result : result.report;
    process.exitCode = report.blockers.length ? 1 : 0;
    return;
  }
  throw usageError(`Unknown OKF command: ${command}`);
}

module.exports = {
  UsageError,
  discoverProject,
  exitCodeForError,
  main,
  parseArgs,
  stdioServerOptions,
  usage,
};
