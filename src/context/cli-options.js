"use strict";

// The `context` command of the CLI (plan WP3a, section 12), kept out of
// src/cli.js so its line ratchet only shrinks: the token budget, section cap
// and provenance flags, plus the dispatch. `parseCommandOption` is the one
// flag hook src/cli.js calls for both commands: it tries the `search` flag
// parser (whose filters `context` shares) and then the context flags, and
// returns how many extra arguments it used, or -1 when the flag is neither.
// Context flags are kept on the parsed search options as a non-enumerable
// `context` record, so nothing else that spreads the search options sees
// them; `contextOptions(args)` reads them back. `fail` builds the CLI usage
// error.

const { parseSearchOption } = require("../search/cli-options");
const { PROVENANCE_MODES, assembleContext } = require("./assemble");

const OPTIONS = Object.freeze({ "--budget": "budgetTokens", "--limit": "limit" });
const POSITIVE_INTEGER = /^[1-9]\d*$/;

// The context record of a parsed search-options object, created on demand.
function contextRecord(search) {
  if (!Object.hasOwn(search, "context")) {
    Object.defineProperty(search, "context", { value: {}, enumerable: false });
  }
  return search.context;
}

function parseContextOption(arg, argv, index, context, fail) {
  if (arg === "--provenance") {
    const mode = argv[index + 1];
    if (!PROVENANCE_MODES.includes(mode)) {
      throw fail(`--provenance requires one of ${PROVENANCE_MODES.join(", ")}.`);
    }
    context.provenance = mode;
    return 1;
  }
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

function parseCommandOption(arg, argv, index, search, fail) {
  const consumed = parseSearchOption(arg, argv, index, search, fail);
  if (consumed >= 0) {
    return consumed;
  }
  if (arg !== "--provenance" && !Object.hasOwn(OPTIONS, arg)) {
    return -1;
  }
  return parseContextOption(arg, argv, index, contextRecord(search), fail);
}

// The context flags parsed into `args` (empty when none were given).
function contextOptions(args) {
  return Object.assign({}, args?.search?.context);
}

// Positional words after the command form the query; the parsed search
// filters and context flags become the options of assembleContext.
function contextRequest(args, fail) {
  const query = (args.positional || []).slice(1).join(" ").trim();
  if (!query) {
    throw fail("context requires a query.");
  }
  const request = Object.assign({}, args.search, contextOptions(args), { query });
  if (!Object.keys(request.frontmatter || {}).length) {
    delete request.frontmatter;
  }
  return request;
}

function runContext(index, args, fail) {
  return assembleContext(index, contextRequest(args, fail));
}

module.exports = {
  contextOptions,
  contextRequest,
  parseCommandOption,
  parseContextOption,
  runContext,
};
