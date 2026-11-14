"use strict";

// Command handlers of the okf / okf-mcp binary, one function per command,
// dispatched by runCommand after src/cli.js has parsed the arguments and
// discovered the project. Split out of src/cli.js (Q-1).

const {
  attachProject,
  buildIndex,
  conceptSummary,
  loadProjectBundles,
  resolveConcept,
  validateIndex,
} = require("../indexer");
const { exportGraph, findPaths, getNeighbors, graphSummary } = require("../graph");
const { searchConcepts } = require("../search");
const { loadProjectConfig } = require("../project");
const { withSearchLanguages } = require("../search/cli-options");
const contextCli = require("../context/cli-options");
const { generateProject } = require("../plugins");
const { ProducerService, producerReceipt } = require("../producers");
const { FileConceptStore } = require("../store");
const { runStdioServer } = require("../mcp-server");
const { runMcpHttpServer } = require("../mcp/http");
const { fetchRemoteBundles } = require("../remote");
const { runHttpServer } = require("../http-server");
const {
  checkComputationReceipt,
  getProvenance,
  inspectAttestedComputation,
  prepareAttestedComputation,
  readBundleAsset,
} = require("../computation");
const { buildV02MigrationPlan, checkV02Migration } = require("../migration");
const { describeConceptGitSources, readConceptGitSource } = require("../git-source");
const { httpServerOptions } = require("./http-options");
const {
  COMMANDS,
  PRODUCER_ACTIONS,
  WRITE_COMMANDS,
  parseJsonObject,
  parseRemoteBundleArg,
  parseRepositoryMappings,
  readJsonObjectSource,
  resolveLegacyBundles,
  stdioServerOptions,
  usageError,
  writePolicyOption,
} = require("./options");

async function loadIndex(args) {
  const remoteConfigs = args.remoteBundles.map(parseRemoteBundleArg);
  if (args.project) {
    const loaded = await loadProjectBundles(args.project);
    const remoteBundles = await fetchRemoteBundles(remoteConfigs);
    const index = buildIndex(loaded.bundles.concat(remoteBundles), {
      relationTypes: loaded.project.relationTypes,
      strictLinks: args.strictLinks || loaded.project.strictLinks,
    });
    return withSearchLanguages(
      attachProject(index, loaded.project),
      args.languages || loaded.project.languages,
    );
  }
  const bundles = resolveLegacyBundles(args);
  const fetchedRemoteBundles = await fetchRemoteBundles(remoteConfigs);
  if (!bundles.length && !fetchedRemoteBundles.length) {
    throw usageError("At least one --bundle root or --project config is required.");
  }
  return withSearchLanguages(
    buildIndex(bundles.concat(fetchedRemoteBundles), {
      strictLinks: args.strictLinks,
      allowCustomRelationTypes: true,
    }),
    args.languages,
  );
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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

async function runMcp(args, runtime) {
  const bundles = resolveLegacyBundles(args);
  const http = httpServerOptions(args, usageError);
  if (http) {
    if (!args.project && !bundles.length && !args.remoteBundles.length) {
      throw usageError("An OKF --root, --bundle, or --project source is required.");
    }
    const started = await (runtime?.runMcpHttpServer || runMcpHttpServer)(
      args.project ? [] : bundles,
      Object.assign(stdioServerOptions(args), { http }),
    );
    process.stderr.write(`OKF MCP HTTP server listening on ${started.url}\n`);
    return;
  }
  if (args.project) {
    await (runtime?.runStdioServer || runStdioServer)(
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
  await (runtime?.runStdioServer || runStdioServer)(
    bundles,
    process.stdin,
    process.stdout,
    stdioServerOptions(args),
  );
}

async function runServe(args, runtime) {
  if (!args.project && !args.root) {
    throw usageError("serve requires --root or --project.");
  }
  const result = await (runtime?.runHttpServer || runHttpServer)({
    projectPath: args.project,
    rootPath: args.root,
    host: args.host,
    port: args.port,
    writeToken: args.writeToken || process.env.OKF_WRITE_TOKEN || "",
    proposalRoot: args.proposalRoot || "",
    writePolicy: writePolicyOption(args),
  });
  process.stderr.write(`OKF HTTP server listening on ${result.url}\n`);
}

function runGenerate(args) {
  if (!args.project) {
    throw usageError("generate requires --project.");
  }
  const project = loadProjectConfig(args.project);
  printJson(generateProject(project));
}

async function runProducer(args) {
  if (!args.project) {
    throw usageError("producer requires --project.");
  }
  const action = args.positional[1] || "list";
  if (!PRODUCER_ACTIONS.has(action)) {
    throw usageError("producer action must be list, preview, or run.");
  }
  const loaded = await loadProjectBundles(args.project);
  const service = new ProducerService({
    project: loaded.project,
    store: FileConceptStore.fromProject(args.project, { proposalRoot: args.proposalRoot || "" }),
    bundles: (loaded.bundles || []).filter((bundle) => !bundle.remote),
  });
  if (action === "list") {
    printJson(service.list());
    return;
  }
  const name = args.positional[2];
  if (!name) {
    throw usageError(`producer ${action} requires a configured producer name.`);
  }
  if (action === "run" && !args.write) {
    throw usageError("producer run requires --write --actor <human:id|process:id|provider/model>.");
  }
  const receipt = action === "run" ? await service.run(name) : await service.preview(name);
  printJson(producerReceipt(receipt, "full"));
  const succeeded = action === "run" ? receipt.applied === true : receipt.valid === true;
  process.exitCode = succeeded ? 0 : 1;
}

function runValidate(index) {
  const result = validateIndex(index);
  printJson(result);
  process.exitCode = result.validForProject ? 0 : 1;
}

function runGraph(index, args) {
  process.stdout.write(
    `${exportGraph(index, {
      format: args.positional[1] || "json",
      includeExternal: args.includeExternal,
      includeAssets: args.includeAssets,
    })}\n`,
  );
}

function runSearch(index, args) {
  const filters = Object.assign({}, args.search, { query: args.positional.slice(1).join(" ") });
  if (!Object.keys(filters.frontmatter || {}).length) {
    delete filters.frontmatter;
  }
  printJson(searchConcepts(index, filters));
}

function runContext(index, args) {
  printJson(contextCli.runContext(index, args, usageError));
}

function runConcept(index, args, { repositoryMappings }) {
  const locator = args.positional[1];
  if (!locator) {
    throw usageError("concept requires a Concept ID or locator.");
  }
  const doc = requireValidConcept(index, locator);
  printJson(
    Object.assign(conceptSummary(doc), {
      frontmatter: doc.frontmatter,
      body: doc.body,
      links: doc.links,
      referencedAssets: (index.assets || [])
        .filter((asset) =>
          (asset.referencedBy || []).some((reference) => reference.uri === doc.uri),
        )
        .map((asset) => ({
          uri: asset.uri,
          path: asset.path,
          mimeType: asset.mimeType,
          size: asset.size,
          sha256: asset.sha256,
          roles: asset.roles,
        })),
      gitSources: describeConceptGitSources(index, doc, repositoryMappings),
    }),
  );
}

function runNeighbors(index, args) {
  if (!args.positional[1]) {
    throw usageError("neighbors requires a URI.");
  }
  const doc = requireValidConcept(index, args.positional[1]);
  printJson(
    getNeighbors(index, doc.uri, {
      includeAssets: args.includeAssets,
      includeExternal: args.includeExternal,
    }),
  );
}

function runPaths(index, args) {
  if (!args.positional[1] || !args.positional[2]) {
    throw usageError("paths requires <from> and <to> URIs.");
  }
  const source = requireValidConcept(index, args.positional[1]);
  const target = requireValidConcept(index, args.positional[2]);
  printJson(findPaths(index, source.uri, target.uri));
}

function runProvenance(index, args) {
  if (!args.positional[1]) {
    throw usageError("provenance requires a URI.");
  }
  printJson(getProvenance(index, args.positional[1], { includeExternal: args.includeExternal }));
}

function runEdgeKinds(index) {
  const counts = {};
  index.edges.forEach((edge) => {
    if (!counts[edge.kind]) {
      counts[edge.kind] = { total: 0, resolved: 0, broken: 0 };
    }
    counts[edge.kind].total += 1;
    counts[edge.kind][edge.broken ? "broken" : "resolved"] += 1;
  });
  printJson(counts);
}

function runComputation(index, args, { runtime }) {
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
      throw usageError(
        "Raw computation parameters are not accepted in argv; use --parameters-file <path|->.",
      );
    }
    const parameters = args.parametersFile
      ? readJsonObjectSource(args.parametersFile, "computation parameters", runtime)
      : null;
    if (!parameters) {
      throw usageError("computation prepare requires --parameters-file <path|->.");
    }
    printJson(prepareAttestedComputation(index, uri, parameters, { asOf: args.search.asOf }));
    return;
  }
  if (operation === "check-receipt") {
    if (args.positional[3]) {
      throw usageError(
        "Raw computation receipts are not accepted in argv; use --receipt-file <path|->.",
      );
    }
    const receipt = args.receiptFile
      ? readJsonObjectSource(args.receiptFile, "computation receipt", runtime)
      : null;
    if (!receipt) {
      throw usageError("computation check-receipt requires --receipt-file <path|->.");
    }
    printJson(checkComputationReceipt(index, uri, receipt));
    return;
  }
  throw usageError(`Unknown computation operation: ${operation}`);
}

function runAsset(index, args) {
  if (!args.positional[1]) {
    throw usageError("asset requires an okf-asset URI.");
  }
  printJson(
    readBundleAsset(index, {
      uri: args.positional[1],
      maxContentBytes: args.maxContentBytes,
    }),
  );
}

function runSource(index, args, { repositoryMappings }) {
  if (!args.positional[1] || !args.positional[2]) {
    throw usageError("source requires <concept-id-or-locator> and <source-id>.");
  }
  printJson(
    readConceptGitSource(index, args.positional[1], args.positional[2], repositoryMappings, {
      maxBytes: args.maxContentBytes,
    }),
  );
}

function runMigrate(index, args) {
  const operation = args.positional[1];
  if (!["check", "preview"].includes(operation)) {
    throw usageError("migrate requires check or preview.");
  }
  let bundleArgument = args.positional[2] || "";
  let actorMappingsArgument = args.positional[3] || "";
  if (
    operation === "preview" &&
    index.bundles.length === 1 &&
    !actorMappingsArgument &&
    bundleArgument.trim().startsWith("{")
  ) {
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
  const result =
    operation === "check"
      ? checkV02Migration(index, { bundle, actorMappings, generatedPaths: args.generatedPaths })
      : buildV02MigrationPlan(index, {
          bundle,
          actorMappings,
          generatedPaths: args.generatedPaths,
        });
  printJson(result);
  const report = operation === "check" ? result : result.report;
  process.exitCode = report.blockers.length ? 1 : 0;
}

// Commands that start a server or work from the project configuration.
const SOURCE_COMMANDS = {
  mcp: runMcp,
  serve: runServe,
  generate: runGenerate,
  producer: runProducer,
};

// Commands that read one loaded index: (index, args, { runtime, repositoryMappings }).
const INDEX_COMMANDS = {
  validate: runValidate,
  graph: runGraph,
  search: runSearch,
  context: runContext,
  concept: runConcept,
  neighbors: runNeighbors,
  paths: runPaths,
  provenance: runProvenance,
  "edge-kinds": runEdgeKinds,
  computation: runComputation,
  asset: runAsset,
  source: runSource,
  migrate: runMigrate,
};

// Runs the command named by the parsed arguments (after --help, --version and
// project discovery have been handled by the entry point).
async function runCommand(args, runtime) {
  if (args.inspect) {
    printJson(graphSummary(await loadIndex(args)));
    return;
  }
  const command = args.positional[0] || "mcp";
  if (!COMMANDS.has(command)) {
    throw usageError(`Unknown OKF command: ${command}`);
  }
  if (!WRITE_COMMANDS.has(command) && (args.write || args.actor || args.gitCommit)) {
    throw usageError(
      "--write, --actor, and --git-commit are available only with the mcp and producer commands.",
    );
  }
  if (command === "producer" && args.gitCommit) {
    throw usageError("--git-commit is available only with the mcp command.");
  }
  if (command === "producer" && args.policy) {
    throw usageError("--policy is available only with the mcp command.");
  }
  if (command !== "mcp" && args.http.enabled) {
    throw usageError("--http is available only with the mcp command.");
  }
  if (SOURCE_COMMANDS[command]) {
    await SOURCE_COMMANDS[command](args, runtime);
    return;
  }
  const index = await loadIndex(args);
  const repositoryMappings = parseRepositoryMappings(args.repositories);
  const handler = INDEX_COMMANDS[command];
  if (!handler) {
    throw usageError(`Unknown OKF command: ${command}`);
  }
  await handler(index, args, { runtime, repositoryMappings });
}

module.exports = { runCommand };
