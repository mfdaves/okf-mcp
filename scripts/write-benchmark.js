#!/usr/bin/env node
"use strict";

// Write-path benchmark (docs/plan-1.0.md section 4.6, WP2). Generates the
// synthetic bundle of scripts/index-benchmark.js in a temporary directory,
// initialises a git repository over it, then times batches of concept creates
// through LiveAuthoringService.applyChanges, the library apply path the MCP
// tool and the CLI share, with git commit off and then on. Reports p50/p95
// per batch, the time spent in git subprocesses within each batch, the
// incremental update over full build ratio, and lexical search p95 before and
// after the writes. Prints one JSON document.
//
//   node scripts/write-benchmark.js [--concepts 5000] [--batches 20] [--batch-size 5]
//        [--rounds 10] [--seed 20261024] [--keep]
//
// The budgets (section 4.6): a batch of five concepts with git commit on in
// 500 ms or less at 5,000 concepts, incremental over full build 0.3 or less,
// and search p95 unchanged by the writes.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { isDeepStrictEqual } = require("node:util");

const { LiveAuthoringService } = require("../src/authoring/live");
const { indexUpdateStats, refreshIndex, updateIndex } = require("../src/indexer");
const { searchConcepts } = require("../src/search");
const { FileConceptStore } = require("../src/store");
const { QUERIES, generateBundle } = require("./index-benchmark");

const BRANDS = ["Salewa", "Scarpa", "La Sportiva", "Montura", "Ferrino", "Garmont", "Lowa"];
const TAGS = ["scarpe", "shoes", "pagina", "page", "spedizione", "shipping"];

function parseArgs(argv) {
  const options = {
    concepts: 5000,
    batches: 20,
    batchSize: 5,
    rounds: 10,
    seed: 20261024,
    keep: false,
  };
  const numeric = {
    "--concepts": "concepts",
    "--batches": "batches",
    "--batch-size": "batchSize",
    "--rounds": "rounds",
    "--seed": "seed",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep") {
      options.keep = true;
    } else if (Object.hasOwn(numeric, arg)) {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${arg} needs a positive integer.`);
      }
      options[numeric[arg]] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

// mulberry32, the generator the fixtures use, so every run writes the same
// batches.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

// A repository the publisher accepts: a branch with a commit, an identity,
// and the proposal directory ignored so a batch leaves the worktree clean.
function initialiseGit(root) {
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "bench@example.com"]);
  git(root, ["config", "user.name", "Write benchmark"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".okf-proposals/\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "seed"]);
}

// The generator's index.md lists nothing; a reserved index needs at least one
// local link entry to be conformant, and the apply path refuses a batch that
// leaves the bundle non-conformant.
function writeIndexPage(root, targets) {
  const entries = targets.slice(0, 5).map((target) => `- [${target}](./${target})`);
  fs.writeFileSync(
    path.join(root, "index.md"),
    `---\nokf_version: "0.2"\n---\n\n# Synthetic write benchmark\n\n${entries.join("\n")}\n`,
  );
}

// The git subcommand behind the publisher's -C and -c prefixes.
function gitSubcommand(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-C" || args[index] === "-c") {
      index += 1;
    } else if (!args[index].startsWith("-")) {
      return args[index];
    }
  }
  return "?";
}

// A spawnSync for the service that adds up what git costs per batch, in
// total and per subcommand.
function countingSpawnSync() {
  const totals = { calls: 0, ms: 0, commands: new Map() };
  const spawn = (command, args, options) => {
    const started = performance.now();
    try {
      return spawnSync(command, args, options);
    } finally {
      const elapsed = performance.now() - started;
      totals.calls += 1;
      totals.ms += elapsed;
      const name = gitSubcommand(args);
      const entry = totals.commands.get(name) || { calls: 0, ms: 0 };
      entry.calls += 1;
      entry.ms += elapsed;
      totals.commands.set(name, entry);
    }
  };
  return { spawn, totals };
}

// Per-batch averages per git subcommand, costliest first.
function gitCommandBreakdown(commands, batches) {
  const breakdown = {};
  Array.from(commands.entries())
    .sort((left, right) => right[1].ms - left[1].ms)
    .forEach(([name, entry]) => {
      breakdown[name] = {
        callsPerBatch: round(entry.calls / batches),
        msPerBatch: round(entry.ms / batches),
      };
    });
  return breakdown;
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function median(values) {
  return percentile(values, 0.5);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function summary(values) {
  return {
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    max: round(Math.max(...values)),
    samples: values.length,
  };
}

function timed(fn) {
  const started = performance.now();
  const result = fn();
  return { ms: performance.now() - started, result };
}

async function timedAsync(fn) {
  const started = performance.now();
  const result = await fn();
  return { ms: performance.now() - started, result };
}

// A batch of concept creates linking into the existing bundle, so each one
// adds edges and dirties the lookup keys of the concepts it points at.
function batchChanges(label, batch, size, targets, rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  return Array.from({ length: size }, (_, position) => {
    const title = `${label} batch ${batch} concept ${position}`;
    return {
      op: "create",
      path: `bench/${label}/batch-${batch}-${position}.md`,
      type: "Keyword",
      title,
      tags: ["bench", pick(TAGS)],
      relations: [{ type: "related_to", target: `/${pick(targets)}` }],
      body: `# ${title}\n\nSee [a related concept](/${pick(targets)}) and ${pick(BRANDS)}.\n`,
    };
  });
}

// The same batch as index upserts, in the two forms the apply path uses: the
// rendered text at planning time and a read-back of the file once written.
function batchUpserts(bundleId, changes, persisted) {
  return changes.map((change) => {
    const upsert = { bundleId, relativePath: change.path };
    if (persisted) {
      return upsert;
    }
    return Object.assign(upsert, {
      text: `---\ntype: ${change.type}\ntitle: "${change.title}"\ntags: [${change.tags.join(", ")}]\nrelations:\n  - type: ${change.relations[0].type}\n    target: ${change.relations[0].target}\n---\n\n${change.body}`,
    });
  });
}

function searchLatencies(index, rounds) {
  const latencies = [];
  // The first query pays for the lexical index of this index object; it is
  // timed separately so p95 reflects steady-state queries.
  const warm = timed(() => searchConcepts(index, { query: QUERIES[0], limit: 10 })).ms;
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    QUERIES.forEach((query) => {
      latencies.push(timed(() => searchConcepts(index, { query, limit: 10 })).ms);
    });
  }
  return Object.assign(summary(latencies), { firstQueryMs: round(warm) });
}

// Times standalone updateIndex calls of one batch's size against a full
// build of the same bundle, the ratio section 4.6 budgets.
function measureUpdates(service, bundleId, targets, options) {
  const builds = [];
  let index = null;
  for (let sample = 0; sample < 3; sample += 1) {
    const { ms, result } = timed(() => service.buildIndex([]));
    builds.push(ms);
    index = result;
  }
  const rand = prng(options.seed + 3);
  const text = [];
  const readBack = [];
  let current = index;
  for (let sample = 0; sample < 10; sample += 1) {
    const changes = batchChanges("update", sample, options.batchSize, targets, rand);
    const planned = timed(() => updateIndex(current, { upserts: batchUpserts(bundleId, changes) }));
    text.push(planned.ms);
    // The read-back form parses the files, so they have to exist; they are
    // removed again before the apply runs, which creates its own paths.
    changes.forEach((change, position) => {
      const file = path.join(service.store.getBundles()[0].root, ...change.path.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, batchUpserts(bundleId, [change])[0].text);
      if (position === changes.length - 1) {
        const persisted = timed(() =>
          updateIndex(current, { upserts: batchUpserts(bundleId, changes, true) }),
        );
        readBack.push(persisted.ms);
      }
    });
    changes.forEach((change) => {
      fs.rmSync(path.join(service.store.getBundles()[0].root, ...change.path.split("/")));
    });
    current = planned.result;
  }
  const refreshNoop = timed(() => refreshIndex(index)).ms;
  return {
    index,
    fullBuildMs: { median: round(median(builds)), samples: builds.map(round) },
    incrementalUpdateMs: {
      text: { median: round(median(text)), samples: text.map(round) },
      readBack: { median: round(median(readBack)), samples: readBack.map(round) },
    },
    incrementalOverFull: Math.round((median(text) / median(builds)) * 1000) / 1000,
    refreshNoopMs: round(refreshNoop),
    lastUpdate: indexUpdateStats(current),
  };
}

async function runWriteBatches(store, index, options, targets, gitCommit) {
  const label = gitCommit ? "git-on" : "git-off";
  const rand = prng(options.seed + (gitCommit ? 2 : 1));
  const counting = countingSpawnSync();
  const service = new LiveAuthoringService(store, {
    actor: "bench/agent",
    gitCommit,
    spawnSync: counting.spawn,
  });
  // As in the MCP server, the service starts from the host's index instead
  // of building its own on the first batch.
  service.adoptIndex(index, []);
  const batches = [];
  const gitMs = [];
  const gitCalls = [];
  const statuses = {};
  for (let batch = 0; batch < options.batches; batch += 1) {
    const changes = batchChanges(label, batch, options.batchSize, targets, rand);
    const before = Object.assign({}, counting.totals);
    const { ms, result } = await timedAsync(() => service.applyChanges({ changes }));
    if (!result.applied) {
      throw new Error(
        `Batch ${batch} (${label}) was not applied: ${JSON.stringify(result.validation?.diagnostics || result)}`,
      );
    }
    statuses[result.status] = (statuses[result.status] || 0) + 1;
    batches.push(ms);
    gitMs.push(counting.totals.ms - before.ms);
    gitCalls.push(counting.totals.calls - before.calls);
  }
  const current = service.currentIndex([]);
  return {
    report: {
      gitCommit,
      batchMs: summary(batches),
      gitMs: summary(gitMs),
      gitCallsPerBatch: median(gitCalls),
      gitShareOfBatch: Math.round((median(gitMs) / median(batches)) * 1000) / 1000,
      gitCommands: gitCommandBreakdown(counting.totals.commands, options.batches),
      statuses,
      lastUpdate: indexUpdateStats(current),
    },
    index: current,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-write-benchmark-"));
  try {
    const generated = generateBundle(root, options.concepts, options.seed);
    const store = FileConceptStore.fromRoot(root);
    const bundleId = store.getBundles()[0].id;
    const probe = new LiveAuthoringService(store, { actor: "bench/agent" });
    const targets = probe.buildIndex([]).concepts.map((doc) => doc.path);
    writeIndexPage(root, targets);
    initialiseGit(root);

    const updates = measureUpdates(probe, bundleId, targets, options);
    const searchBefore = searchLatencies(updates.index, options.rounds);

    const gitOff = await runWriteBatches(store, updates.index, options, targets, false);
    // The git-on run needs a clean worktree to start from.
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "git-off batches"]);
    const gitOn = await runWriteBatches(store, gitOff.index, options, targets, true);

    const after = gitOn.index;
    const searchAfter = searchLatencies(after, options.rounds);
    const fresh = probe.buildIndex([]);
    const consistent = isDeepStrictEqual(after, fresh);

    const report = {
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      root: options.keep ? root : undefined,
      bundle: {
        concepts: updates.index.concepts.length,
        edges: updates.index.edges.length,
        bytes: generated.bytes,
      },
      batches: options.batches,
      batchSize: options.batchSize,
      fullBuildMs: updates.fullBuildMs,
      incrementalUpdateMs: updates.incrementalUpdateMs,
      incrementalOverFull: updates.incrementalOverFull,
      refreshNoopMs: updates.refreshNoopMs,
      write: { gitOff: gitOff.report, gitOn: gitOn.report },
      search: {
        queries: QUERIES.length,
        rounds: options.rounds,
        before: searchBefore,
        after: searchAfter,
        conceptsAfter: after.concepts.length,
      },
      // The index the writes left behind equals a fresh build of the files.
      incrementalIndexEqualsFreshBuild: consistent,
      budget: {
        writeBatchGitOnP95Under500ms: gitOn.report.batchMs.p95 <= 500,
        incrementalOverFullUnder0point3: updates.incrementalOverFull <= 0.3,
        searchP95Within25ms: searchAfter.p95 <= 25,
      },
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!consistent) {
      process.exitCode = 1;
    }
  } finally {
    if (!options.keep) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}

module.exports = { batchChanges, initialiseGit, parseArgs };
