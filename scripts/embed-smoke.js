#!/usr/bin/env node
"use strict";

// Live smoke of the embeddings client against a real OpenAI-compatible
// endpoint (docs/plan-1.0.md WP3b). Opt-in only and never run by CI: it does
// nothing unless OKF_EMBED_SMOKE=1, OKF_EMBED_BASE_URL and OKF_EMBED_MODEL are
// set and the key variable named by OKF_EMBED_API_KEY_ENV (default
// OPENAI_API_KEY; "none" for a server without authentication) is present.
//
//   OKF_EMBED_SMOKE=1 OKF_EMBED_BASE_URL=https://api.openai.com \
//   OKF_EMBED_MODEL=text-embedding-3-small OKF_EMBED_DIMENSIONS=512 \
//   node scripts/embed-smoke.js [--project <okf.project.yaml>] [--cache-dir <dir>]
//
// Runs prepareEmbeddings twice on the alpinaria fixture (or the given project)
// and prints both receipts: the first embeds everything, the second must issue
// no request. Optional: OKF_EMBED_BATCH_SIZE, OKF_EMBED_CONCURRENCY.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openVectorCache } = require("../src/cache/store");
const { createOpenAiEmbedder } = require("../src/embed/openai");
const { prepareEmbeddings } = require("../src/embed/prepare");
const { buildProjectIndex } = require("../src/indexer");

const DEFAULT_PROJECT = path.join(
  __dirname,
  "..",
  "test",
  "fixtures",
  "retrieval",
  "alpinaria",
  "okf.project.yaml",
);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function integerEnv(name) {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? undefined : Number(raw);
}

async function main() {
  const env = process.env;
  if (env.OKF_EMBED_SMOKE !== "1") {
    console.log("embed-smoke: skipped (set OKF_EMBED_SMOKE=1 to run against a live endpoint).");
    return 0;
  }
  const apiKeyEnv = env.OKF_EMBED_API_KEY_ENV || "OPENAI_API_KEY";
  const missing = ["OKF_EMBED_BASE_URL", "OKF_EMBED_MODEL"].filter((name) => !env[name]);
  if (apiKeyEnv !== "none" && !env[apiKeyEnv]) missing.push(apiKeyEnv);
  if (missing.length) {
    console.log(`embed-smoke: skipped (missing ${missing.join(", ")}).`);
    return 0;
  }
  const projectPath = path.resolve(argument("--project") || DEFAULT_PROJECT);
  const cacheDir = path.resolve(
    argument("--cache-dir") || fs.mkdtempSync(path.join(os.tmpdir(), "okf-embed-smoke-")),
  );
  const embedder = createOpenAiEmbedder({
    baseUrl: env.OKF_EMBED_BASE_URL,
    model: env.OKF_EMBED_MODEL,
    apiKeyEnv: apiKeyEnv === "none" ? undefined : apiKeyEnv,
    dimensions: integerEnv("OKF_EMBED_DIMENSIONS"),
    batchSize: integerEnv("OKF_EMBED_BATCH_SIZE"),
    concurrency: integerEnv("OKF_EMBED_CONCURRENCY"),
  });
  const probe = await embedder.probe();
  console.log(`embed-smoke: ${probe.id} remote=${embedder.remote} cache=${cacheDir}`);
  const cache = openVectorCache(cacheDir, {
    embedderId: probe.id,
    dimension: probe.dimension,
    root: path.dirname(projectPath),
  });
  const index = buildProjectIndex(projectPath);
  const first = await prepareEmbeddings(index, embedder, cache, {
    onProgress: (event) => console.log(`embed-smoke: ${event.embedded}/${event.total} embedded`),
  });
  console.log(JSON.stringify({ run: 1, ...first }, null, 2));
  const second = await prepareEmbeddings(index, embedder, cache);
  console.log(JSON.stringify({ run: 2, ...second }, null, 2));
  if (second.requests !== 0) {
    console.error("embed-smoke: the second run issued requests; the cache did not hold.");
    return 1;
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const code = error?.code ? ` [${error.code}]` : "";
    console.error(`embed-smoke: failed${code}: ${error?.message ? error.message : error}`);
    if (error?.details) console.error(JSON.stringify(error.details));
    process.exitCode = 1;
  },
);
