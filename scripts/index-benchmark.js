#!/usr/bin/env node
"use strict";

// Index scaling benchmark (docs/plan-1.0.md section 4.6): cold OKF index build, search index
// build, query latency and RSS at 1k / 5k / 20k synthetic concepts.
//
//   node --expose-gc scripts/index-benchmark.js [--sizes 1000,5000,20000] [--rounds 10]
//        [--seed 20261024] [--search-module <abs path>] [--search-options '<json>']
//        [--work-dir <dir>] [--keep] [--out <prefix>]
//
// Each size runs in its own child process so RSS reflects one index, not the accumulation of
// all sizes. The synthetic bundle is bilingual (60% Italian, 30% English, 10% mixed) with the
// vocabulary of the 0.10 prototype benchmarks, generated deterministically from the seed into a
// temporary directory that is removed afterwards unless --keep is given. The search module
// defaults to the shipped searchConcepts; a module exporting prepare(index) has that call timed
// as its search index build, which is how WP1 measures stemmed against unstemmed builds.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const DEFAULT_SIZES = [1000, 5000, 20000];
const DEFAULT_ROUNDS = 10;
const DEFAULT_SEED = 20261024;
const DEFAULT_SEARCH_MODULE = path.join(__dirname, "..", "src", "search.js");

const QUERIES = [
  "scarpe da trekking impermeabili", "scarpa trekking impermeabile", "perché la pagina prodotto carica lentamente",
  "spedizione gratuita e resi", "ottimizzare le descrizioni duplicate delle categorie", "Salewa Alp Trainer 2 GTX",
  "giacca leggera traspirante prezzo", "monitoraggio posizionamento parole chiave", "indicizzazione pagine nuove",
  "recensioni clienti prodotto", "why is the category page loading slowly", "duplicate meta descriptions on product pages",
  "keyword cannibalization between categories", "waterproof hiking shoes cheap", "La Sportiva Nepal Evo", "improve organic traffic conversions",
  "writing titles and descriptions", "internal links crawl budget", "backlinks", "scarpe", "ranking", "Montura",
  "how to optimize images for faster loading on mobile", "analisi dei competitor per le pagine categoria", "return policy for orders",
  "traffico organico in calo dopo la migrazione", "indexed pages dropped", "zaino leggero per trekking", "best lightweight jackets", "sconti",
];

function usage() {
  return [
    "Usage: node --expose-gc scripts/index-benchmark.js [options]",
    "",
    "Options:",
    "  --sizes <list>            Comma-separated concept counts (default 1000,5000,20000).",
    "  --rounds <n>              Measured rounds over the 30-query set per size (default 10).",
    "  --seed <n>                Generator seed (default 20261024).",
    "  --search-module <path>    Module exporting searchConcepts(index, options) or search(index, options).",
    "  --search-options <json>   Extra options merged into every search call.",
    "  --work-dir <dir>          Where synthetic bundles are generated (default: a temporary directory).",
    "  --keep                    Keep the generated bundles.",
    "  --out <prefix>            Write <prefix>.json and <prefix>.md.",
    "  --help                    Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { sizes: DEFAULT_SIZES.slice(), rounds: DEFAULT_ROUNDS, seed: DEFAULT_SEED, searchModule: "", searchOptions: {}, workDir: "", keep: false, out: "", child: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--keep") {
      options.keep = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new TypeError(`${argument} requires a value.`);
    }
    index += 1;
    switch (argument) {
      case "--sizes": options.sizes = value.split(",").map((part) => Number(part.trim())); break;
      case "--rounds": options.rounds = Number(value); break;
      case "--seed": options.seed = Number(value); break;
      case "--search-module": options.searchModule = value; break;
      case "--search-options": options.searchOptions = JSON.parse(value); break;
      case "--work-dir": options.workDir = value; break;
      case "--out": options.out = value; break;
      case "--child": options.child = value; break;
      default: throw new TypeError(`Unknown option: ${argument}`);
    }
  }
  if (options.help) {
    return options;
  }
  if (!options.sizes.length || options.sizes.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 200000)) {
    throw new TypeError("--sizes must be integers from 1 through 200000.");
  }
  if (!Number.isSafeInteger(options.rounds) || options.rounds < 1 || options.rounds > 1000) {
    throw new TypeError("--rounds must be an integer from 1 through 1000.");
  }
  if (!Number.isSafeInteger(options.seed)) {
    throw new TypeError("--seed must be an integer.");
  }
  return options;
}

// ------------------------------------------------------------------------- synthetic bundle
const IT = {
  nouns: ["scarpe", "scarpa", "giacca", "giacche", "zaino", "zaini", "pagina", "pagine", "prodotto", "prodotti", "categoria", "categorie", "spedizione", "spedizioni", "reso", "resi", "parola chiave", "parole chiave", "recensione", "recensioni", "immagine", "immagini", "descrizione", "descrizioni", "titolo", "titoli", "link interni", "backlink", "contenuto", "contenuti", "cliente", "clienti", "ordine", "ordini", "prezzo", "prezzi", "sconto", "sconti", "traffico", "conversione", "conversioni"],
  adj: ["impermeabile", "impermeabili", "leggero", "leggera", "leggeri", "traspirante", "traspiranti", "lento", "lenta", "lenti", "veloce", "veloci", "duplicato", "duplicata", "duplicati", "ottimizzato", "ottimizzata", "gratuito", "gratuita", "gratuite", "nuovo", "nuova", "migliore", "migliori", "economico", "economici"],
  verbs: ["ottimizzare", "ottimizza", "ottimizzato", "caricare", "carica", "caricamento", "migliorare", "migliora", "miglioramento", "indicizzare", "indicizzazione", "indicizzata", "scrivere", "scritto", "scrittura", "analizzare", "analisi", "analizzato", "monitorare", "monitoraggio", "posizionare", "posizionamento", "convertire", "conversione"],
  stop: ["la", "le", "il", "i", "di", "da", "per", "con", "su", "nella", "del", "della", "dei", "e", "è", "non", "come", "perché", "che", "un", "una"],
};
const EN = {
  nouns: ["shoes", "shoe", "jacket", "jackets", "page", "pages", "product", "products", "category", "categories", "shipping", "return", "returns", "keyword", "keywords", "review", "reviews", "image", "images", "description", "descriptions", "title", "titles", "internal links", "backlinks", "content", "customer", "customers", "order", "orders", "price", "prices", "discount", "traffic", "conversion", "conversions", "ranking", "rankings", "snippet", "crawl budget"],
  adj: ["waterproof", "lightweight", "breathable", "slow", "slower", "fast", "faster", "duplicate", "duplicated", "optimized", "free", "new", "best", "cheap", "cheaper", "mobile", "organic"],
  verbs: ["optimize", "optimizing", "optimized", "load", "loading", "loads", "improve", "improving", "improvement", "index", "indexing", "indexed", "write", "writing", "written", "analyze", "analyzing", "analysis", "monitor", "monitoring", "rank", "ranking", "convert", "converting"],
  stop: ["the", "a", "an", "of", "for", "with", "on", "in", "and", "is", "are", "not", "how", "why", "that", "to"],
};
const BRANDS = ["Salewa", "Scarpa", "La Sportiva", "Montura", "Ferrino", "Garmont", "Dolomite", "Aku", "Karpos", "Zamberlan", "Lowa", "Meindl", "Asolo", "Tecnica", "Nordica"];
const MODELS = ["Alp Trainer 2 GTX", "Wildfire Edge", "Mojito", "Trango Tech", "Nepal Evo", "Aequilibrium", "Renegade", "Vertical Ultra", "Crodarossa", "Drago", "Flash Mid", "Tower Pro"];
const TYPES = ["Keyword", "Landing Page", "Product", "Brand", "Guide", "Competitor", "Issue", "Playbook"];

function mulberry32(seed) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateBundle(root, count, seed) {
  const random = mulberry32(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const picks = (list, n) => Array.from({ length: n }, () => pick(list));
  const sentence = (lexicon) => {
    const parts = [];
    const n = 8 + Math.floor(random() * 10);
    for (let i = 0; i < n; i += 1) {
      const r = random();
      parts.push(r < 0.35 ? pick(lexicon.nouns) : r < 0.55 ? pick(lexicon.adj) : r < 0.75 ? pick(lexicon.verbs) : r < 0.95 ? pick(lexicon.stop) : `${pick(BRANDS)} ${pick(MODELS)}`);
    }
    const text = parts.join(" ");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  };
  const paragraph = (lexicon, sentences) => Array.from({ length: sentences }, () => sentence(lexicon)).join(" ");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "index.md"), "---\nokf_version: \"0.2\"\n---\n\n# Synthetic scaling bundle\n", "utf8");
  const paths = [];
  let bytes = 0;
  for (let i = 0; i < count; i += 1) {
    const r = random();
    const lang = r < 0.6 ? "it" : r < 0.9 ? "en" : "mixed";
    const lexicon = lang === "en" ? EN : IT;
    const type = pick(TYPES);
    const brand = pick(BRANDS);
    const model = pick(MODELS);
    const title = type === "Product" ? `${brand} ${model} ${pick(lexicon.adj)}` : type === "Brand" ? `${brand} ${pick(lexicon.nouns)}` : `${pick(lexicon.verbs)} ${pick(lexicon.nouns)} ${pick(lexicon.adj)} ${pick(lexicon.nouns)}`;
    const dir = `${lang}/${type.toLowerCase().replace(/\s+/g, "-")}`;
    const relative = `${dir}/${String(i).padStart(5, "0")}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}.md`;
    const tags = Array.from(new Set(picks(lexicon.nouns, 2).concat([brand.toLowerCase().replace(/\s+/g, "-")]))).map((tag) => tag.replace(/\s+/g, "-"));
    const aliases = random() < 0.4 ? [`${brand} ${model}`] : [];
    const related = paths.length && random() < 0.7 ? `relations:\n  - type: related_to\n    target: /${pick(paths)}\n` : "";
    const bodyLexicon = lang === "mixed" ? (random() < 0.5 ? IT : EN) : lexicon;
    const body = `# ${title}\n\n${paragraph(bodyLexicon, 4)}\n\n## ${lang === "en" ? "Notes" : "Note"}\n\n${paragraph(lang === "mixed" ? EN : bodyLexicon, 3)}\n`;
    const frontmatter = `type: ${type}\ntitle: "${title.replace(/"/g, "'")}"\ndescription: "${sentence(lexicon).replace(/"/g, "'")}"\ntags: [${tags.join(", ")}]\n${aliases.length ? `aliases: ["${aliases.join('", "')}"]\n` : ""}${related}`;
    const text = `---\n${frontmatter}---\n\n${body}`;
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), text, "utf8");
    bytes += Buffer.byteLength(text);
    paths.push(relative);
  }
  return { concepts: paths.length, bytes };
}

// --------------------------------------------------------------------------------- child
function memory() {
  if (typeof global.gc === "function") {
    global.gc();
  }
  const usage = process.memoryUsage();
  return { rssMb: Math.round((usage.rss / 1048576) * 10) / 10, heapUsedMb: Math.round((usage.heapUsed / 1048576) * 10) / 10 };
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] : null;
}

function runChild(root, options) {
  const { buildIndex } = require("../src/indexer");
  const modulePath = options.searchModule ? path.resolve(options.searchModule) : DEFAULT_SEARCH_MODULE;
  const loaded = require(modulePath);
  const fn = typeof loaded.searchConcepts === "function" ? loaded.searchConcepts : loaded.search;
  if (typeof fn !== "function") {
    throw new TypeError(`${modulePath} exports neither searchConcepts nor search.`);
  }
  const before = memory();
  const buildStarted = performance.now();
  const index = buildIndex([{ id: "scale", root }], { allowCustomRelationTypes: true });
  const okfIndexMs = performance.now() - buildStarted;
  const afterOkf = memory();
  const prepareStarted = performance.now();
  if (typeof loaded.prepare === "function") {
    loaded.prepare(index, { okf: path.join(__dirname, ".."), options: options.searchOptions });
  } else if (modulePath === DEFAULT_SEARCH_MODULE) {
    require("../src/search-index").prepareSearchIndex(index);
  } else {
    fn(index, Object.assign({ query: QUERIES[0], limit: 10 }, options.searchOptions));
  }
  const searchIndexMs = performance.now() - prepareStarted;
  const afterSearch = memory();
  const search = (query) => fn(index, Object.assign({ query, limit: 10 }, options.searchOptions));
  for (let warmup = 0; warmup < 2; warmup += 1) {
    QUERIES.forEach(search);
  }
  const timings = [];
  let totals = 0;
  for (let round = 0; round < options.rounds; round += 1) {
    QUERIES.forEach((query) => {
      const started = performance.now();
      const out = search(query);
      timings.push(performance.now() - started);
      totals += typeof out.total === "number" ? out.total : (out.results || out).length;
    });
  }
  const end = memory();
  return {
    concepts: index.concepts.length,
    documents: index.documents.length,
    validForProject: index.validForProject,
    okfIndexMs: Math.round(okfIndexMs),
    searchIndexMs: Math.round(searchIndexMs),
    coldBuildMs: Math.round(okfIndexMs + searchIndexMs),
    queries: QUERIES.length,
    rounds: options.rounds,
    p50Ms: Math.round(percentile(timings, 0.5) * 100) / 100,
    p95Ms: Math.round(percentile(timings, 0.95) * 100) / 100,
    maxMs: Math.round(Math.max.apply(null, timings) * 100) / 100,
    avgTotal: Math.round(totals / timings.length),
    rssBeforeMb: before.rssMb,
    rssAfterOkfIndexMb: afterOkf.rssMb,
    rssAfterSearchIndexMb: afterSearch.rssMb,
    rssEndMb: end.rssMb,
    heapUsedEndMb: end.heapUsedMb,
  };
}

// -------------------------------------------------------------------------------- parent
function renderMarkdown(report) {
  const lines = [`# Index scaling benchmark — ${report.searchModule.path}`, ""];
  lines.push(`Generated ${report.generatedAt} · Node ${report.node} (${report.platform}, gc exposed: ${report.exposedGc}) · seed ${report.seed} · ${report.queries} queries x ${report.rounds} rounds per size${Object.keys(report.searchModule.options).length ? ` · options \`${JSON.stringify(report.searchModule.options)}\`` : ""}`, "");
  lines.push("| concepts | markdown MB | generate ms | OKF index ms | search index ms | cold build ms | p50 ms | p95 ms | max ms | RSS before / after build / end MB | heap end MB |", "|---|---|---|---|---|---|---|---|---|---|---|");
  report.sizes.forEach((row) => {
    lines.push(`| ${row.concepts} | ${row.markdownMb} | ${row.generateMs} | ${row.okfIndexMs} | ${row.searchIndexMs} | ${row.coldBuildMs} | ${row.p50Ms} | ${row.p95Ms} | ${row.maxMs} | ${row.rssBeforeMb} / ${row.rssAfterSearchIndexMb} / ${row.rssEndMb} | ${row.heapUsedEndMb} |`);
  });
  lines.push("", "Budgets (section 4.6, at 5,000 concepts; stretch at 20,000 in parentheses): cold build <= 2.0 s (8 s), lexical p95 <= 25 ms (120 ms), RSS without embedder <= 300 MB (600 MB). Each size runs in its own child process.", "");
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.child) {
    process.stdout.write(`${JSON.stringify(runChild(path.resolve(options.child), options))}\n`);
    return;
  }
  const workDir = options.workDir ? path.resolve(options.workDir) : fs.mkdtempSync(path.join(os.tmpdir(), "okf-index-benchmark-"));
  fs.mkdirSync(workDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    exposedGc: typeof global.gc === "function",
    seed: options.seed,
    queries: QUERIES.length,
    rounds: options.rounds,
    searchModule: { path: path.relative(path.join(__dirname, ".."), options.searchModule ? path.resolve(options.searchModule) : DEFAULT_SEARCH_MODULE), options: options.searchOptions },
    workDir,
    sizes: [],
  };
  try {
    options.sizes.forEach((size) => {
      const root = path.join(workDir, `bundle-${size}`);
      const generateStarted = performance.now();
      const generated = generateBundle(root, size, options.seed);
      const generateMs = Math.round(performance.now() - generateStarted);
      const childArgs = [];
      if (typeof global.gc === "function") {
        childArgs.push("--expose-gc");
      }
      childArgs.push(__filename, "--child", root, "--rounds", String(options.rounds));
      if (options.searchModule) {
        childArgs.push("--search-module", options.searchModule);
      }
      if (Object.keys(options.searchOptions).length) {
        childArgs.push("--search-options", JSON.stringify(options.searchOptions));
      }
      const child = spawnSync(process.execPath, childArgs, { encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
      if (child.error) {
        throw child.error;
      }
      if (child.status !== 0) {
        throw new Error(`child for ${size} concepts failed: ${child.stderr}`);
      }
      report.sizes.push(Object.assign({ generateMs, markdownMb: Math.round((generated.bytes / 1048576) * 10) / 10 }, JSON.parse(child.stdout)));
    });
  } finally {
    if (!options.keep && !options.workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
  if (options.out) {
    const prefix = path.resolve(options.out.replace("{date}", new Date().toISOString().slice(0, 10)));
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(`${prefix}.md`, renderMarkdown(report));
    report.wrote = [`${prefix}.json`, `${prefix}.md`];
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

module.exports = { QUERIES, generateBundle, parseArgs, renderMarkdown };
