"use strict";

// The `context` command of the CLI (plan WP3a, section 12), kept out of
// src/cli.js so its line ratchet only shrinks: the token budget and section
// cap flags, plus the dispatch. The search filters are parsed by the `search`
// command's flag parser and shared. `parseContextOption` consumes one flag at
// `argv[index]` into `context` and returns how many extra arguments it used,
// or -1 when the flag is not a context option; `fail` builds the CLI usage
// error.

const { assembleContext } = require("./assemble");

const OPTIONS = Object.freeze({ "--budget": "budgetTokens", "--limit": "limit" });
const POSITIVE_INTEGER = /^[1-9]\d*$/;

function createContextOptions() {
  return {};
}

function parseContextOption(arg, argv, index, context, fail) {
  if (!Object.hasOwn(OPTIONS, arg)) {
    return -1;
  }
  const value = argv[index + 1];
  if (!value || !POSITIVE_INTEGER.test(value)) {
    throw fail(`${arg} requires a positive integer.`);
  }
  context[OPTIONS[arg]] = Number(value);
  return 1;
}

// Positional words after the command form the query; the parsed search
// filters and context flags become the options of assembleContext.
function contextRequest(args, fail) {
  const query = (args.positional || []).slice(1).join(" ").trim();
  if (!query) {
    throw fail("context requires a query.");
  }
  const request = Object.assign({}, args.search, args.context, { query });
  if (!Object.keys(request.frontmatter || {}).length) {
    delete request.frontmatter;
  }
  return request;
}

function runContextCommand(index, args, fail) {
  return assembleContext(index, contextRequest(args, fail));
}

module.exports = {
  contextRequest,
  createContextOptions,
  parseContextOption,
  runContextCommand,
};
