#!/usr/bin/env node
"use strict";

// Retrieval evaluation harness over the committed fixtures (docs/plan-1.0.md WP0, section 8).
//
//   node scripts/eval-search.js --fixture alpinaria [--fixture atlas | --fixture <path>]
//        [--split dev|heldout|all] [--search-module <abs path>] [--search-options '<json>']
//        [--limit 10] [--as-of YYYY-MM-DD] [--bootstrap 1000] [--seed 20261024]
//        [--label <name>] [--out <prefix>]
//
// The OKF index is always built by src/indexer.js (project mode) so every search module sees
// exactly the documents the runtime sees. The search module is pluggable and defaults to the
// shipped `searchConcepts`; it must export `searchConcepts(index, options)` or
// `search(index, options)` returning `{ results: [{ uri, score }] }` (an array is accepted too)
// and may export `prepare(index, context)`. Optional per-run `mode` and per-result `coverage`
// drive the lowConfidence metrics (R-4); without them that block reports `available: false`.
//
// Metrics on answerable queries: Recall@5 (grade >= 1), MustRecall@5 (grade 2), nDCG@10 (linear
// gain), MRR@10, P@1, hit@10, zero-result rate, distractor-outranks count; seeded bootstrap 95%
// confidence intervals; breakdowns by category, language and split. No-answer queries: rate of
// returning at least one result, zero-result rate, and lowConfidence precision/recall with the
// strict rule `mode === "any" && top1.coverage < 0.5`. Plus p50/p95 latency, build time and RSS.

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { buildProjectIndex } = require("../src/indexer");

const FIXTURES_ROOT = path.join(__dirname, "..", "test", "fixtures", "retrieval");
const DEFAULT_SEARCH_MODULE = path.join(__dirname, "..", "src", "search.js");
const DEFAULT_LIMIT = 10;
const DEFAULT_BOOTSTRAP = 1000;
const DEFAULT_SEED = 20261024;
const LOW_CONFIDENCE_COVERAGE = 0.5;
const SPLITS = new Set(["dev", "heldout", "all"]);
const MEAN_METRICS = ["recallAt5", "mustRecallAt5", "ndcgAt10", "mrrAt10", "p1", "hitAt10", "zeroResultRate"];
const CI_METRICS = ["recallAt5", "mustRecallAt5", "ndcgAt10", "mrrAt10", "p1", "zeroResultRate"];

function usage() {
  return [
    "Usage: node scripts/eval-search.js --fixture <name|path> [options]",
    "",
    "Options:",
    "  --fixture <name|path>     Fixture under test/fixtures/retrieval or a directory with okf.project.yaml and queries.json (repeatable).",
    "  --split dev|heldout|all   Query subset (default all).",
    "  --search-module <path>    Module exporting searchConcepts(index, options) or search(index, options) (default src/search.js).",
    "  --search-options <json>   Extra options merged into every search call (for example '{\"mode\":\"auto\"}').",
    "  --limit <n>               Results per query (default 10).",
    "  --as-of <date>            Evaluation date passed to the search module (default: the fixture's as_of).",
    "  --bootstrap <n>           Bootstrap samples for the confidence intervals (default 1000).",
    "  --seed <n>                Bootstrap seed (default 20261024).",
    "  --label <name>            Run label in the report (default: the search module's name).",
    "  --out <prefix>            Write <prefix>.json and <prefix>.md; '{date}' expands to today's date.",
    "  --help                    Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    fixtures: [], split: "all", searchModule: "", searchOptions: {}, limit: DEFAULT_LIMIT,
    asOf: "", bootstrap: DEFAULT_BOOTSTRAP, seed: DEFAULT_SEED, label: "", out: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new TypeError(`${argument} requires a value.`);
    }
    index += 1;
    switch (argument) {
      case "--fixture": options.fixtures.push(value); break;
      case "--split": options.split = value; break;
      case "--search-module": options.searchModule = value; break;
      case "--search-options": options.searchOptions = JSON.parse(value); break;
      case "--limit": options.limit = Number(value); break;
      case "--as-of": options.asOf = value; break;
      case "--bootstrap": options.bootstrap = Number(value); break;
      case "--seed": options.seed = Number(value); break;
      case "--label": options.label = value; break;
      case "--out": options.out = value; break;
      default: throw new TypeError(`Unknown option: ${argument}`);
    }
  }
  if (options.help) {
    return options;
  }
  if (!options.fixtures.length) {
    throw new TypeError("At least one --fixture is required.");
  }
  if (!SPLITS.has(options.split)) {
    throw new TypeError("--split must be dev, heldout or all.");
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 250) {
    throw new TypeError("--limit must be an integer from 1 through 250.");
  }
  if (!Number.isSafeInteger(options.bootstrap) || options.bootstrap < 0 || options.bootstrap > 100000) {
    throw new TypeError("--bootstrap must be an integer from 0 through 100000.");
  }
  if (!Number.isSafeInteger(options.seed)) {
    throw new TypeError("--seed must be an integer.");
  }
  if (options.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(options.asOf)) {
    throw new TypeError("--as-of must be YYYY-MM-DD.");
  }
  return options;
}

// ------------------------------------------------------------------------------- fixtures
function resolveFixture(nameOrPath) {
  const direct = path.resolve(nameOrPath);
  const root = fs.existsSync(path.join(direct, "okf.project.yaml")) ? direct : path.join(FIXTURES_ROOT, nameOrPath);
  const project = path.join(root, "okf.project.yaml");
  const queries = path.join(root, "queries.json");
  if (!fs.existsSync(project) || !fs.existsSync(queries)) {
    throw new TypeError(`Fixture ${nameOrPath} needs okf.project.yaml and queries.json (looked in ${root}).`);
  }
  return { name: path.basename(root), root, project, queries };
}

function loadQueries(fixture, split) {
  const sidecar = JSON.parse(fs.readFileSync(fixture.queries, "utf8"));
  const queries = (sidecar.queries || []).filter((query) => split === "all" || query.split === split);
  return { sidecar, queries };
}

// --------------------------------------------------------------------------- search module
function loadSearchModule(modulePath, searchOptions) {
  const resolved = modulePath ? path.resolve(modulePath) : DEFAULT_SEARCH_MODULE;
  const loaded = require(resolved);
  const fn = typeof loaded.searchConcepts === "function"
    ? loaded.searchConcepts
    : typeof loaded.search === "function" ? loaded.search : null;
  if (!fn) {
    throw new TypeError(`${resolved} exports neither searchConcepts(index, options) nor search(index, options).`);
  }
  return {
    path: resolved,
    isDefault: resolved === DEFAULT_SEARCH_MODULE,
    name: typeof loaded.name === "string" && loaded.name ? loaded.name : path.relative(path.join(__dirname, ".."), resolved),
    options: searchOptions || {},
    prepare: typeof loaded.prepare === "function" ? loaded.prepare : null,
    search(index, query, context) {
      return fn(index, Object.assign({ query, limit: context.limit, asOf: context.asOf }, searchOptions || {}));
    },
  };
}

function normalizeResponse(raw, limit) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.results) ? raw.results : []);
  const results = list.slice(0, limit).map((entry) => {
    const uri = entry.uri || (entry.bundle && entry.conceptId ? `okf://${entry.bundle}/${entry.conceptId}` : null);
    return {
      uri,
      score: typeof entry.score === "number" ? entry.score : null,
      coverage: typeof entry.coverage === "number" ? entry.coverage : null,
      relevance: typeof entry.relevance === "number" ? entry.relevance : null,
    };
  }).filter((entry) => entry.uri);
  return {
    results,
    total: raw && typeof raw.total === "number" ? raw.total : list.length,
    mode: raw && typeof raw.mode === "string" ? raw.mode : null,
  };
}

// --------------------------------------------------------------------------------- metrics
const log2 = (value) => Math.log(value) / Math.LN2;
const dcg = (grades) => grades.reduce((sum, grade, index) => sum + (grade > 0 ? grade / log2(index + 2) : 0), 0);
const mean = (list, key) => (list.length ? list.reduce((sum, entry) => sum + entry[key], 0) / list.length : null);

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function mulberry32(seed) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function evaluateQuery(index, module, query, context) {
  const started = performance.now();
  const response = normalizeResponse(module.search(index, query.query, context), context.limit);
  const ms = performance.now() - started;
  const expected = (query.expected || []).map((entry) => Object.assign({ uri: `okf://${entry.bundle}/${entry.id}` }, entry));
  const gradeOf = new Map(expected.map((entry) => [entry.uri, entry.grade]));
  const ranked = response.results.map((entry, position) => ({
    rank: position + 1, uri: entry.uri, score: entry.score, coverage: entry.coverage, relevance: entry.relevance, grade: gradeOf.get(entry.uri) || 0,
  }));
  const top1 = ranked[0] || null;
  const lowConfidence = response.mode === null || !top1 || top1.coverage === null
    ? null
    : response.mode === "any" && top1.coverage < LOW_CONFIDENCE_COVERAGE;
  // Per-query rows are kept compact (top-10 URIs and grades, rounded numbers) so a committed
  // report stays small; scores and coverage per result live in the search module's own output.
  const base = {
    id: query.id, query: query.query, lang: query.lang, category: query.category, split: query.split || null,
    ms: round(ms, 2), total: response.total, returned: ranked.length, mode: response.mode,
    top1: top1 ? { uri: top1.uri, grade: top1.grade, score: round(top1.score, 3), coverage: round(top1.coverage, 3) } : null,
    lowConfidence,
    top: ranked.map((entry) => entry.uri),
    grades: ranked.map((entry) => entry.grade),
    missingFromIndex: expected.filter((entry) => !index.byUri.get(entry.uri)).map((entry) => entry.uri),
  };
  if (query.category === "no-answer" || !expected.length) {
    return Object.assign(base, { answerable: false, returnedAny: ranked.length > 0, zeroResults: ranked.length === 0 ? 1 : 0 });
  }
  const relevant = expected.filter((entry) => entry.grade >= 1);
  const must = expected.filter((entry) => entry.grade >= 2);
  const inTop = (list, k) => list.filter((entry) => ranked.slice(0, k).some((hit) => hit.uri === entry.uri)).length;
  const firstRelevant = ranked.find((hit) => hit.grade >= 1) || null;
  const ideal = expected.map((entry) => entry.grade).sort((left, right) => right - left).slice(0, context.limit);
  const idealDcg = dcg(ideal);
  const mustRanks = must.map((entry) => {
    const hit = ranked.find((candidate) => candidate.uri === entry.uri);
    return { uri: entry.uri, rank: hit ? hit.rank : null };
  });
  const bestMustRank = mustRanks.reduce((best, entry) => (entry.rank && entry.rank < best ? entry.rank : best), Infinity);
  const distractors = (query.distractors || []).map((entry) => `okf://${entry.bundle}/${entry.id}`);
  const distractorOutranks = distractors.length
    ? distractors.some((uri) => {
      const hit = ranked.find((candidate) => candidate.uri === uri);
      return Boolean(hit) && hit.rank < bestMustRank;
    })
    : null;
  return Object.assign(base, {
    answerable: true,
    relevantCount: relevant.length,
    mustCount: must.length,
    recallAt5: relevant.length ? inTop(relevant, 5) / relevant.length : 0,
    mustRecallAt5: must.length ? inTop(must, 5) / must.length : 0,
    ndcgAt10: idealDcg ? round(dcg(ranked.slice(0, 10).map((hit) => hit.grade)) / idealDcg, 4) : 0,
    mrrAt10: firstRelevant && firstRelevant.rank <= 10 ? round(1 / firstRelevant.rank, 4) : 0,
    p1: top1 && top1.grade >= 1 ? 1 : 0,
    hitAt10: firstRelevant && firstRelevant.rank <= 10 ? 1 : 0,
    zeroResultRate: ranked.length === 0 ? 1 : 0,
    firstRelevantRank: firstRelevant ? firstRelevant.rank : null,
    // Ranks of the grade-2 concepts in queries.json order; null when outside the top results.
    mustRanks: mustRanks.map((entry) => entry.rank),
    distractorOutranks,
  });
}

function round(value, digits) {
  if (value === null || value === undefined) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function aggregate(list) {
  const summary = { queries: list.length };
  MEAN_METRICS.forEach((metric) => {
    summary[metric] = mean(list, metric);
  });
  summary.withDistractors = list.filter((entry) => entry.distractorOutranks !== null).length;
  summary.distractorOutranks = list.filter((entry) => entry.distractorOutranks === true).length;
  return summary;
}

function groupBy(list, key) {
  const groups = new Map();
  list.forEach((entry) => {
    const value = entry[key] || "unknown";
    if (!groups.has(value)) {
      groups.set(value, []);
    }
    groups.get(value).push(entry);
  });
  return Object.fromEntries(Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([value, entries]) => [value, aggregate(entries)]));
}

// Percentile bootstrap over answerable queries: resample with replacement, seeded, 95% interval.
function bootstrap(list, samples, seed) {
  const intervals = {};
  if (!list.length || samples < 1) {
    CI_METRICS.forEach((metric) => {
      intervals[metric] = { low: null, high: null, halfWidth: null };
    });
    return intervals;
  }
  const random = mulberry32(seed);
  const draws = Object.fromEntries(CI_METRICS.map((metric) => [metric, []]));
  for (let sample = 0; sample < samples; sample += 1) {
    const sums = Object.fromEntries(CI_METRICS.map((metric) => [metric, 0]));
    for (let draw = 0; draw < list.length; draw += 1) {
      const entry = list[Math.floor(random() * list.length)];
      CI_METRICS.forEach((metric) => {
        sums[metric] += entry[metric];
      });
    }
    CI_METRICS.forEach((metric) => {
      draws[metric].push(sums[metric] / list.length);
    });
  }
  CI_METRICS.forEach((metric) => {
    const low = percentile(draws[metric], 0.025);
    const high = percentile(draws[metric], 0.975);
    intervals[metric] = { low, high, halfWidth: (high - low) / 2 };
  });
  return intervals;
}

function noAnswerSummary(noAnswer, answerable) {
  const flaggedNoAnswer = noAnswer.filter((entry) => entry.lowConfidence === true).length;
  const flaggedAnswerable = answerable.filter((entry) => entry.lowConfidence === true).length;
  const flaggedAnswerableTop1Hits = answerable.filter((entry) => entry.lowConfidence === true && entry.p1 === 1).length;
  // The rule needs `mode` on every response and `coverage` on every non-empty top result.
  const available = noAnswer.concat(answerable).every((entry) => entry.mode !== null && (entry.returned === 0 || (entry.top1 && entry.top1.coverage !== null)));
  const flagged = flaggedNoAnswer + flaggedAnswerable;
  return {
    queries: noAnswer.length,
    returnedAny: noAnswer.filter((entry) => entry.returnedAny).length,
    returnedAnyRate: noAnswer.length ? noAnswer.filter((entry) => entry.returnedAny).length / noAnswer.length : null,
    zeroResultRate: noAnswer.length ? noAnswer.filter((entry) => entry.zeroResults === 1).length / noAnswer.length : null,
    lowConfidence: available
      ? {
        available: true,
        rule: `mode === "any" && top1.coverage < ${LOW_CONFIDENCE_COVERAGE}`,
        flaggedNoAnswer,
        flaggedAnswerable,
        flaggedAnswerableTop1Hits,
        precision: flagged ? flaggedNoAnswer / flagged : null,
        recall: noAnswer.length ? flaggedNoAnswer / noAnswer.length : null,
      }
      : { available: false, rule: `mode === "any" && top1.coverage < ${LOW_CONFIDENCE_COVERAGE}`, note: "n/a: the search module does not return mode and per-result coverage" },
  };
}

function memoryRss() {
  if (typeof global.gc === "function") {
    global.gc();
  }
  return process.memoryUsage().rss;
}

const toMb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

// ---------------------------------------------------------------------------- evaluation
function evaluateFixture(fixture, module, options) {
  const { sidecar, queries } = loadQueries(fixture, options.split);
  const context = { limit: options.limit, asOf: options.asOf || sidecar.as_of || new Date().toISOString().slice(0, 10) };
  const rssBefore = memoryRss();
  const buildStarted = performance.now();
  const index = buildProjectIndex(fixture.project);
  const okfIndexMs = performance.now() - buildStarted;
  let prepareMs = null;
  if (module.prepare) {
    const prepareStarted = performance.now();
    module.prepare(index, { okf: path.join(__dirname, ".."), options: context });
    prepareMs = performance.now() - prepareStarted;
  } else if (module.isDefault) {
    const { prepareSearchIndex } = require("../src/search-index");
    const prepareStarted = performance.now();
    prepareSearchIndex(index);
    prepareMs = performance.now() - prepareStarted;
  }
  // Warm-up pass: lazy structures are built here, so the measured pass reflects steady state.
  const warmupStarted = performance.now();
  queries.forEach((query) => {
    module.search(index, query.query, context);
  });
  const warmupMs = performance.now() - warmupStarted;
  const rssAfterBuild = memoryRss();

  const perQuery = queries.map((query) => evaluateQuery(index, module, query, context));
  const answerable = perQuery.filter((entry) => entry.answerable);
  const noAnswer = perQuery.filter((entry) => !entry.answerable);
  const timings = perQuery.map((entry) => entry.ms);
  const rssEnd = memoryRss();

  const overall = aggregate(answerable);
  overall.ci = bootstrap(answerable, options.bootstrap, options.seed);
  const bySplit = {};
  ["dev", "heldout"].forEach((split) => {
    const subset = answerable.filter((entry) => entry.split === split);
    if (subset.length) {
      bySplit[split] = Object.assign(aggregate(subset), { noAnswer: noAnswerSummary(noAnswer.filter((entry) => entry.split === split), subset) });
    }
  });
  return {
    fixture: fixture.name,
    project: path.relative(path.join(__dirname, ".."), fixture.project),
    asOf: context.asOf,
    split: options.split,
    corpus: {
      bundles: index.bundles.map((bundle) => ({ id: bundle.id, documents: bundle.documentCount })),
      concepts: index.concepts.length,
      validForProject: index.validForProject,
    },
    queries: {
      total: perQuery.length,
      answerable: answerable.length,
      noAnswer: noAnswer.length,
      labelled: queries.filter((query) => query.sectionAnchor).length,
      expectedMissingFromIndex: perQuery.filter((entry) => entry.missingFromIndex.length).map((entry) => ({ id: entry.id, missing: entry.missingFromIndex })),
    },
    build: { okfIndexMs, prepareMs, warmupMs, rssBeforeMb: toMb(rssBefore), rssAfterBuildMb: toMb(rssAfterBuild), rssEndMb: toMb(rssEnd) },
    latency: { samples: timings.length, p50Ms: percentile(timings, 0.5), p95Ms: percentile(timings, 0.95), meanMs: timings.length ? timings.reduce((sum, value) => sum + value, 0) / timings.length : null, maxMs: timings.length ? Math.max.apply(null, timings) : null },
    overall,
    byCategory: groupBy(answerable, "category"),
    byLang: groupBy(answerable, "lang"),
    bySplit,
    noAnswer: noAnswerSummary(noAnswer, answerable),
    perQuery,
  };
}

function runEvaluation(options) {
  const config = Object.assign({ fixtures: [], split: "all", searchModule: "", searchOptions: {}, limit: DEFAULT_LIMIT, asOf: "", bootstrap: DEFAULT_BOOTSTRAP, seed: DEFAULT_SEED, label: "" }, options || {});
  const module = loadSearchModule(config.searchModule, config.searchOptions);
  const report = {
    label: config.label || module.name,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    exposedGc: typeof global.gc === "function",
    searchModule: { path: path.relative(path.join(__dirname, ".."), module.path), name: module.name, options: module.options },
    split: config.split,
    limit: config.limit,
    bootstrap: { samples: config.bootstrap, seed: config.seed, confidence: 0.95 },
    fixtures: {},
  };
  config.fixtures.forEach((nameOrPath) => {
    const fixture = resolveFixture(nameOrPath);
    report.fixtures[fixture.name] = evaluateFixture(fixture, module, config);
  });
  return report;
}

// ---------------------------------------------------------------------------------- markdown
const pct = (value) => (value === null || value === undefined ? "–" : `${(value * 100).toFixed(1)}%`);
const num = (value, digits) => (value === null || value === undefined ? "–" : value.toFixed(digits === undefined ? 3 : digits));
const ci = (interval) => (interval && interval.low !== null ? ` [${num(interval.low)}, ${num(interval.high)}]` : "");

function aggregateRow(name, summary) {
  const distractors = summary.withDistractors ? `${summary.distractorOutranks}/${summary.withDistractors}` : "–";
  return `| ${name} | ${summary.queries} | ${pct(summary.recallAt5)} | ${pct(summary.mustRecallAt5)} | ${num(summary.ndcgAt10)} | ${num(summary.mrrAt10)} | ${pct(summary.p1)} | ${pct(summary.hitAt10)} | ${pct(summary.zeroResultRate)} | ${distractors} |`;
}

const AGGREGATE_HEADER = [
  "| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |",
  "|---|---|---|---|---|---|---|---|---|---|",
];

function renderFixture(result) {
  const lines = [];
  const summary = result.overall;
  lines.push(`## Fixture ${result.fixture}`, "");
  lines.push(`Project \`${result.project}\` · bundles ${result.corpus.bundles.map((bundle) => `${bundle.id} (${bundle.documents})`).join(", ")} · ${result.corpus.concepts} concepts · valid for project: ${result.corpus.validForProject} · as-of ${result.asOf} · split ${result.split}  `);
  lines.push(`Queries: ${result.queries.total} (${result.queries.answerable} answerable, ${result.queries.noAnswer} no-answer, ${result.queries.labelled} with sectionAnchor)`, "");
  if (result.queries.expectedMissingFromIndex.length) {
    lines.push(`Expected concepts absent from the index (counted as misses): ${result.queries.expectedMissingFromIndex.map((entry) => entry.id).join(", ")}`, "");
  }
  lines.push("### Overall (answerable queries, 95% bootstrap CI)", "");
  lines.push("| metric | value | 95% CI |", "|---|---|---|");
  lines.push(`| Recall@5 | ${num(summary.recallAt5)} |${ci(summary.ci.recallAt5) || " –"} |`);
  lines.push(`| MustRecall@5 | ${num(summary.mustRecallAt5)} |${ci(summary.ci.mustRecallAt5) || " –"} |`);
  lines.push(`| nDCG@10 | ${num(summary.ndcgAt10)} |${ci(summary.ci.ndcgAt10) || " –"} |`);
  lines.push(`| MRR@10 | ${num(summary.mrrAt10)} |${ci(summary.ci.mrrAt10) || " –"} |`);
  lines.push(`| P@1 | ${num(summary.p1)} |${ci(summary.ci.p1) || " –"} |`);
  lines.push(`| hit@10 | ${num(summary.hitAt10)} | – |`);
  lines.push(`| zero-result rate | ${num(summary.zeroResultRate)} |${ci(summary.ci.zeroResultRate) || " –"} |`);
  lines.push(`| distractor outranks | ${summary.distractorOutranks}/${summary.withDistractors} | – |`, "");
  lines.push("### By category", "", ...AGGREGATE_HEADER, ...Object.entries(result.byCategory).map(([name, value]) => aggregateRow(name, value)), "");
  lines.push("### By language", "", ...AGGREGATE_HEADER, ...Object.entries(result.byLang).map(([name, value]) => aggregateRow(name, value)), "");
  if (Object.keys(result.bySplit).length) {
    lines.push("### By split", "", ...AGGREGATE_HEADER, ...Object.entries(result.bySplit).map(([name, value]) => aggregateRow(name, value)), "");
  }
  const na = result.noAnswer;
  lines.push("### No-answer queries", "");
  lines.push(`Returned at least one result: ${na.returnedAny}/${na.queries} (${pct(na.returnedAnyRate)}); zero results: ${pct(na.zeroResultRate)}.  `);
  if (na.lowConfidence.available) {
    const lc = na.lowConfidence;
    lines.push(`lowConfidence (${lc.rule}): flagged ${lc.flaggedNoAnswer}/${na.queries} no-answer (recall ${pct(lc.recall)}), ${lc.flaggedAnswerable} answerable (${lc.flaggedAnswerableTop1Hits} with a relevant top-1); precision ${pct(lc.precision)}.`, "");
  } else {
    lines.push(`lowConfidence (${na.lowConfidence.rule}): n/a (${na.lowConfidence.note}).`, "");
  }
  lines.push("| id | split | query | returned | mode | top-1 coverage | flagged |", "|---|---|---|---|---|---|---|");
  result.perQuery.filter((entry) => !entry.answerable).forEach((entry) => {
    lines.push(`| ${entry.id} | ${entry.split || "–"} | ${entry.query} | ${entry.returned} | ${entry.mode || "–"} | ${entry.top1 && entry.top1.coverage !== null ? num(entry.top1.coverage, 2) : "–"} | ${entry.lowConfidence === null ? "n/a" : entry.lowConfidence ? "yes" : "no"} |`);
  });
  lines.push("", "### Latency, build and memory", "");
  lines.push("| metric | value |", "|---|---|");
  lines.push(`| query latency p50 | ${num(result.latency.p50Ms, 2)} ms |`);
  lines.push(`| query latency p95 | ${num(result.latency.p95Ms, 2)} ms |`);
  lines.push(`| query latency mean / max | ${num(result.latency.meanMs, 2)} / ${num(result.latency.maxMs, 2)} ms |`);
  lines.push(`| OKF index build | ${num(result.build.okfIndexMs, 1)} ms |`);
  lines.push(`| search index prepare | ${result.build.prepareMs === null ? "n/a (built lazily; see warm-up)" : `${num(result.build.prepareMs, 1)} ms`} |`);
  lines.push(`| warm-up pass | ${num(result.build.warmupMs, 1)} ms |`);
  lines.push(`| RSS before build / after build / end | ${result.build.rssBeforeMb} / ${result.build.rssAfterBuildMb} / ${result.build.rssEndMb} MB |`, "");
  lines.push("### Per query (answerable)", "", "| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |", "|---|---|---|---|---|---|---|---|---|---|");
  result.perQuery.filter((entry) => entry.answerable).forEach((entry) => {
    const must = entry.mustRanks.map((rank) => (rank === null ? "miss" : rank)).join(",");
    const top = entry.top1 ? `${entry.top1.uri.replace(/^okf:\/\//, "")} (${entry.top1.grade})` : "–";
    lines.push(`| ${entry.id} | ${entry.split || "–"} | ${entry.category} | ${entry.lang} | ${entry.query} | ${entry.returned} | ${entry.firstRelevantRank === null ? "miss" : entry.firstRelevantRank} | ${must} | ${top} | ${entry.distractorOutranks === null ? "–" : entry.distractorOutranks ? "yes" : "no"} |`);
  });
  lines.push("");
  return lines;
}

function renderMarkdown(report) {
  const lines = [`# Retrieval evaluation — ${report.label}`, ""];
  lines.push(`Generated ${report.generatedAt} · Node ${report.node} (${report.platform}, gc exposed: ${report.exposedGc}) · search module \`${report.searchModule.path}\`${Object.keys(report.searchModule.options).length ? ` with options \`${JSON.stringify(report.searchModule.options)}\`` : ""} · limit ${report.limit} · split ${report.split} · bootstrap ${report.bootstrap.samples} samples (seed ${report.bootstrap.seed})`, "");
  lines.push("## Summary", "", "| fixture | queries | Recall@5 (95% CI) | nDCG@10 (95% CI) | MRR@10 | P@1 | zero-result | no-answer returned any | lowConfidence P / R | p95 ms | RSS MB |", "|---|---|---|---|---|---|---|---|---|---|---|");
  Object.values(report.fixtures).forEach((result) => {
    const lc = result.noAnswer.lowConfidence;
    lines.push(`| ${result.fixture} | ${result.queries.total} | ${num(result.overall.recallAt5)}${ci(result.overall.ci.recallAt5)} | ${num(result.overall.ndcgAt10)}${ci(result.overall.ci.ndcgAt10)} | ${num(result.overall.mrrAt10)} | ${num(result.overall.p1)} | ${pct(result.overall.zeroResultRate)} | ${pct(result.noAnswer.returnedAnyRate)} | ${lc.available ? `${pct(lc.precision)} / ${pct(lc.recall)}` : "n/a"} | ${num(result.latency.p95Ms, 2)} | ${result.build.rssEndMb} |`);
  });
  lines.push("");
  Object.values(report.fixtures).forEach((result) => {
    lines.push(...renderFixture(result));
  });
  return `${lines.join("\n")}\n`;
}

function summaryOf(report) {
  return {
    label: report.label,
    fixtures: Object.fromEntries(Object.values(report.fixtures).map((result) => [result.fixture, {
      queries: result.queries.total,
      recallAt5: result.overall.recallAt5,
      recallAt5Ci: result.overall.ci.recallAt5,
      ndcgAt10: result.overall.ndcgAt10,
      ndcgAt10Ci: result.overall.ci.ndcgAt10,
      mrrAt10: result.overall.mrrAt10,
      p1: result.overall.p1,
      zeroResultRate: result.overall.zeroResultRate,
      noAnswerReturnedAnyRate: result.noAnswer.returnedAnyRate,
      lowConfidence: result.noAnswer.lowConfidence,
      latencyP95Ms: result.latency.p95Ms,
      rssEndMb: result.build.rssEndMb,
    }])),
  };
}

// Pretty JSON for the aggregates, one line per per-query row: readable diffs without the bulk
// of a fully indented array of objects.
function stringifyReport(report) {
  const placeholder = "__eval-search-per-query__";
  const shell = JSON.parse(JSON.stringify(report));
  const rows = {};
  Object.entries(shell.fixtures).forEach(([name, fixture]) => {
    rows[name] = fixture.perQuery || [];
    fixture.perQuery = `${placeholder}${name}`;
  });
  let text = JSON.stringify(shell, null, 2);
  Object.entries(rows).forEach(([name, entries]) => {
    const block = entries.length
      ? `[\n${entries.map((entry) => `  ${JSON.stringify(compactRow(entry))}`).join(",\n")}\n      ]`
      : "[]";
    text = text.replace(JSON.stringify(`${placeholder}${name}`), () => block);
  });
  return text;
}

// The query text is in the fixture's queries.json (joined by id); fields derivable from `top`,
// `grades` and `firstRelevantRank` and empty diagnostics are dropped.
const DERIVABLE_ROW_FIELDS = ["query", "relevantCount", "mustCount", "p1", "hitAt10", "zeroResultRate"];

function compactRow(entry) {
  const row = Object.assign({}, entry);
  DERIVABLE_ROW_FIELDS.forEach((field) => {
    delete row[field];
  });
  if (Array.isArray(row.missingFromIndex) && !row.missingFromIndex.length) {
    delete row.missingFromIndex;
  }
  return row;
}

function writeReport(report, outPrefix) {
  const prefix = path.resolve(outPrefix.replace("{date}", new Date().toISOString().slice(0, 10)));
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  fs.writeFileSync(`${prefix}.json`, `${stringifyReport(report)}\n`);
  fs.writeFileSync(`${prefix}.md`, renderMarkdown(report));
  return [`${prefix}.json`, `${prefix}.md`];
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = runEvaluation(options);
  const summary = summaryOf(report);
  if (options.out) {
    summary.wrote = writeReport(report, options.out);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CI_METRICS,
  DEFAULT_SEARCH_MODULE,
  LOW_CONFIDENCE_COVERAGE,
  evaluateFixture,
  loadSearchModule,
  parseArgs,
  renderMarkdown,
  resolveFixture,
  runEvaluation,
  summaryOf,
  writeReport,
};
