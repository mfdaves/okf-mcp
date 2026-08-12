#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { buildIndex } = require("../src/indexer");
const { searchConcepts } = require("../src/search");
const { prepareSearchIndex } = require("../src/search-index");

function usage() {
  return [
    "Usage: node --expose-gc scripts/search-benchmark.js --root <okf-directory> [options]",
    "",
    "Options:",
    "  --qrels <json>   JSON array of { query, expected } relevance judgments.",
    "  --rounds <n>     Measured rounds over the query set (default 100).",
    "  --help           Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { root: "", qrels: "", rounds: 100 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--root" || argument === "--qrels" || argument === "--rounds") {
      const value = argv[index + 1];
      if (!value) {
        throw new TypeError(`${argument} requires a value.`);
      }
      options[argument.slice(2)] = argument === "--rounds" ? Number(value) : value;
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown option: ${argument}`);
  }
  if (!options.help && !options.root) {
    throw new TypeError("--root is required.");
  }
  if (!Number.isSafeInteger(options.rounds) || options.rounds < 1 || options.rounds > 10000) {
    throw new TypeError("--rounds must be an integer from 1 through 10000.");
  }
  return options;
}

function loadQrels(file) {
  if (!file) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (!Array.isArray(parsed) || parsed.some((entry) => (
    !entry
    || typeof entry.query !== "string"
    || !entry.query.trim()
    || typeof entry.expected !== "string"
    || !entry.expected.trim()
  ))) {
    throw new TypeError("--qrels must contain a JSON array of { query, expected } strings.");
  }
  return parsed;
}

function collectMemory() {
  if (global.gc) {
    global.gc();
  }
  return process.memoryUsage();
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function matchesExpected(result, expected) {
  const value = String(expected);
  return [result.uri, result.pathUri, result.path, result.conceptId].includes(value);
}

function evaluate(index, qrels) {
  if (!qrels.length) {
    return null;
  }
  let reciprocalRank = 0;
  let recalled = 0;
  let topOne = 0;
  const cases = qrels.map(({ query, expected }) => {
    const results = searchConcepts(index, { query, limit: 10 }).results;
    const rank = results.findIndex((result) => matchesExpected(result, expected)) + 1;
    if (rank > 0) {
      recalled += 1;
      reciprocalRank += 1 / rank;
      if (rank === 1) {
        topOne += 1;
      }
    }
    return {
      query,
      expected,
      rank: rank || null,
      top: results.slice(0, 3).map((result) => result.path),
    };
  });
  return {
    queries: qrels.length,
    recallAt10: recalled / qrels.length,
    mrrAt10: reciprocalRank / qrels.length,
    top1: topOne / qrels.length,
    cases,
  };
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const root = path.resolve(options.root);
  const qrels = loadQrels(options.qrels);
  const parseStarted = performance.now();
  const index = buildIndex([root], { allowCustomRelationTypes: true });
  const parseMs = performance.now() - parseStarted;

  const before = collectMemory();
  const searchBuildStarted = performance.now();
  prepareSearchIndex(index);
  const searchBuildMs = performance.now() - searchBuildStarted;
  const after = collectMemory();

  const queries = qrels.length
    ? qrels.map((entry) => entry.query)
    : index.concepts.map((concept) => concept.title).filter(Boolean).slice(0, 50);
  if (!queries.length) {
    throw new TypeError("The benchmark root contains no titled concepts or qrels queries.");
  }
  for (let warmup = 0; warmup < 3; warmup += 1) {
    queries.forEach((query) => searchConcepts(index, { query, limit: 10 }));
  }
  const timings = [];
  for (let round = 0; round < options.rounds; round += 1) {
    queries.forEach((query) => {
      const started = performance.now();
      searchConcepts(index, { query, limit: 10 });
      timings.push(performance.now() - started);
    });
  }

  const output = {
    environment: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      exposedGc: typeof global.gc === "function",
    },
    corpus: {
      root,
      markdownDocuments: index.documents.length,
      concepts: index.concepts.length,
      searchableBytes: index.concepts.reduce((total, concept) => total + Buffer.byteLength([
        concept.title,
        concept.type,
        (concept.tags || []).join(" "),
        (concept.aliases || []).join(" "),
        concept.description,
        concept.path,
        concept.body,
      ].join("\n")), 0),
      validForProject: index.validForProject,
    },
    build: {
      okfIndexMs: parseMs,
      searchIndexMs: searchBuildMs,
      retainedHeapBytes: after.heapUsed - before.heapUsed,
      retainedRssBytes: after.rss - before.rss,
    },
    query: {
      queries: queries.length,
      samples: timings.length,
      p50Ms: percentile(timings, 0.5),
      p95Ms: percentile(timings, 0.95),
      maxMs: timings.reduce((maximum, value) => Math.max(maximum, value), 0),
    },
    relevance: evaluate(index, qrels),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage()}\n`);
  process.exitCode = 1;
}
