#!/usr/bin/env node
"use strict";

// Writes the pre-registered dev / held-out split into a fixture's queries.json.
//
//   node test/fixtures/retrieval/assign-split.js --fixture alpinaria [--seed 20261024] [--ratio 0.7]
//
// The split is stratified by category x language (see lib/split.js). The seed and ratio are
// recorded under `split` in the sidecar so the test can re-derive and assert the assignment.
// Re-running with the same arguments is a no-op; queries added later only reshuffle their own
// stratum, so the split is re-assigned deliberately, never on the fly.

const fs = require("node:fs");
const path = require("node:path");

const { DEFAULT_DEV_RATIO, DEFAULT_SEED, assignSplit, splitCounts } = require("./lib/split");

function parseArgs(argv) {
  const options = { fixture: "", seed: DEFAULT_SEED, ratio: DEFAULT_DEV_RATIO };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--fixture" && value) {
      options.fixture = value;
      index += 1;
    } else if (argument === "--seed" && value) {
      options.seed = Number(value);
      index += 1;
    } else if (argument === "--ratio" && value) {
      options.ratio = Number(value);
      index += 1;
    } else {
      throw new TypeError(`Unknown or incomplete option: ${argument}`);
    }
  }
  if (!options.fixture) {
    throw new TypeError("--fixture <name|path> is required.");
  }
  if (!Number.isInteger(options.seed)) {
    throw new TypeError("--seed must be an integer.");
  }
  if (!(options.ratio > 0 && options.ratio < 1)) {
    throw new TypeError("--ratio must be between 0 and 1.");
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const fixtureRoot = fs.existsSync(path.resolve(options.fixture))
    ? path.resolve(options.fixture)
    : path.join(__dirname, options.fixture);
  const file = path.join(fixtureRoot, "queries.json");
  const sidecar = JSON.parse(fs.readFileSync(file, "utf8"));
  const assignment = assignSplit(sidecar.queries, { seed: options.seed, devRatio: options.ratio });
  sidecar.split = {
    seed: options.seed,
    devRatio: options.ratio,
    strata: "category x lang",
    unit: "paraphrase family (queries sharing `family`) or single query; a family never spans both splits",
  };
  sidecar.queries = sidecar.queries.map((query) => {
    const next = {};
    // Keep `split` right after `category` so diffs stay readable.
    Object.keys(query).forEach((key) => {
      if (key === "split") {
        return;
      }
      next[key] = query[key];
      if (key === "category") {
        next.split = assignment.get(query.id);
      }
    });
    if (!next.split) {
      next.split = assignment.get(query.id);
    }
    return next;
  });
  fs.writeFileSync(file, `${JSON.stringify(sidecar, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(Object.assign({ file, total: sidecar.queries.length }, splitCounts(sidecar.queries)))}\n`);
}

main(process.argv.slice(2));
