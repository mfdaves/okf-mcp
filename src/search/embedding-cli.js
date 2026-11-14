"use strict";

// Command-line flags for hybrid search in --root mode (WP3c), kept out of
// the main option parser (src/cli/options.js): --embedder-config <file> names the
// trusted embedder settings (src/search/embedding-config.js) and --cache-dir
// <dir> overrides the vector cache location. They are taken out of argv
// before the main parser runs and handed to the stdio server untouched.

const EMBEDDING_FLAGS = Object.freeze({
  "--embedder-config": "configPath",
  "--cache-dir": "cacheDir",
});

const EMBEDDING_USAGE =
  "  --embedder-config <file>    Hybrid search for --root mode: embedder, fusion, embedUnits (JSON or YAML); --cache-dir <dir> overrides the vector cache location.";

function usageError(message) {
  const error = new Error(message);
  error.name = "UsageError";
  error.code = "OKF_USAGE_ERROR";
  error.exitCode = 2;
  return error;
}

// -> { argv: the remaining arguments, embedding: { configPath?, cacheDir? } }
function splitEmbeddingArgs(argv) {
  const rest = [];
  const embedding = {};
  const list = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < list.length; index += 1) {
    const arg = list[index];
    const field = Object.hasOwn(EMBEDDING_FLAGS, arg) ? EMBEDDING_FLAGS[arg] : null;
    if (!field) {
      rest.push(arg);
      continue;
    }
    const value = list[index + 1];
    if (!value || String(value).startsWith("-")) {
      throw usageError(`${arg} requires a file or directory path.`);
    }
    embedding[field] = value;
    index += 1;
  }
  return { argv: rest, embedding };
}

// The stdio server option, present only when a flag was given.
function embeddingServerOptions(args) {
  const embedding = args?.embedding || {};
  return embedding.configPath || embedding.cacheDir ? { embedding } : {};
}

module.exports = {
  EMBEDDING_USAGE,
  embeddingServerOptions,
  splitEmbeddingArgs,
};
