"use strict";

const { attachProject, buildIndex, buildProjectIndexAsync, loadProjectBundles } = require("./indexer");
const { exportGraph, findPaths, getNeighbors, graphSummary } = require("./graph");
const { searchConcepts } = require("./search");
const { conceptSummary } = require("./indexer");
const { loadProjectConfig } = require("./project");
const { generateProject } = require("./plugins");
const { runStdioServer } = require("./mcp-server");
const { fetchRemoteBundles } = require("./remote");
const { runHttpServer } = require("./http-server");

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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle" || arg === "-b") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw new Error(`${arg} requires a value.`);
      }
      bundles.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--bundle=")) {
      bundles.push(arg.slice("--bundle=".length));
      continue;
    }
    if (arg === "--remote-bundle") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw new Error(`${arg} requires a value.`);
      }
      remoteBundles.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--remote-bundle=")) {
      remoteBundles.push(arg.slice("--remote-bundle=".length));
      continue;
    }
    if (arg === "--project" || arg === "-p") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw new Error(`${arg} requires a value.`);
      }
      project = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--project=")) {
      project = arg.slice("--project=".length);
      continue;
    }
    if (arg === "--inspect") {
      inspect = true;
      continue;
    }
    if (arg === "--host") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw new Error(`${arg} requires a value.`);
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
        throw new Error(`${arg} requires a value.`);
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
        throw new Error(`${arg} requires a value.`);
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
        throw new Error(`${arg} requires a value.`);
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
    if (arg && !arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  return { bundles, remoteBundles, positional, project, inspect, help, host, port, writeToken, proposalRoot };
}

function usage() {
  return [
    "okf-mcp / okf",
    "",
    "Usage:",
    "  okf-mcp --bundle <path-or-id=path> [--bundle <path>] [--inspect]",
    "  okf-mcp --remote-bundle <id=github-tree-url> [--inspect]",
    "  okf-mcp --project <okf.project.yaml> <command>",
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
  const commands = new Set(["mcp", "validate", "graph", "search", "concept", "neighbors", "paths", "generate", "serve"]);
  return commands.has(first) ? [] : args.positional;
}

function parseRemoteBundleArg(value, index) {
  const text = String(value || "");
  const eq = text.indexOf("=");
  if (eq <= 0) {
    throw new Error("--remote-bundle value must use id=https://github.com/... format.");
  }
  return {
    id: text.slice(0, eq),
    provider: "github",
    url: text.slice(eq + 1),
  };
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
    throw new Error("At least one --bundle root or --project config is required.");
  }
  return buildIndex(bundles.concat(fetchedRemoteBundles));
}

function validate(index) {
  return {
    valid: index.errors.length === 0 && index.warnings.filter((warning) => warning.code === "missing_type" || warning.code === "missing_frontmatter").length === 0,
    errors: index.errors,
    warnings: index.warnings,
  };
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

async function main(argv) {
  const args = parseArgs(argv || []);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (args.inspect) {
    printJson(graphSummary(await loadIndex(args)));
    return;
  }
  const command = args.positional[0] || "mcp";
  if (command === "mcp") {
    const bundles = resolveLegacyBundles(args);
    if (args.project) {
      await runStdioServer([], process.stdin, process.stdout, { projectPath: args.project, remoteBundles: args.remoteBundles.map(parseRemoteBundleArg) });
      return;
    }
    if (!bundles.length && !args.remoteBundles.length) {
      throw new Error("At least one --bundle root or --project config is required.");
    }
    await runStdioServer(bundles, process.stdin, process.stdout, { remoteBundles: args.remoteBundles.map(parseRemoteBundleArg) });
    return;
  }
  if (command === "serve") {
    if (!args.project) {
      throw new Error("serve requires --project.");
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
      throw new Error("generate requires --project.");
    }
    const project = loadProjectConfig(args.project);
    printJson(generateProject(project));
    return;
  }
  const index = await loadIndex(args);
  if (command === "validate") {
    const result = validate(index);
    printJson(result);
    process.exitCode = result.valid ? 0 : 1;
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
      throw new Error("concept requires a URI.");
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
      throw new Error("neighbors requires a URI.");
    }
    printJson(getNeighbors(index, args.positional[1]));
    return;
  }
  if (command === "paths") {
    if (!args.positional[1] || !args.positional[2]) {
      throw new Error("paths requires <from> and <to> URIs.");
    }
    printJson(findPaths(index, args.positional[1], args.positional[2]));
    return;
  }
  throw new Error(`Unknown OKF command: ${command}`);
}

module.exports = {
  main,
  parseArgs,
  usage,
};
