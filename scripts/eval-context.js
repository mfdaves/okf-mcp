#!/usr/bin/env node
"use strict";

// Section-level context evaluation over the committed fixtures (docs/plan-1.0.md WP3a, C-1).
//
//   node scripts/eval-context.js [--fixture alpinaria --fixture atlas | --fixture <path>]
//        [--budget 1200] [--as-of YYYY-MM-DD] [--bootstrap 1000] [--seed 20261024]
//        [--label <name>] [--out <prefix>]
//
// For every query with a `sectionAnchor` label (`uri#slug`, written in WP0 before any search
// code), assembleContext runs with the budget and the fixture's as_of date, and the run reports:
// anchor hit rate (the labelled anchor is among the packed sections, the WP3a acceptance
// metric), hit@1 (it is the first section), concept-level Recall@5 of the candidate step
// (grade >= 1 concepts among the first five candidates), whether the labelled concept was a
// candidate at all (so a miss can be told apart as a candidate or a section-ranking miss), mean
// used tokens and sections, budget violations, and p50/p95 latency of assembleContext after a
// warm-up pass (the first, cold call that builds the per-index section corpus is reported
// separately). Every rate carries a seeded 1,000-sample percentile bootstrap 95% CI, per
// fixture and per split (dev, heldout, all).
//
// Every run writes <prefix>.json and <prefix>.md. The default prefix is the git-ignored
// test/fixtures/retrieval/reports/latest-context; a committed report is produced only with an
// explicit `--out test/fixtures/retrieval/reports/context-<version>-{date}`.

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { assembleContext, DEFAULT_CONTEXT_BUDGET_TOKENS } = require("../src/context/assemble");
const { buildProjectIndex } = require("../src/indexer");
const { resolveFixture } = require("./eval-search");

const FIXTURES_ROOT = path.join(__dirname, "..", "test", "fixtures", "retrieval");
const DEFAULT_OUT = path.join(FIXTURES_ROOT, "reports", "latest-context");
const DEFAULT_FIXTURES = ["alpinaria", "atlas"];
const DEFAULT_BOOTSTRAP = 1000;
const DEFAULT_SEED = 20261024;
const RECALL_CUTOFF = 5;
const SPLITS = ["dev", "heldout", "all"];
const CI_METRICS = ["anchorHit", "hitAt1", "conceptRecallAt5", "usedTokens", "sections"];

function usage() {
  return [
    "Usage: node scripts/eval-context.js [options]",
    "  --fixture <name|path>     Fixture under test/fixtures/retrieval or a directory with",
    "                            okf.project.yaml and queries.json (repeatable; default both).",
    `  --budget <tokens>         Token budget per query (default ${DEFAULT_CONTEXT_BUDGET_TOKENS}).`,
    "  --as-of <date>            Evaluation date (default: the fixture's as_of).",
    `  --bootstrap <n>           Bootstrap samples (default ${DEFAULT_BOOTSTRAP}).`,
    `  --seed <n>                Bootstrap seed (default ${DEFAULT_SEED}).`,
    "  --label <name>            Report title.",
    "  --out <prefix>            Output prefix; {date} becomes today (default reports/latest-context).",
  ].join("\n");
}

function positiveInteger(value, name, allowZero) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new TypeError(`${name} must be a${allowZero ? " non-negative" : " positive"} integer.`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    fixtures: [],
    budgetTokens: DEFAULT_CONTEXT_BUDGET_TOKENS,
    asOf: "",
    bootstrap: DEFAULT_BOOTSTRAP,
    seed: DEFAULT_SEED,
    label: "",
    out: DEFAULT_OUT,
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
    if (argument === "--fixture") options.fixtures.push(value);
    else if (argument === "--budget") options.budgetTokens = positiveInteger(value, "--budget");
    else if (argument === "--as-of") options.asOf = value;
    else if (argument === "--bootstrap") {
      options.bootstrap = positiveInteger(value, "--bootstrap", true);
    } else if (argument === "--seed") options.seed = positiveInteger(value, "--seed", true);
    else if (argument === "--label") options.label = value;
    else if (argument === "--out") options.out = value;
    else throw new TypeError(`Unknown option: ${argument}`);
  }
  if (options.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(options.asOf)) {
    throw new TypeError("--as-of must be YYYY-MM-DD.");
  }
  if (!options.fixtures.length) {
    options.fixtures = DEFAULT_FIXTURES.slice();
  }
  return options;
}

// ---------------------------------------------------------------------------- statistics
function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

// The generator eval-search.js uses, so both harnesses resample the same way.
function mulberry32(seed) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (list, key) =>
  list.length ? list.reduce((sum, entry) => sum + entry[key], 0) / list.length : null;

function bootstrap(list, samples, seed) {
  const intervals = {};
  const random = mulberry32(seed);
  const draws = Object.fromEntries(CI_METRICS.map((metric) => [metric, []]));
  for (let sample = 0; list.length && sample < samples; sample += 1) {
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
    intervals[metric] = { low, high, halfWidth: low === null ? null : (high - low) / 2 };
  });
  return intervals;
}

function summarize(rows, options) {
  const timings = rows.map((row) => row.ms);
  return {
    queries: rows.length,
    anchorHitRate: mean(rows, "anchorHit"),
    hitAt1: mean(rows, "hitAt1"),
    conceptRecallAt5: mean(rows, "conceptRecallAt5"),
    conceptCandidateRate: mean(rows, "conceptCandidate"),
    meanUsedTokens: mean(rows, "usedTokens"),
    meanSections: mean(rows, "sections"),
    maxUsedTokens: rows.length ? Math.max(...rows.map((row) => row.usedTokens)) : null,
    budgetExceeded: rows.filter((row) => row.budgetExceeded).length,
    truncated: rows.filter((row) => row.truncated).length,
    lowConfidence: rows.filter((row) => row.lowConfidence).length,
    latency: {
      p50Ms: percentile(timings, 0.5),
      p95Ms: percentile(timings, 0.95),
      maxMs: timings.length ? Math.max(...timings) : null,
    },
    ci: bootstrap(rows, options.bootstrap, options.seed),
  };
}

// ---------------------------------------------------------------------------- evaluation
function labelledAnchor(query) {
  const { uri, slug } = query.sectionAnchor;
  return slug ? `${uri}#${slug}` : uri;
}

function evaluateQuery(index, query, context) {
  const started = performance.now();
  const result = assembleContext(index, {
    query: query.query,
    budgetTokens: context.budgetTokens,
    asOf: context.asOf,
  });
  const ms = performance.now() - started;
  const anchor = labelledAnchor(query);
  const anchors = result.sections.map((section) => section.anchor);
  const position = anchors.indexOf(anchor);
  const candidates = result.concepts.map((concept) => concept.uri);
  const relevant = (query.expected || [])
    .filter((entry) => entry.grade >= 1)
    .map((entry) => `okf://${entry.bundle}/${entry.id}`);
  const top = new Set(candidates.slice(0, RECALL_CUTOFF));
  const sectionTokens = result.sections.reduce((sum, section) => sum + section.tokens, 0);
  return {
    id: query.id,
    split: query.split || null,
    lang: query.lang,
    category: query.category,
    anchor,
    anchorHit: position >= 0 ? 1 : 0,
    anchorRank: position >= 0 ? position + 1 : null,
    hitAt1: position === 0 ? 1 : 0,
    conceptCandidate: candidates.includes(query.sectionAnchor.uri) ? 1 : 0,
    conceptRecallAt5: relevant.length
      ? relevant.filter((uri) => top.has(uri)).length / relevant.length
      : 0,
    usedTokens: result.usedTokens,
    sections: result.sections.length,
    totalSections: result.totalSections,
    // Over budget, or the reported total disagrees with the sections it sums.
    budgetExceeded: result.usedTokens > context.budgetTokens || sectionTokens !== result.usedTokens,
    truncated: result.truncated,
    mode: result.mode,
    lowConfidence: result.lowConfidence,
    ms: Math.round(ms * 1000) / 1000,
    top: anchors.slice(0, 3),
  };
}

function evaluateFixture(fixture, options) {
  const sidecar = JSON.parse(fs.readFileSync(fixture.queries, "utf8"));
  const labelled = (sidecar.queries || []).filter((query) => query.sectionAnchor);
  const context = {
    budgetTokens: options.budgetTokens,
    asOf: options.asOf || sidecar.as_of || new Date().toISOString().slice(0, 10),
  };
  const buildStarted = performance.now();
  const index = buildProjectIndex(fixture.project);
  const okfIndexMs = performance.now() - buildStarted;
  // The first call builds the section corpus of this index; the warm-up pass then fills the
  // remaining lazy structures so the measured pass reflects steady state.
  let coldMs = null;
  labelled.forEach((query, position) => {
    const started = performance.now();
    assembleContext(index, {
      query: query.query,
      budgetTokens: context.budgetTokens,
      asOf: context.asOf,
    });
    if (position === 0) coldMs = performance.now() - started;
  });
  const rows = labelled.map((query) => evaluateQuery(index, query, context));
  const bySplit = {};
  SPLITS.forEach((split) => {
    const subset = split === "all" ? rows : rows.filter((row) => row.split === split);
    if (subset.length) bySplit[split] = summarize(subset, options);
  });
  return {
    fixture: fixture.name,
    project: path.relative(path.join(__dirname, ".."), fixture.project),
    asOf: context.asOf,
    budgetTokens: context.budgetTokens,
    corpus: { concepts: index.concepts.length, validForProject: index.validForProject },
    build: { okfIndexMs, firstCallMs: coldMs },
    bySplit,
    misses: rows
      .filter((row) => !row.anchorHit)
      .map((row) => ({
        id: row.id,
        split: row.split,
        anchor: row.anchor,
        conceptCandidate: Boolean(row.conceptCandidate),
      })),
    perQuery: rows,
  };
}

function runContextEvaluation(options) {
  const config = Object.assign(
    {
      fixtures: DEFAULT_FIXTURES.slice(),
      budgetTokens: DEFAULT_CONTEXT_BUDGET_TOKENS,
      asOf: "",
      bootstrap: DEFAULT_BOOTSTRAP,
      seed: DEFAULT_SEED,
      label: "",
    },
    options || {},
  );
  const report = {
    label: config.label || "src/context/assemble.js (lexical)",
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    budgetTokens: config.budgetTokens,
    estimator: "chars/4",
    bootstrap: { samples: config.bootstrap, seed: config.seed, confidence: 0.95 },
    fixtures: {},
  };
  config.fixtures.forEach((nameOrPath) => {
    const fixture = resolveFixture(nameOrPath);
    report.fixtures[fixture.name] = evaluateFixture(fixture, config);
  });
  return report;
}

// ------------------------------------------------------------------------------- reporting
const num = (value, digits) =>
  value === null || value === undefined ? "–" : Number(value).toFixed(digits);
const ci = (interval, digits) =>
  interval && interval.low !== null
    ? `[${num(interval.low, digits)}, ${num(interval.high, digits)}]`
    : "–";

function splitRow(name, split, summary) {
  return `| ${name} | ${split} | ${summary.queries} | ${num(summary.anchorHitRate, 3)} ${ci(summary.ci.anchorHit, 3)} | ${num(summary.hitAt1, 3)} ${ci(summary.ci.hitAt1, 3)} | ${num(summary.conceptRecallAt5, 3)} ${ci(summary.ci.conceptRecallAt5, 3)} | ${num(summary.conceptCandidateRate, 3)} | ${num(summary.meanUsedTokens, 0)} ${ci(summary.ci.usedTokens, 0)} | ${num(summary.meanSections, 1)} | ${summary.maxUsedTokens} | ${summary.budgetExceeded} | ${num(summary.latency.p50Ms, 2)} | ${num(summary.latency.p95Ms, 2)} |`;
}

function renderMarkdown(report) {
  const lines = [
    `# Context evaluation — ${report.label}`,
    "",
    `Generated ${report.generatedAt} · Node ${report.node} (${report.platform}) · budget ${report.budgetTokens} tokens (${report.estimator}) · bootstrap ${report.bootstrap.samples} samples (seed ${report.bootstrap.seed})`,
    "",
    "Produced by `scripts/eval-context.js` (`npm run eval:context`) over the queries with a `sectionAnchor` label. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest-context.{json,md}`; a committed report needs an explicit `--out`.",
    "",
    "Anchor hit: the labelled `uri#slug` is among the packed sections (WP3a acceptance: ≥ 0.80 on dev on both fixtures). hit@1: it is the first section. Concept R@5: grade ≥ 1 concepts among the first five candidates of the search step. Candidate: the labelled concept is among the candidates (default 10). Latency is assembleContext after a warm-up pass.",
    "",
    "| fixture | split | labelled | anchor hit (95% CI) | hit@1 (95% CI) | concept R@5 (95% CI) | candidate | mean tokens (95% CI) | mean sections | max tokens | over budget | p50 ms | p95 ms |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  Object.values(report.fixtures).forEach((result) => {
    Object.entries(result.bySplit).forEach(([split, summary]) => {
      lines.push(splitRow(result.fixture, split, summary));
    });
  });
  Object.values(report.fixtures).forEach((result) => {
    lines.push(
      "",
      `## ${result.fixture}`,
      "",
      `Project \`${result.project}\` · ${result.corpus.concepts} concepts · as-of ${result.asOf} · index build ${num(result.build.okfIndexMs, 0)} ms · first (cold) call ${num(result.build.firstCallMs, 1)} ms`,
      "",
    );
    if (!result.misses.length) {
      lines.push("No misses.");
      return;
    }
    lines.push(
      "| missed query | split | labelled anchor | concept was a candidate |",
      "|---|---|---|---|",
    );
    result.misses.forEach((miss) => {
      lines.push(
        `| ${miss.id} | ${miss.split} | \`${miss.anchor}\` | ${miss.conceptCandidate ? "yes" : "no"} |`,
      );
    });
  });
  return `${lines.join("\n")}\n`;
}

function summaryOf(report) {
  return Object.fromEntries(
    Object.values(report.fixtures).map((result) => [
      result.fixture,
      Object.fromEntries(
        Object.entries(result.bySplit).map(([split, summary]) => [
          split,
          {
            queries: summary.queries,
            anchorHitRate: summary.anchorHitRate,
            anchorHitCi: [summary.ci.anchorHit.low, summary.ci.anchorHit.high],
            hitAt1: summary.hitAt1,
            conceptRecallAt5: summary.conceptRecallAt5,
            meanUsedTokens: summary.meanUsedTokens,
            budgetExceeded: summary.budgetExceeded,
            p95Ms: summary.latency.p95Ms,
          },
        ]),
      ),
    ]),
  );
}

// One per-query row per line keeps the committed JSON reviewable.
function stringifyReport(report) {
  const placeholder = "__eval-context-per-query__";
  const shell = JSON.parse(JSON.stringify(report));
  const rows = {};
  Object.entries(shell.fixtures).forEach(([name, fixture]) => {
    rows[name] = fixture.perQuery;
    fixture.perQuery = `${placeholder}${name}`;
  });
  let text = JSON.stringify(shell, null, 2);
  Object.entries(rows).forEach(([name, entries]) => {
    const block = entries.length
      ? `[\n${entries.map((entry) => `        ${JSON.stringify(entry)}`).join(",\n")}\n      ]`
      : "[]";
    text = text.replace(JSON.stringify(`${placeholder}${name}`), () => block);
  });
  return text;
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
  const report = runContextEvaluation(options);
  const summary = summaryOf(report);
  summary.wrote = writeReport(report, options.out);
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
  DEFAULT_OUT,
  evaluateQuery,
  parseArgs,
  renderMarkdown,
  runContextEvaluation,
  summaryOf,
  writeReport,
};
