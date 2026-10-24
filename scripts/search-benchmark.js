#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { buildIndex, sanitizeBundleId } = require("../src/indexer");
const { searchConcepts } = require("../src/search");
const { prepareSearchIndex } = require("../src/search-index");

function usage() {
  return [
    "Usage: node --expose-gc scripts/search-benchmark.js --root <okf-directory> [options]",
    "",
    "Options:",
    "  --qrels <json>   Relevance judgments: [{ query, expected }] rows (expected = Concept ID or",
    "                   graded [{ id, grade }]) or a fixture sidecar { queries: [...] } as under",
    "                   test/fixtures/retrieval; graded rows add nDCG@10.",
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

// Accepts the flat `[{ query, expected }]` shape (one expected Concept ID, grade 2), flat rows
// with graded `expected: [{ id, grade }]`, or a fixture sidecar `{ queries: [...] }` as under
// test/fixtures/retrieval. Sidecar entries carry a bundle id: only entries for the benchmarked
// root's bundle are kept, and queries left without an expected concept (no-answer queries,
// other bundles) are skipped because the benchmark measures ranking, not abstention.
function normalizeExpected(expected, bundleId) {
  if (typeof expected === "string") {
    return expected.trim() ? [{ id: expected.trim(), grade: 2 }] : null;
  }
  if (!Array.isArray(expected)) {
    return null;
  }
  const graded = expected
    .filter((entry) => entry && typeof entry.id === "string" && entry.id.trim() && (!entry.bundle || !bundleId || entry.bundle === bundleId))
    .map((entry) => ({ id: entry.id.trim(), grade: Number.isFinite(entry.grade) ? entry.grade : 2 }));
  return graded;
}

function loadQrels(file, bundleId) {
  if (!file) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.queries) ? parsed.queries : null);
  if (!rows) {
    throw new TypeError("--qrels must contain a JSON array of { query, expected } rows or a { queries: [...] } sidecar.");
  }
  const qrels = [];
  rows.forEach((entry) => {
    const expected = entry && typeof entry.query === "string" && entry.query.trim()
      ? normalizeExpected(entry.expected, bundleId)
      : null;
    if (expected === null) {
      throw new TypeError("--qrels rows need a query string and an expected Concept ID or a graded expected list.");
    }
    if (expected.length) {
      qrels.push({ query: entry.query, expected, queryId: entry.id || entry.queryId || null });
    }
  });
  return qrels;
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

function gradeOf(result, expected) {
  const match = expected.find((entry) => matchesExpected(result, entry.id));
  return match ? match.grade : 0;
}

const log2 = (value) => Math.log(value) / Math.LN2;
const dcg = (grades) => grades.reduce((sum, grade, position) => sum + (grade > 0 ? grade / log2(position + 2) : 0), 0);

// Graded relevance: Recall@10 counts every expected concept with grade >= 1 found in the top 10
// (one expected concept reproduces the old all-or-nothing value), MRR and top-1 use the first
// relevant result, nDCG@10 uses the grade as linear gain against the ideal ordering.
function evaluate(index, qrels) {
  if (!qrels.length) {
    return null;
  }
  let reciprocalRank = 0;
  let recall = 0;
  let topOne = 0;
  let ndcg = 0;
  const cases = qrels.map(({ query, expected, queryId }) => {
    const results = searchConcepts(index, { query, limit: 10 }).results;
    const grades = results.map((result) => gradeOf(result, expected));
    const rank = grades.findIndex((grade) => grade >= 1) + 1;
    const relevant = expected.filter((entry) => entry.grade >= 1);
    const found = relevant.filter((entry) => results.some((result) => matchesExpected(result, entry.id))).length;
    const ideal = dcg(expected.map((entry) => entry.grade).sort((left, right) => right - left).slice(0, 10));
    const queryNdcg = ideal ? dcg(grades) / ideal : 0;
    recall += relevant.length ? found / relevant.length : 0;
    ndcg += queryNdcg;
    if (rank > 0) {
      reciprocalRank += 1 / rank;
      if (rank === 1) {
        topOne += 1;
      }
    }
    return {
      queryId,
      query,
      expected,
      rank: rank || null,
      ndcgAt10: queryNdcg,
      top: results.slice(0, 3).map((result) => result.path),
    };
  });
  return {
    queries: qrels.length,
    recallAt10: recall / qrels.length,
    mrrAt10: reciprocalRank / qrels.length,
    ndcgAt10: ndcg / qrels.length,
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
  const qrels = loadQrels(options.qrels, sanitizeBundleId(path.basename(root)));
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
