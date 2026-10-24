"use strict";

// Command-line flags of the `search` command (owned with the search output,
// plan section 12). `parseSearchOption` consumes one flag at `argv[index]`
// into `search` and returns how many extra arguments it used, or -1 when the
// flag is not a search option; `fail` builds the CLI usage error.

const LIST_OPTIONS = Object.freeze({
  "--type": "types",
  "--tag": "tagsAny",
  "--status": "statuses",
  "--trust-tier": "trustTiers",
  "--freshness": "freshness",
});

const SCALAR_OPTIONS = Object.freeze({
  "--as-of": "asOf",
  "--runtime": "runtime",
  "--linked-to": "linkedTo",
  "--linked-from": "linkedFrom",
  "--relation-type": "relationType",
  "--path-prefix": "pathPrefix",
  "--mode": "mode",
  "--min-coverage": "minCoverage",
  "--min-relevance": "minRelevance",
});

const FLAG_OPTIONS = Object.freeze({
  "--has-sources": (search) => {
    search.hasSources = true;
  },
  "--no-sources": (search) => {
    search.hasSources = false;
  },
  "--attestation-ready": (search) => {
    search.attestationReady = true;
  },
  "--orphan-only": (search) => {
    search.orphanOnly = true;
  },
  "--freshness-prior": (search) => {
    search.freshnessPrior = true;
  },
});

function createSearchOptions() {
  return {
    types: [],
    tagsAny: [],
    statuses: [],
    trustTiers: [],
    freshness: [],
    frontmatter: {},
  };
}

function hasOwn(object, key) {
  return Object.hasOwn(object, key);
}

function requireValue(arg, argv, index, fail) {
  const value = argv[index + 1];
  if (!value || String(value).startsWith("-")) {
    throw fail(`${arg} requires a value.`);
  }
  return value;
}

function parseSearchOption(arg, argv, index, search, fail) {
  if (hasOwn(LIST_OPTIONS, arg)) {
    search[LIST_OPTIONS[arg]].push(requireValue(arg, argv, index, fail));
    return 1;
  }
  if (hasOwn(SCALAR_OPTIONS, arg)) {
    search[SCALAR_OPTIONS[arg]] = requireValue(arg, argv, index, fail);
    return 1;
  }
  if (arg === "--frontmatter") {
    const value = argv[index + 1];
    const separator = value?.indexOf("=");
    if (!value || separator <= 0) {
      throw fail("--frontmatter requires key=value.");
    }
    search.frontmatter[value.slice(0, separator)] = value.slice(separator + 1);
    return 1;
  }
  if (hasOwn(FLAG_OPTIONS, arg)) {
    FLAG_OPTIONS[arg](search);
    return 0;
  }
  return -1;
}

// Search stemming languages for an index built by the CLI: --languages wins,
// then the project config; the lexical index detects per bundle otherwise.
function withSearchLanguages(index, languages) {
  if (languages !== undefined && languages !== "") {
    index.languages = languages;
  }
  return index;
}

module.exports = {
  createSearchOptions,
  parseSearchOption,
  withSearchLanguages,
};
