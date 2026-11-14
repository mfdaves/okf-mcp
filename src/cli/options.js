"use strict";

// Command-line option parsing for the okf / okf-mcp binary: the flag grammar,
// the usage-error type with exit code 2, legacy bundle resolution, project
// discovery, and the options handed to the stdio MCP server. Split out of
// src/cli.js (Q-1); src/cli.js keeps the entry point.

const fs = require("node:fs");

const { findOkfRoot, findProjectConfig } = require("../project");
const { normalizeLanguages } = require("../search/languages");
const { loadWritePolicyFile } = require("../policy/write-policy");
const embeddingCli = require("../search/embedding-cli");
const { createSearchOptions } = require("../search/cli-options");
const contextCli = require("../context/cli-options");
const { validActor } = require("../v02");

const COMMANDS = new Set([
  "mcp",
  "validate",
  "graph",
  "search",
  "context",
  "concept",
  "neighbors",
  "paths",
  "generate",
  "serve",
  "provenance",
  "edge-kinds",
  "computation",
  "asset",
  "source",
  "migrate",
  "producer",
]);
const PRODUCER_ACTIONS = new Set(["list", "preview", "run"]);
const WRITE_COMMANDS = new Set(["mcp", "producer"]);

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
  } catch {
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
    const readFileSync = runtime?.readFileSync ? runtime.readFileSync : fs.readFileSync;
    text = readFileSync(source === "-" ? 0 : source, "utf8");
  } catch {
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
  let policy = "";
  let gitCommit = false;
  let allowRemoteTool = false;
  let strictLinks = false;
  let languages = "";
  let allowComputationAuthoring = false;
  let includeAssets = false;
  let includeExternal = false;
  let parametersFile = "";
  let receiptFile = "";
  let maxContentBytes = 65536;
  const generatedPaths = [];
  const search = createSearchOptions();
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
    if (arg === "--policy" || arg.startsWith("--policy=")) {
      const inline = arg.startsWith("--policy=");
      const value = inline ? arg.slice("--policy=".length) : argv[index + 1];
      if (policy) throw usageError("--policy may be supplied only once.");
      if (!value || (!inline && value.startsWith("-")))
        throw usageError("--policy requires a value.");
      policy = value;
      index += inline ? 0 : 1;
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
    if (arg === "--languages") {
      if (!argv[index + 1] || String(argv[index + 1]).startsWith("-")) {
        throw usageError("--languages requires auto, none, or language codes such as it,en.");
      }
      try {
        normalizeLanguages(argv[index + 1]);
      } catch (error) {
        throw usageError(`--languages: ${error.message}`);
      }
      languages = argv[index + 1];
      index += 1;
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
    const consumed = contextCli.parseCommandOption(arg, argv, index, search, usageError);
    if (consumed >= 0) {
      index += consumed;
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
    if (arg?.startsWith("-")) {
      throw usageError(`Unknown option: ${arg}`);
    }
    if (arg && !arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  if (write && !actor) {
    throw usageError("--write requires --actor <human:id|process:id|provider/model>.");
  }
  if (actor && !validActor(actor)) {
    throw usageError("--actor must use human:<id>, process:<id>, or provider/model syntax.");
  }
  if (actor && !write && !authoring) {
    throw usageError("--actor requires --write or --authoring.");
  }
  if (gitCommit && !write) {
    throw usageError("--git-commit requires --write.");
  }
  if (policy && !write && !authoring) {
    throw usageError("--policy requires --write or --authoring.");
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
    policy,
    gitCommit,
    allowRemoteTool,
    allowComputationAuthoring,
    strictLinks,
    languages,
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
    const conceptId =
      separator > 0 ? text.slice(0, separator).replace(/^\/+/, "").replace(/\.md$/i, "") : "";
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

function parseRemoteBundleArg(value) {
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
  if (
    !args.project &&
    !args.root &&
    !args.bundles.length &&
    !args.remoteBundles.length &&
    !resolveLegacyBundles(args).length
  ) {
    args.root = findOkfRoot(startDir);
    if (!args.root) {
      args.project = findProjectConfig(startDir);
    }
  }
  return args;
}

// --policy: the --root counterpart of writePolicy, for stdio and HTTP alike.
function writePolicyOption(args) {
  if (args.policy && !args.root) {
    throw usageError("--policy requires --root; declare writePolicy in okf.project.yaml instead.");
  }
  return args.policy ? loadWritePolicyFile(args.policy) : undefined;
}

function stdioServerOptions(args) {
  const repositoryMappings = parseRepositoryMappings(args.repositories);
  const options = {
    remoteBundles: args.remoteBundles.map(parseRemoteBundleArg),
    allowAuthoring: Boolean(args.authoring),
    allowRuntimeRemoteLoad: Boolean(args.allowRemoteTool),
  };
  if (repositoryMappings.size) options.repositoryMappings = repositoryMappings;
  if (args.authoring && args.allowComputationAuthoring) options.allowComputationAuthoring = true;
  if (args.actor) options.actor = args.actor;
  if (args.write) {
    options.allowWrite = true;
    if (args.gitCommit) {
      options.gitCommit = true;
    }
  }
  if (args.strictLinks) options.strictLinks = true;
  if (args.policy) options.writePolicy = writePolicyOption(args);
  if (args.languages) options.languages = args.languages;
  Object.assign(options, embeddingCli.embeddingServerOptions(args));
  if (args.proposalRoot) options.proposalRoot = args.proposalRoot;
  if (args.project) {
    options.projectPath = args.project;
  } else if (args.root) {
    options.rootPath = args.root;
  }
  return options;
}

module.exports = {
  COMMANDS,
  PRODUCER_ACTIONS,
  UsageError,
  WRITE_COMMANDS,
  discoverProject,
  exitCodeForError,
  parseArgs,
  parseJsonObject,
  parseRemoteBundleArg,
  parseRepositoryMappings,
  readJsonObjectSource,
  resolveLegacyBundles,
  stdioServerOptions,
  usageError,
  writePolicyOption,
};
