#!/usr/bin/env node
"use strict";

// Hybrid retrieval evaluation (docs/plan-1.0.md WP3c), reached through
//
//   node scripts/eval-search.js --embedder <json|yaml file> [--alpha a] [--units concepts|sections]
//        [--alpha-sweep 0,0.1,...,1] [--cache-dir <dir>] [--max-tokens 2000000]
//        --fixture alpinaria [--fixture atlas] [--split dev|heldout|all] [eval-search options]
//
// The embedder file holds trusted settings (src/search/embedding-config.js: a bare embedder
// block or { embedder, cacheDir, fusion, embedUnits }); the key comes from the environment
// variable it names. Per fixture the harness opens the embedding runtime with the cache under
// a temporary XDG_CACHE_HOME (or --cache-dir, to reuse vectors across runs), embeds the missing
// units, encodes every query once on its own (timed: that is the query-encoding latency, kept
// apart from search latency), then scores the shipped searchConcepts with hybrid: true through
// eval-search's evaluateFixture, next to a lexical run for the per-category comparison.
// --alpha-sweep scores several weights from the same vectors and is refused off the dev split
// (section 8: tune only on dev). A run whose estimated prompt tokens exceed --max-tokens aborts
// before any request. Reports never contain the key or the cache path.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { buildProjectIndex } = require("../src/indexer");
const { loadEmbeddingConfigFile } = require("../src/search/embedding-config");
const { DEFAULT_FUSION_ALPHA, fusionAlpha } = require("../src/search/fusion");
const { openEmbeddingRuntime } = require("../src/search/hybrid");
const { unitMemo } = require("../src/search/dense");
const { searchConcepts } = require("../src/search/query");
const evalSearch = require("./eval-search");

const DEFAULT_MAX_TOKENS = 2000000;
const CHARS_PER_TOKEN = 4;
const HYBRID_FLAGS = new Set([
  "--embedder",
  "--alpha",
  "--alpha-sweep",
  "--units",
  "--cache-dir",
  "--max-tokens",
]);

function usage() {
  return [
    "Hybrid options (node scripts/eval-search.js --embedder <file> ...):",
    "  --embedder <file>         Embedder settings (JSON or YAML); enables the hybrid run.",
    "  --alpha <a>               Fusion weight of the dense side (default: the file's fusion.alpha or 0.5).",
    "  --alpha-sweep <list>      Comma-separated weights scored from the same vectors; dev split only.",
    "  --units concepts|sections Retrieval units to embed (default: the file's embedUnits or concepts).",
    "  --cache-dir <dir>         Vector cache directory to reuse (default: under a temporary XDG_CACHE_HOME).",
    `  --max-tokens <n>          Abort before any request above this estimate (default ${DEFAULT_MAX_TOKENS}).`,
  ].join("\n");
}

function parseHybridArgs(argv) {
  const hybrid = { maxTokens: DEFAULT_MAX_TOKENS };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!HYBRID_FLAGS.has(argument)) {
      rest.push(argument);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new TypeError(`${argument} requires a value.`);
    index += 1;
    if (argument === "--embedder") hybrid.embedder = value;
    if (argument === "--alpha") hybrid.alpha = fusionAlpha(value);
    if (argument === "--units") hybrid.units = value;
    if (argument === "--cache-dir") hybrid.cacheDir = path.resolve(value);
    if (argument === "--max-tokens") hybrid.maxTokens = Number(value);
    if (argument === "--alpha-sweep") {
      hybrid.sweep = value.split(",").map((entry) => fusionAlpha(entry.trim()));
    }
  }
  if (!hybrid.embedder) throw new TypeError("--embedder is required for a hybrid run.");
  if (!Number.isSafeInteger(hybrid.maxTokens) || hybrid.maxTokens < 1) {
    throw new TypeError("--max-tokens must be a positive integer.");
  }
  const options = evalSearch.parseArgs(rest);
  if (hybrid.sweep && options.split !== "dev") {
    throw new TypeError("--alpha-sweep runs on the dev split only: add --split dev.");
  }
  return Object.assign(options, { hybrid });
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

const round = (value, digits) =>
  value === null || value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits;

function estimateTokens(texts) {
  return texts.reduce(
    (sum, text) => sum + Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN)),
    0,
  );
}

// Settings from the file with the command line's overrides; the cache goes to --cache-dir or to
// the XDG location under a temporary XDG_CACHE_HOME, so a run never reuses vectors by accident.
function settingsFor(options) {
  const settings = loadEmbeddingConfigFile(options.hybrid.embedder);
  if (options.hybrid.units) settings.embedUnits = options.hybrid.units;
  if (options.hybrid.alpha !== undefined) settings.fusion = { alpha: options.hybrid.alpha };
  settings.cacheDir = options.hybrid.cacheDir || null;
  return settings;
}

// One runtime per fixture: open, guard the token budget, embed missing units, encode queries.
async function prepareFixture(fixture, settings, options, env) {
  const sidecar = JSON.parse(fs.readFileSync(fixture.queries, "utf8"));
  const queries = (sidecar.queries || []).filter(
    (query) => options.split === "all" || query.split === options.split,
  );
  const runtime = await openEmbeddingRuntime(
    Object.assign({}, settings, {
      cacheDir: settings.cacheDir ? path.join(settings.cacheDir, fixture.name) : null,
    }),
    { root: fixture.root, env },
  );
  const index = buildProjectIndex(fixture.project);
  const texts = Array.from(new Set(queries.map((query) => query.query)));
  const prepared = {
    runtime,
    queries,
    vectors: new Map(),
    encodingMs: [],
    startup: null,
    estimate: null,
    queryUsage: { promptTokens: 0, requests: 0 },
  };
  if (!runtime.ready) return prepared;
  const missing = unitMemo(index, runtime.units).units.filter(
    (unit) => !runtime.cache.has(unit.hash),
  );
  const estimate = estimateTokens(missing.map((unit) => unit.text)) + estimateTokens(texts);
  prepared.estimate = { missingUnits: missing.length, queries: texts.length, tokens: estimate };
  if (estimate > options.hybrid.maxTokens) {
    throw new Error(
      `Estimated ${estimate} prompt tokens for ${fixture.name} exceed --max-tokens ${options.hybrid.maxTokens}; aborted before any request.`,
    );
  }
  prepared.startup = await runtime.sync(index);
  const before = runtime.embedders.queries.usage
    ? runtime.embedders.queries.usage()
    : { promptTokens: 0, requests: 0 };
  for (const text of texts) {
    const started = performance.now();
    try {
      const { vector } = await runtime.encodeQuery(text);
      prepared.vectors.set(text, vector);
    } catch {
      // A query that cannot be encoded runs lexical-only, as the server would.
    }
    prepared.encodingMs.push(performance.now() - started);
  }
  const after = runtime.embedders.queries.usage
    ? runtime.embedders.queries.usage()
    : { promptTokens: 0, requests: 0 };
  prepared.queryUsage = {
    promptTokens: after.promptTokens - before.promptTokens,
    requests: after.requests - before.requests,
  };
  return prepared;
}

// A search module for evaluateFixture: hybrid searchConcepts with the pre-encoded vector, or
// lexical when the runtime is degraded or the query could not be encoded.
function hybridModule(prepared, alpha, label) {
  const responses = new Map();
  const { runtime } = prepared;
  return {
    responses,
    path: path.join(__dirname, "..", "src", "search", "query.js"),
    isDefault: false,
    name: label,
    options: { hybrid: true, alpha, embedUnits: runtime.embedUnits },
    prepare: null,
    search(index, query, context) {
      const vector = runtime.ready ? prepared.vectors.get(query) : null;
      const response = searchConcepts(index, {
        query,
        limit: context.limit,
        asOf: context.asOf,
        hybrid: Boolean(vector),
        queryVector: vector || undefined,
        vectorCache: vector ? runtime.cache : undefined,
        embedUnits: runtime.units,
        alpha,
      });
      responses.set(query, response);
      return response;
    },
  };
}

// lowConfidence keeps its lexical meaning in the hybrid response (it reads the lexical ranking);
// eval-search derives it from the fused top-1 instead, so the rows take the response's flag.
function applyResponseFlags(result, responses) {
  result.perQuery.forEach((row) => {
    const response = responses.get(row.query);
    if (response && typeof response.lowConfidence === "boolean") {
      row.lowConfidence = response.lowConfidence;
    }
  });
  const answerable = result.perQuery.filter((row) => row.answerable);
  const noAnswer = result.perQuery.filter((row) => !row.answerable);
  result.noAnswer = evalSearch.noAnswerSummary(noAnswer, answerable);
  Object.keys(result.bySplit).forEach((split) => {
    result.bySplit[split].noAnswer = evalSearch.noAnswerSummary(
      noAnswer.filter((row) => row.split === split),
      answerable.filter((row) => row.split === split),
    );
  });
}

function categoryIntervals(result, options) {
  const groups = new Map();
  result.perQuery
    .filter((row) => row.answerable)
    .forEach((row) => {
      if (!groups.has(row.category)) groups.set(row.category, []);
      groups.get(row.category).push(row);
    });
  return Object.fromEntries(
    Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, rows]) => [
        category,
        evalSearch.bootstrap(rows, options.bootstrap, options.seed).recallAt5,
      ]),
  );
}

function compare(hybrid, lexical) {
  const categories = Object.keys(lexical.byCategory);
  return {
    overall: {
      recallAt5: { lexical: lexical.overall.recallAt5, hybrid: hybrid.overall.recallAt5 },
      ndcgAt10: { lexical: lexical.overall.ndcgAt10, hybrid: hybrid.overall.ndcgAt10 },
    },
    byCategory: Object.fromEntries(
      categories.map((category) => {
        const before = lexical.byCategory[category].recallAt5;
        const after = hybrid.byCategory[category] ? hybrid.byCategory[category].recallAt5 : null;
        const halfWidth = lexical.categoryCi[category]?.halfWidth ?? null;
        const delta = after === null ? null : after - before;
        return [
          category,
          {
            queries: lexical.byCategory[category].queries,
            lexical: before,
            hybrid: after,
            delta,
            lexicalHalfWidth: halfWidth,
            regressed: delta !== null && halfWidth !== null && delta < -halfWidth,
          },
        ];
      }),
    ),
  };
}

function encodingSummary(values) {
  return {
    samples: values.length,
    p50Ms: round(percentile(values, 0.5), 2),
    p95Ms: round(percentile(values, 0.95), 2),
    meanMs: values.length
      ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 2)
      : null,
  };
}

async function runHybridEvaluation(options, context) {
  const env = context?.env || process.env;
  const settings = settingsFor(options);
  const alpha = settings.fusion?.alpha ?? DEFAULT_FUSION_ALPHA;
  const lexicalModule = evalSearch.loadSearchModule("", {});
  const label = options.label || `hybrid alpha ${alpha}`;
  const report = {
    label,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    exposedGc: typeof global.gc === "function",
    searchModule: {
      path: "src/search/query.js",
      name: label,
      options: { hybrid: true, alpha, embedUnits: settings.embedUnits },
    },
    split: options.split,
    limit: options.limit,
    bootstrap: { samples: options.bootstrap, seed: options.seed, confidence: 0.95 },
    fixtures: {},
    hybrid: { alpha, embedUnits: settings.embedUnits, fixtures: {} },
  };
  for (const nameOrPath of options.fixtures) {
    const fixture = evalSearch.resolveFixture(nameOrPath);
    const prepared = await prepareFixture(fixture, settings, options, env);
    const module = hybridModule(prepared, alpha, label);
    const result = evalSearch.evaluateFixture(fixture, module, options);
    applyResponseFlags(result, module.responses);
    result.categoryCi = categoryIntervals(result, options);
    const lexical = evalSearch.evaluateFixture(fixture, lexicalModule, options);
    lexical.categoryCi = categoryIntervals(lexical, options);
    report.fixtures[fixture.name] = result;
    const status = prepared.runtime.status();
    report.hybrid.fixtures[fixture.name] = {
      embedder: status.embedder,
      cache: { rows: status.cache.rows },
      estimate: prepared.estimate,
      documents: prepared.startup
        ? {
            units: prepared.startup.units,
            embedded: prepared.startup.embedded,
            reused: prepared.startup.reused,
            pruned: prepared.startup.pruned,
            requests: prepared.startup.requests,
            usage: prepared.startup.usage,
            durationMs: prepared.startup.durationMs,
            rebuilt: prepared.startup.cache.rebuilt,
          }
        : null,
      queries: {
        encoded: prepared.vectors.size,
        usage: prepared.queryUsage,
        encoding: encodingSummary(prepared.encodingMs),
      },
      searchLatency: result.latency,
      lexical: {
        overall: lexical.overall,
        byCategory: lexical.byCategory,
        categoryCi: lexical.categoryCi,
        bySplit: lexical.bySplit,
        noAnswer: lexical.noAnswer,
        latency: lexical.latency,
      },
      comparison: compare(result, lexical),
    };
    if (options.hybrid.sweep) {
      report.hybrid.fixtures[fixture.name].sweep = options.hybrid.sweep.map((weight) => {
        const sweepModule = hybridModule(prepared, weight, `${label} sweep ${weight}`);
        const run = evalSearch.evaluateFixture(fixture, sweepModule, options);
        applyResponseFlags(run, sweepModule.responses);
        return {
          alpha: weight,
          recallAt5: run.overall.recallAt5,
          recallAt5Ci: run.overall.ci.recallAt5,
          ndcgAt10: run.overall.ndcgAt10,
          mrrAt10: run.overall.mrrAt10,
          p1: run.overall.p1,
          byCategory: Object.fromEntries(
            Object.entries(run.byCategory).map(([name, value]) => [name, value.recallAt5]),
          ),
          searchP95Ms: run.latency.p95Ms,
        };
      });
    }
  }
  return report;
}

const pct = (value) =>
  value === null || value === undefined ? "–" : `${(value * 100).toFixed(1)}%`;
const num = (value, digits) =>
  value === null || value === undefined ? "–" : value.toFixed(digits === undefined ? 3 : digits);

function renderHybrid(report) {
  const lines = ["## Hybrid run", ""];
  lines.push(
    `Fusion alpha ${report.hybrid.alpha} (dense weight) · units ${report.hybrid.embedUnits} · split ${report.split}`,
    "",
  );
  Object.entries(report.hybrid.fixtures).forEach(([name, entry]) => {
    lines.push(`### ${name}`, "");
    lines.push(
      `Embedder \`${entry.embedder.id}\` · remote ${entry.embedder.remote} · dimension ${entry.embedder.dimension} · degraded ${entry.embedder.degraded}${entry.embedder.code ? ` (${entry.embedder.code}${entry.embedder.serverCode ? `, ${entry.embedder.serverCode}` : ""})` : ""} · cache rows ${entry.cache.rows}  `,
    );
    if (entry.documents) {
      const usage = entry.documents.usage || {};
      lines.push(
        `Documents: ${entry.documents.units} units, ${entry.documents.embedded} embedded, ${entry.documents.reused} reused, ${entry.documents.requests} requests, ${usage.promptTokens ?? "–"} prompt tokens, ${num(entry.documents.durationMs, 0)} ms  `,
      );
    }
    lines.push(
      `Queries: ${entry.queries.encoded} encoded in ${entry.queries.usage.requests} requests, ${entry.queries.usage.promptTokens} prompt tokens · encoding p50 ${num(entry.queries.encoding.p50Ms, 1)} ms, p95 ${num(entry.queries.encoding.p95Ms, 1)} ms · search p50 ${num(entry.searchLatency.p50Ms, 2)} ms, p95 ${num(entry.searchLatency.p95Ms, 2)} ms (excluding encoding)`,
      "",
    );
    lines.push(
      "| category | n | lexical Recall@5 | hybrid Recall@5 | delta | lexical 95% CI half-width | regressed |",
      "|---|---|---|---|---|---|---|",
    );
    Object.entries(entry.comparison.byCategory).forEach(([category, value]) => {
      lines.push(
        `| ${category} | ${value.queries} | ${pct(value.lexical)} | ${pct(value.hybrid)} | ${value.delta === null ? "–" : `${value.delta >= 0 ? "+" : ""}${(value.delta * 100).toFixed(1)}`} | ${num(value.lexicalHalfWidth)} | ${value.regressed ? "yes" : "no"} |`,
      );
    });
    lines.push("");
    if (entry.sweep) {
      lines.push(
        "| alpha | Recall@5 (95% CI) | nDCG@10 | MRR@10 | P@1 | synonym R@5 | mixed-lang R@5 | search p95 ms |",
        "|---|---|---|---|---|---|---|---|",
      );
      entry.sweep.forEach((row) => {
        lines.push(
          `| ${row.alpha} | ${num(row.recallAt5)} [${num(row.recallAt5Ci.low)}, ${num(row.recallAt5Ci.high)}] | ${num(row.ndcgAt10)} | ${num(row.mrrAt10)} | ${num(row.p1)} | ${pct(row.byCategory.synonym)} | ${pct(row.byCategory["mixed-lang"])} | ${num(row.searchP95Ms, 2)} |`,
        );
      });
      lines.push("");
    }
  });
  return lines.join("\n");
}

function writeHybridReport(report, outPrefix) {
  const written = evalSearch.writeReport(report, outPrefix);
  const markdown = written.find((file) => file.endsWith(".md"));
  fs.appendFileSync(markdown, `\n${renderHybrid(report)}\n`);
  return written;
}

function summaryOf(report) {
  const summary = evalSearch.summaryOf(report);
  Object.entries(report.hybrid.fixtures).forEach(([name, entry]) => {
    Object.assign(summary.fixtures[name], {
      embedder: entry.embedder,
      documents: entry.documents && {
        requests: entry.documents.requests,
        usage: entry.documents.usage,
      },
      queries: entry.queries,
      lexicalRecallAt5: entry.lexical.overall.recallAt5,
      regressedCategories: Object.entries(entry.comparison.byCategory)
        .filter(([, value]) => value.regressed)
        .map(([category]) => category),
      ...(entry.sweep
        ? { sweep: entry.sweep.map((row) => ({ alpha: row.alpha, recallAt5: row.recallAt5 })) }
        : {}),
    });
  });
  return summary;
}

async function main(argv, context) {
  if (argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const options = parseHybridArgs(argv);
  // Without --cache-dir, the XDG default lives under a fresh temporary XDG_CACHE_HOME.
  let temporary = null;
  const env = Object.assign({}, context?.env || process.env);
  if (!options.hybrid.cacheDir) {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "okf-eval-hybrid-"));
    env.XDG_CACHE_HOME = temporary;
  }
  try {
    const report = await runHybridEvaluation(options, { env });
    const summary = summaryOf(report);
    if (options.out) summary.wrote = writeHybridReport(report, options.out);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return report;
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function cli(argv) {
  main(argv).catch((error) => {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  });
}

if (require.main === module) {
  cli(process.argv.slice(2));
}

module.exports = {
  cli,
  main,
  parseHybridArgs,
  renderHybrid,
  runHybridEvaluation,
  summaryOf,
};
