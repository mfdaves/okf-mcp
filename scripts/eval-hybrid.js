#!/usr/bin/env node
"use strict";

// Hybrid retrieval evaluation (docs/plan-1.0.md WP3c), reached through
//
//   node scripts/eval-search.js --embedder <json|yaml file> [--alpha a] [--units concepts|sections]
//        [--alpha-sweep 0,0.1,...,1] [--cache-dir <dir>] [--max-tokens 2000000]
//        [--alpha adaptive] [--adaptive low,mid,high] [--adaptive-grid lows/mids/highs]
//        [--baseline <report.json>]
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
//
// WP3c-2: --alpha adaptive scores the adaptive weight (--adaptive sets its low, mid and high);
// --adaptive-grid scores every low/mid/high combination (high >= mid) from the same vectors,
// dev split only, and names the pre-registered choice (best mean Recall@5 over the fixtures,
// ties within 0.005 by mean nDCG@10, then the smallest low + mid + high). --baseline pairs this
// run with an earlier report by query id: per category and overall, the difference in Recall@5
// with a seeded paired bootstrap 95% interval; a category regresses when the whole interval is
// below zero.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { buildProjectIndex } = require("../src/indexer");
const { loadEmbeddingConfigFile } = require("../src/search/embedding-config");
const {
  DEFAULT_ALPHA_SETTING,
  adaptiveWeights,
  fusionAlpha,
  fusionAlphaSetting,
  fusionNormalization,
} = require("../src/search/fusion");
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
  "--normalization",
  "--units",
  "--cache-dir",
  "--max-tokens",
  "--adaptive",
  "--adaptive-grid",
  "--baseline",
]);
// Ties in the adaptive grid: within this much of the best mean dev Recall@5.
const GRID_TIE = 0.005;

function usage() {
  return [
    "Hybrid options (node scripts/eval-search.js --embedder <file> ...):",
    "  --embedder <file>         Embedder settings (JSON or YAML); enables the hybrid run.",
    "  --alpha <a|adaptive>      Fusion weight of the dense side, or adaptive (default: the file's fusion.alpha).",
    "  --adaptive <l,m,h>        Weights of the adaptive rule: low, mid, high (default: the file's or the shipped ones).",
    "  --adaptive-grid <L/M/H>   Comma-separated lows/mids/highs, every combination with high >= mid; dev split only.",
    "  --baseline <report.json>  Pair this run with an earlier report: per-category paired bootstrap of the Recall@5 difference.",
    "  --alpha-sweep <list>      Comma-separated weights scored from the same vectors; dev split only.",
    "  --normalization <name>    Fusion normalization: minmax, tmm or lexical-tmm (default: the file's or minmax).",
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
    if (argument === "--alpha") hybrid.alpha = fusionAlphaSetting(value);
    if (argument === "--adaptive") hybrid.adaptive = parseWeights(value);
    if (argument === "--baseline") hybrid.baseline = path.resolve(value);
    if (argument === "--adaptive-grid") hybrid.grid = parseGrid(value);
    if (argument === "--normalization") hybrid.normalization = fusionNormalization(value);
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
  if (hybrid.grid && options.split !== "dev") {
    throw new TypeError("--adaptive-grid runs on the dev split only: add --split dev.");
  }
  return Object.assign(options, { hybrid });
}

function parseWeights(value) {
  const [low, mid, high] = String(value)
    .split(",")
    .map((entry) => entry.trim());
  return adaptiveWeights({ low, mid, high });
}

// "0.1,0.2/0.4/0.6,0.75" -> every { low, mid, high } with high >= mid.
function parseGrid(value) {
  const lists = String(value)
    .split("/")
    .map((part) => part.split(",").map((entry) => fusionAlpha(entry.trim())));
  if (lists.length !== 3 || lists.some((list) => !list.length)) {
    throw new TypeError("--adaptive-grid needs three comma-separated lists: lows/mids/highs.");
  }
  const rows = [];
  lists[0].forEach((low) => {
    lists[1].forEach((mid) => {
      lists[2].forEach((high) => {
        if (high >= mid) rows.push(adaptiveWeights({ low, mid, high }));
      });
    });
  });
  return rows;
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
  if (options.hybrid.alpha !== undefined) settings.fusion.alpha = options.hybrid.alpha;
  if (options.hybrid.adaptive) settings.fusion.adaptive = options.hybrid.adaptive;
  if (options.hybrid.normalization) settings.fusion.normalization = options.hybrid.normalization;
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
function hybridModule(prepared, alpha, label, normalization, adaptive) {
  const responses = new Map();
  const { runtime } = prepared;
  return {
    responses,
    path: path.join(__dirname, "..", "src", "search", "query.js"),
    isDefault: false,
    name: label,
    options: Object.assign(
      { hybrid: true, alpha, normalization, embedUnits: runtime.embedUnits },
      alpha === "adaptive" ? { adaptive: adaptive || runtime.adaptive } : {},
    ),
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
        adaptiveAlpha: adaptive || runtime.adaptive,
        fusionNormalization: normalization,
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
    // WP3c-2: the weight each query used and why.
    if (response && typeof response.alphaUsed === "number") {
      row.alphaUsed = response.alphaUsed;
      row.alphaReason = response.alphaReason;
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

// Paired bootstrap of `metric` differences (current - baseline) over queries both runs scored,
// per category and overall: { queries, current, baseline, delta, low, high, regressed }.
function pairedComparison(current, baseline, options, metric) {
  const key = metric || "recallAt5";
  const before = new Map(
    (baseline?.perQuery || []).filter((row) => row.answerable).map((row) => [row.id, row]),
  );
  const pairs = current.perQuery
    .filter((row) => row.answerable && before.has(row.id))
    .map((row) => ({
      category: row.category,
      split: row.split,
      after: row[key],
      before: before.get(row.id)[key],
    }));
  const summarize = (list, seed) => {
    if (!list.length) return null;
    const diffs = list.map((pair) => pair.after - pair.before);
    const meanOf = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const random = mulberry32(seed);
    const draws = [];
    for (let sample = 0; sample < options.bootstrap; sample += 1) {
      let sum = 0;
      for (let draw = 0; draw < diffs.length; draw += 1) {
        sum += diffs[Math.floor(random() * diffs.length)];
      }
      draws.push(sum / diffs.length);
    }
    const low = percentile(draws, 0.025);
    const high = percentile(draws, 0.975);
    return {
      queries: list.length,
      current: meanOf(list.map((pair) => pair.after)),
      baseline: meanOf(list.map((pair) => pair.before)),
      delta: meanOf(diffs),
      low,
      high,
      regressed: high !== null && high < 0,
    };
  };
  const groups = new Map();
  pairs.forEach((pair) => {
    if (!groups.has(pair.category)) groups.set(pair.category, []);
    groups.get(pair.category).push(pair);
  });
  const bySplit = {};
  ["dev", "heldout"].forEach((split) => {
    const subset = pairs.filter((pair) => pair.split === split);
    if (subset.length) bySplit[split] = summarize(subset, options.seed);
  });
  return {
    metric: key,
    overall: summarize(pairs, options.seed),
    bySplit,
    byCategory: Object.fromEntries(
      Array.from(groups.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, list]) => [category, summarize(list, options.seed)]),
    ),
  };
}

function mulberry32(seed) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The pre-registered grid choice: best mean Recall@5 over the fixtures, ties within GRID_TIE by
// mean nDCG@10, then the smallest low + mid + high (the one closest to lexical).
function chooseGrid(rows) {
  if (!rows.length) return null;
  const best = Math.max(...rows.map((row) => row.meanRecallAt5));
  return rows
    .filter((row) => row.meanRecallAt5 >= best - GRID_TIE)
    .sort(
      (a, b) =>
        b.meanNdcgAt10 - a.meanNdcgAt10 ||
        a.low + a.mid + a.high - (b.low + b.mid + b.high) ||
        a.low - b.low ||
        a.mid - b.mid,
    )[0];
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
  const alpha = settings.fusion?.alpha ?? DEFAULT_ALPHA_SETTING;
  const normalization = settings.fusion?.normalization;
  const adaptive = adaptiveWeights(settings.fusion?.adaptive);
  const baseline = options.hybrid.baseline
    ? JSON.parse(fs.readFileSync(options.hybrid.baseline, "utf8"))
    : null;
  const lexicalModule = evalSearch.loadSearchModule("", {});
  const label = options.label || `hybrid alpha ${alpha} ${normalization}`;
  const report = {
    label,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    exposedGc: typeof global.gc === "function",
    searchModule: {
      path: "src/search/query.js",
      name: label,
      options: Object.assign(
        { hybrid: true, alpha, normalization, embedUnits: settings.embedUnits },
        alpha === "adaptive" ? { adaptive } : {},
      ),
    },
    split: options.split,
    limit: options.limit,
    bootstrap: { samples: options.bootstrap, seed: options.seed, confidence: 0.95 },
    fixtures: {},
    hybrid: Object.assign(
      { alpha, normalization, embedUnits: settings.embedUnits, fixtures: {} },
      alpha === "adaptive" ? { adaptive } : {},
      baseline ? { baseline: { label: baseline.label, generatedAt: baseline.generatedAt } } : {},
    ),
  };
  for (const nameOrPath of options.fixtures) {
    const fixture = evalSearch.resolveFixture(nameOrPath);
    const prepared = await prepareFixture(fixture, settings, options, env);
    const module = hybridModule(prepared, alpha, label, normalization, adaptive);
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
    if (baseline?.fixtures?.[fixture.name]) {
      report.hybrid.fixtures[fixture.name].paired = pairedComparison(
        result,
        baseline.fixtures[fixture.name],
        options,
      );
    }
    if (options.hybrid.grid) {
      report.hybrid.fixtures[fixture.name].grid = options.hybrid.grid.map((weights) => {
        const gridModule = hybridModule(
          prepared,
          "adaptive",
          `${label} adaptive ${weights.low}/${weights.mid}/${weights.high}`,
          normalization,
          weights,
        );
        const run = evalSearch.evaluateFixture(fixture, gridModule, options);
        return Object.assign({}, weights, {
          recallAt5: run.overall.recallAt5,
          ndcgAt10: run.overall.ndcgAt10,
          mrrAt10: run.overall.mrrAt10,
          p1: run.overall.p1,
          byCategory: Object.fromEntries(
            Object.entries(run.byCategory).map(([name, value]) => [name, value.recallAt5]),
          ),
        });
      });
    }
    if (options.hybrid.sweep) {
      report.hybrid.fixtures[fixture.name].sweep = options.hybrid.sweep.map((weight) => {
        const sweepModule = hybridModule(
          prepared,
          weight,
          `${label} sweep ${weight}`,
          normalization,
        );
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
  if (options.hybrid.grid) {
    const names = Object.keys(report.hybrid.fixtures);
    const rows = options.hybrid.grid.map((weights, position) => {
      const cells = names.map((name) => report.hybrid.fixtures[name].grid[position]);
      const mean = (key) => cells.reduce((sum, cell) => sum + cell[key], 0) / cells.length;
      return Object.assign({}, weights, {
        meanRecallAt5: mean("recallAt5"),
        meanNdcgAt10: mean("ndcgAt10"),
        fixtures: Object.fromEntries(
          names.map((name, index) => [
            name,
            {
              recallAt5: cells[index].recallAt5,
              ndcgAt10: cells[index].ndcgAt10,
              synonym: cells[index].byCategory.synonym ?? null,
              exact: cells[index].byCategory.exact ?? null,
              keyword: cells[index].byCategory.keyword ?? null,
            },
          ]),
        ),
      });
    });
    report.hybrid.grid = { rule: GRID_RULE, rows, choice: chooseGrid(rows) };
  }
  return report;
}

const GRID_RULE =
  "best mean dev Recall@5 over the fixtures; ties within 0.005 by mean nDCG@10, then the smallest low + mid + high";

const pct = (value) =>
  value === null || value === undefined ? "–" : `${(value * 100).toFixed(1)}%`;
const num = (value, digits) =>
  value === null || value === undefined ? "–" : value.toFixed(digits === undefined ? 3 : digits);

function renderHybrid(report) {
  const lines = ["## Hybrid run", ""];
  lines.push(
    `Fusion alpha ${report.hybrid.alpha} (dense weight) · normalization ${report.hybrid.normalization} · units ${report.hybrid.embedUnits} · split ${report.split}`,
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
    if (entry.paired) {
      lines.push(
        `Paired with \`${report.hybrid.baseline?.label || "baseline"}\` (Recall@5 difference, paired bootstrap 95% CI):`,
        "",
        "| group | n | baseline | this run | delta | 95% CI | regressed |",
        "|---|---|---|---|---|---|---|",
      );
      const pairedRow = (name, value) =>
        value
          ? `| ${name} | ${value.queries} | ${num(value.baseline)} | ${num(value.current)} | ${value.delta >= 0 ? "+" : ""}${num(value.delta)} | [${num(value.low)}, ${num(value.high)}] | ${value.regressed ? "yes" : "no"} |`
          : `| ${name} | 0 | – | – | – | – | – |`;
      lines.push(pairedRow("overall", entry.paired.overall));
      Object.entries(entry.paired.bySplit).forEach(([split, value]) => {
        lines.push(pairedRow(split, value));
      });
      Object.entries(entry.paired.byCategory).forEach(([category, value]) => {
        lines.push(pairedRow(category, value));
      });
      lines.push("");
    }
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
  if (report.hybrid.grid) {
    const names = Object.keys(report.hybrid.fixtures);
    lines.push(
      "### Adaptive grid (dev split)",
      "",
      `Rule: ${report.hybrid.grid.rule}. Choice: ${report.hybrid.grid.choice ? `low ${report.hybrid.grid.choice.low}, mid ${report.hybrid.grid.choice.mid}, high ${report.hybrid.grid.choice.high}` : "none"}.`,
      "",
      `| low | mid | high | mean Recall@5 | mean nDCG@10 | ${names.map((name) => `${name} R@5 / synonym / exact`).join(" | ")} |`,
      `|---|---|---|---|---|${names.map(() => "---|").join("")}`,
    );
    report.hybrid.grid.rows.forEach((row) => {
      const cells = names.map((name) => {
        const cell = row.fixtures[name];
        return `${num(cell.recallAt5)} / ${num(cell.synonym, 2)} / ${num(cell.exact, 2)}`;
      });
      lines.push(
        `| ${row.low} | ${row.mid} | ${row.high} | ${num(row.meanRecallAt5)} | ${num(row.meanNdcgAt10)} | ${cells.join(" | ")} |`,
      );
    });
    lines.push("");
  }
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
      ...(entry.paired
        ? {
            paired: {
              overall: entry.paired.overall,
              regressed: Object.entries(entry.paired.byCategory)
                .filter(([, value]) => value?.regressed)
                .map(([category]) => category),
            },
          }
        : {}),
    });
  });
  if (report.hybrid.grid) summary.adaptiveChoice = report.hybrid.grid.choice;
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
  chooseGrid,
  cli,
  main,
  pairedComparison,
  parseHybridArgs,
  renderHybrid,
  runHybridEvaluation,
  summaryOf,
};
