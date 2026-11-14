"use strict";

// Entry point of the okf / okf-mcp binary: parse the arguments, answer
// --help and --version, discover the project, and run the command. Option
// parsing lives in src/cli/options.js, the usage text in src/cli/usage.js
// and the command handlers in src/cli/commands.js.

const embeddingCli = require("./search/embedding-cli");
const { runCommand } = require("./cli/commands");
const {
  UsageError,
  discoverProject,
  exitCodeForError,
  parseArgs,
  stdioServerOptions,
  usageError,
} = require("./cli/options");
const { usage } = require("./cli/usage");
const packageMetadata = require("../package.json");

async function main(argv, runtime) {
  const split = embeddingCli.splitEmbeddingArgs(argv || []);
  const args = Object.assign(parseArgs(split.argv), { embedding: split.embedding });
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
  discoverProject(args, runtime?.cwd || process.cwd());
  await runCommand(args, runtime);
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
