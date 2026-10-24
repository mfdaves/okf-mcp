"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildIndex } = require("../../src/indexer");

// A small catalog and a deterministic "topic" embedder for the hybrid search
// tests: each vector dimension counts the words of one topic, so a query that
// shares no word with a concept can still be close to it (a synonym), which
// is what dense retrieval adds over lexical search.

const TOPICS = [
  ["snow", "ski", "winter", "neve", "sci"],
  ["boot", "boots", "footwear", "scarpone", "scarponi", "shoe"],
  ["shipping", "delivery", "courier", "spedizione"],
  ["price", "cost", "prezzo", "tariff"],
  ["refund", "return", "reso", "rimborso"],
  ["bike", "bicycle", "cycling", "bici"],
];

function topicVector(text) {
  const words = String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const vector = new Float32Array(TOPICS.length + 1);
  words.forEach((word) => {
    TOPICS.forEach((topic, dimension) => {
      if (topic.includes(word)) vector[dimension] += 1;
    });
  });
  // A small constant component keeps every vector non-zero.
  vector[TOPICS.length] = 0.05;
  return vector;
}

function topicEmbedder(options) {
  const config = options || {};
  const state = { calls: 0, inputs: 0, fail: null };
  const embedder = {
    id: config.id || "memory:topics:7",
    dimension: TOPICS.length + 1,
    languages: ["en", "it"],
    remote: false,
    maxBatch: config.maxBatch || 16,
    maxInputChars: 4000,
    async embed(texts) {
      state.calls += 1;
      if (state.fail) throw state.fail;
      state.inputs += texts.length;
      return texts.map(topicVector);
    },
    usage() {
      return { requests: state.calls, retries: 0, promptTokens: state.inputs * 10, totalTokens: 0 };
    },
  };
  return { embedder, state };
}

function writeConcept(root, relativePath, frontmatter, body) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const metadata = Object.entries(frontmatter).map(([key, value]) =>
    Array.isArray(value) ? `${key}: [${value.join(", ")}]` : `${key}: ${value}`,
  );
  fs.writeFileSync(target, ["---", ...metadata, "---", "", body || "", ""].join("\n"), "utf8");
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const CONCEPTS = [
  ["ski-boots.md", "Product", "Ski boots", ["gear"], "Scarponi for winter ski touring and snow."],
  ["trail-shoes.md", "Product", "Trail shoes", ["gear"], "Footwear for summer trails."],
  ["delivery.md", "Policy", "Delivery times", ["service"], "Courier delivery in two days."],
  ["pricing.md", "Policy", "Price list", ["service"], "Every tariff and cost in one table."],
  ["refunds.md", "Policy", "Refund policy", ["service"], "How a return becomes a rimborso."],
  ["bikes.md", "Product", "Bicycles", ["gear"], "Cycling gear and bici for the road."],
];

function hybridWorld(t) {
  const root = tempDir(t, "okf-hybrid-");
  CONCEPTS.forEach(([file, type, title, tags, body]) => {
    writeConcept(root, file, { type, title, tags }, `# ${title}\n\n${body}`);
  });
  const bundle = { id: "shop", root };
  return { root, bundle, index: buildIndex([bundle]), reindex: () => buildIndex([bundle]) };
}

module.exports = {
  CONCEPTS,
  TOPICS,
  hybridWorld,
  tempDir,
  topicEmbedder,
  topicVector,
  writeConcept,
};
