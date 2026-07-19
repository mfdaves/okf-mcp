"use strict";

const {
  attachProject,
  buildIndex,
  buildProjectIndexAsync,
  loadProjectBundles,
  validateIndex,
} = require("./indexer");
const { exportGraph, findPaths, getNeighbors, graphSummary } = require("./graph");
const { searchConcepts } = require("./search");
const { conceptSummary } = require("./indexer");
const { findProjectConfig, loadProjectConfig } = require("./project");
const { generateProject } = require("./plugins");
const { runStdioServer } = require("./mcp-server");
const { fetchRemoteBundles } = require("./remote");
const { runHttpServer } = require("./http-server");
const packageMetadata = require("../package.json");

const COMMANDS = new Set(["mcp", "validate", "graph", "search", "concept", "neighbors", "paths", "generate", "serve"]);

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

function exitCodeForError(error) {
  return error && error.exitCode === 2 ? 2 : 1;
}

function parseArgs(argv) {
  const bundles = [];
  const remoteBundles = [];
  const positional = [];
  let project = null;
  let inspect = false;
  let help = false;
  let host = "127.0.0.1";
  let port = 8765;
  let writeToken = "";
  let proposalRoot = "";
  let version = false;
  let authoring = false;
  let allowRemoteTool = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    if (arg === "--inspect") {
      inspect = true;
      continue;
    }
    if (arg === "--authoring") {
      authoring = true;
      continue;
    }
    if (arg === "--allow-remote-tool") {
      allowRemoteTool = true;
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
  return {
    bundles,
    remoteBundles,
    positional,
    project,
    inspect,
    help,
    version,
    authoring,
    allowRemoteTool,
    host,
    port,
    writeToken,
    proposalRoot,
  };
}

function usage() {
  return [
    "okf-mcp / okf",
    "",
    "Usage:",
    "  okf-mcp --bundle <path-or-id=path> [--bundle <path>] [--inspect]",
    "  okf-mcp --remote-bundle <id=github-tree-url> [--inspect]",
    "  okf-mcp --project <okf.project.yaml> <command>",
    "  okf-mcp [--project <okf.project.yaml>] [--authoring] [--allow-remote-tool] mcp",
    "  okf-mcp --project <okf.project.yaml> serve [--host 127.0.0.1] [--port 8765]",
    "  okf-mcp <command> --bundle <path-or-id=path>",
    "",
    "Commands:",
    "  mcp                         Start the stdio MCP server.",
    "  validate                    Validate project or bundles.",
    "  graph [json|dot|mermaid]    Export graph.",
    "  search <query>              Search concepts.",
    "  concept <uri>               Print one concept.",
    "  neighbors <uri>             Print inbound/outbound neighbors.",
    "  paths <from> <to>           Find directed paths.",
    "  generate                    Run configured generator plugins.",
    "  serve                       Start the HTTP OKF API server.",
    "",
    "Options:",
    "  --authoring                 Enable MCP proposal authoring tools.",
    "  --allow-remote-tool         Enable runtime remote-bundle loading over MCP.",
    "  --version, -v               Print the package version.",
    "  --help, -h                  Print this help.",
    "  --debug                     Include stack traces in error output.",
    "",
    "When no project or bundle source is passed, the nearest okf.project.yaml",
    "or okf.project.json is discovered from the current directory.",
    "",
    "Examples:",
    "  node bin/okf-mcp.js --bundle ./okf/bundles/app --inspect",
    "  node bin/okf-mcp.js --bundle app=./okf/bundles/app",
    "  node bin/okf-mcp.js --remote-bundle docs=https://github.com/org/repo/tree/main/okf/bundles/docs --inspect",
    "  node bin/okf-mcp.js --project okf.project.yaml validate",
    "",
  ].join("\n");
}

function resolveLegacyBundles(args) {
  if (args.bundles.length) {
    return args.bundles;
  }
  if (!args.positional.length) {
    return [];
  }
  const first = args.positional[0];
  return COMMANDS.has(first) ? [] : args.positional;
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
  if (!args.project && !args.bundles.length && !args.remoteBundles.length && !resolveLegacyBundles(args).length) {
    args.project = findProjectConfig(startDir);
  }
  return args;
}

function stdioServerOptions(args) {
  const options = {
    remoteBundles: args.remoteBundles.map(parseRemoteBundleArg),
    allowAuthoring: Boolean(args.authoring),
    allowRuntimeRemoteLoad: Boolean(args.allowRemoteTool),
  };
  if (args.project) {
    options.projectPath = args.project;
  }
  return options;
}

async function loadIndex(args) {
  const remoteConfigs = args.remoteBundles.map(parseRemoteBundleArg);
  if (args.project) {
    if (!remoteConfigs.length) {
      return buildProjectIndexAsync(args.project);
    }
    const loaded = await loadProjectBundles(args.project);
    const remoteBundles = await fetchRemoteBundles(remoteConfigs);
    const index = buildIndex(loaded.bundles.concat(remoteBundles), { relationTypes: loaded.project.relationTypes });
    return attachProject(index, loaded.project);
  }
  const bundles = resolveLegacyBundles(args);
  const fetchedRemoteBundles = await fetchRemoteBundles(remoteConfigs);
  if (!bundles.length && !fetchedRemoteBundles.length) {
    throw usageError("At least one --bundle root or --project config is required.");
  }
  return buildIndex(bundles.concat(fetchedRemoteBundles));
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
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
  discoverProject(args, (runtime && runtime.cwd) || process.cwd());
  if (args.inspect) {
    printJson(graphSummary(await loadIndex(args)));
    return;
  }
  const command = args.positional[0] || "mcp";
  if (!COMMANDS.has(command)) {
    throw usageError(`Unknown OKF command: ${command}`);
  }
  if (command === "mcp") {
    const bundles = resolveLegacyBundles(args);
    if (args.project) {
      const server = await ((runtime && runtime.runStdioServer) || runStdioServer)(
        [],
        process.stdin,
        process.stdout,
        stdioServerOptions(args),
      );
      if (server && server.closed) {
        await server.closed;
      }
      return;
    }
    if (!bundles.length && !args.remoteBundles.length) {
      throw usageError("At least one --bundle root or --project config is required.");
    }
    const server = await ((runtime && runtime.runStdioServer) || runStdioServer)(
      bundles,
      process.stdin,
      process.stdout,
      stdioServerOptions(args),
    );
    if (server && server.closed) {
      await server.closed;
    }
    return;
  }
  if (command === "serve") {
    if (!args.project) {
      throw usageError("serve requires --project.");
    }
    const result = await runHttpServer({
      projectPath: args.project,
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
  if (command === "validate") {
    const result = validateIndex(index);
    printJson(result);
    process.exitCode = result.validForProject ? 0 : 1;
    return;
  }
  if (command === "graph") {
    process.stdout.write(exportGraph(index, { format: args.positional[1] || "json", includeExternal: true }) + "\n");
    return;
  }
  if (command === "search") {
    printJson(searchConcepts(index, { query: args.positional.slice(1).join(" ") }));
    return;
  }
  if (command === "concept") {
    const uri = args.positional[1];
    if (!uri) {
      throw usageError("concept requires a URI.");
    }
    const doc = index.byUri.get(uri);
    if (!doc) {
      throw new Error(`Unknown OKF concept URI: ${uri || "<missing>"}`);
    }
    printJson(Object.assign(conceptSummary(doc), { frontmatter: doc.frontmatter, body: doc.body, links: doc.links }));
    return;
  }
  if (command === "neighbors") {
    if (!args.positional[1]) {
      throw usageError("neighbors requires a URI.");
    }
    printJson(getNeighbors(index, args.positional[1]));
    return;
  }
  if (command === "paths") {
    if (!args.positional[1] || !args.positional[2]) {
      throw usageError("paths requires <from> and <to> URIs.");
    }
    printJson(findPaths(index, args.positional[1], args.positional[2]));
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
