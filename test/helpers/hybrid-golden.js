"use strict";

// Reproduction record for fixed fusion weights (WP3c-2): `alpha: 0.4` must rank exactly as
// 0.11.0-rc.2 did. The record holds, per fixture query, a digest of the serialised results of
// two pages of a hybrid search, computed by the source tree under `srcRoot` with a
// deterministic in-process embedder (hashed bag of words, so the dense side follows the text
// instead of being noise). test/fixtures/retrieval/rc2-hybrid-golden.json was produced by
// running `hybridDigests` against the rc.2 tree (`git archive bd41a7a src package.json`, with
// this repository's node_modules beside it); the test runs it against the current tree.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DIMENSION = 64;
const FIXTURES = ["alpinaria", "atlas"];
const FIXTURES_ROOT = path.join(__dirname, "..", "fixtures", "retrieval");
// Search options per record entry; every one fixes alpha at the rc.2 default.
const OPTION_SETS = Object.freeze([
  Object.freeze({ alpha: 0.4 }),
  Object.freeze({ alpha: 0.4, mode: "any", freshnessPrior: true, fusionNormalization: "minmax" }),
]);

function bagOfWordsVector(text) {
  const vector = new Float32Array(DIMENSION);
  String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)
    .forEach((word) => {
      const digest = crypto.createHash("sha256").update(word).digest();
      vector[digest[0] % (DIMENSION - 1)] += 1;
      vector[digest[1] % (DIMENSION - 1)] += digest[2] & 1 ? 0.5 : -0.5;
    });
  vector[DIMENSION - 1] += 0.01;
  return vector;
}

function bagOfWordsEmbedder() {
  return {
    id: `memory:bag-of-words:${DIMENSION}`,
    dimension: DIMENSION,
    languages: ["en", "it"],
    remote: false,
    maxBatch: 2048,
    maxInputChars: 100000,
    async embed(texts) {
      return texts.map(bagOfWordsVector);
    },
  };
}

const digest = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

// { [optionSetIndex]: { [fixture]: { [queryId]: digest } } } computed by the tree at srcRoot.
async function hybridDigests(srcRoot) {
  const { buildProjectIndex } = require(path.join(srcRoot, "indexer"));
  const { openEmbeddingRuntime } = require(path.join(srcRoot, "search", "hybrid"));
  const { searchConcepts } = require(path.join(srcRoot, "search", "query"));
  const out = {};
  OPTION_SETS.forEach((_options, position) => {
    out[position] = {};
  });
  for (const name of FIXTURES) {
    const root = path.join(FIXTURES_ROOT, name);
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "okf-hybrid-golden-"));
    try {
      const runtime = await openEmbeddingRuntime(
        { embedder: bagOfWordsEmbedder(), cacheDir },
        { root },
      );
      const index = buildProjectIndex(path.join(root, "okf.project.yaml"));
      await runtime.sync(index);
      const sidecar = JSON.parse(fs.readFileSync(path.join(root, "queries.json"), "utf8"));
      for (const query of sidecar.queries) {
        const { vector } = await runtime.encodeQuery(query.query);
        OPTION_SETS.forEach((options, position) => {
          const base = Object.assign(
            {
              query: query.query,
              limit: 10,
              asOf: sidecar.as_of,
              hybrid: true,
              queryVector: vector,
              vectorCache: runtime.cache,
              embedUnits: runtime.units,
            },
            options,
          );
          const first = searchConcepts(index, base).results;
          const second = searchConcepts(
            index,
            Object.assign({}, base, { offset: 10, limit: 5, detail: "compact" }),
          ).results;
          out[position][name] = out[position][name] || {};
          out[position][name][query.id] = digest(JSON.stringify([first, second]));
        });
      }
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }
  return out;
}

module.exports = { OPTION_SETS, bagOfWordsEmbedder, hybridDigests };
