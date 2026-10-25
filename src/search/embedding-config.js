"use strict";

// Trusted configuration of hybrid search (docs/plan-1.0.md R-8a, R-9, R-10):
// `embedder`, `cacheDir`, `fusion.alpha` and `embedUnits`, read from
// okf.project.yaml or, for --root mode, from the file named by
// --embedder-config. Never from tool arguments (B-3, B-6). The embedder block
// is checked by constructing the client offline (no request, no key read
// from the real environment), so a bad value is reported at load time.

const fs = require("node:fs");
const path = require("node:path");

const { createOpenAiEmbedder } = require("../embed/openai");
const { parseFrontmatterYaml } = require("../parser");
const { DEFAULT_EMBED_UNITS, EMBED_UNITS } = require("./dense");
const {
  FUSION_NORMALIZATIONS,
  adaptiveWeights,
  fusionAlphaSetting,
  fusionNormalization,
} = require("./fusion");

const EMBEDDER_TYPES = Object.freeze(["openai"]);
const EMBEDDER_FIELDS = Object.freeze([
  "type",
  "baseUrl",
  "model",
  "apiKeyEnv",
  "dimensions",
  "batchSize",
  "timeoutMs",
  "maxRetries",
  "concurrency",
  "maxInputChars",
]);
const SETTINGS_FIELDS = Object.freeze(["embedder", "cacheDir", "fusion", "embedUnits"]);
const FUSION_FIELDS = Object.freeze(["alpha", "normalization", "adaptive"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkEmbedder(raw, errors) {
  if (!isObject(raw)) {
    errors.push({
      code: "invalid_embedder",
      field: "embedder",
      message: "embedder must be an object.",
    });
    return null;
  }
  let valid = true;
  Object.keys(raw)
    .filter((key) => !EMBEDDER_FIELDS.includes(key))
    .forEach((key) => {
      valid = false;
      errors.push({
        code: "unknown_embedder_field",
        field: `embedder.${key}`,
        message: `Unknown embedder field: ${key}`,
      });
    });
  if (!EMBEDDER_TYPES.includes(raw.type)) {
    errors.push({
      code: "invalid_embedder",
      field: "embedder.type",
      message: `embedder.type must be one of ${EMBEDDER_TYPES.join(", ")}.`,
    });
    return null;
  }
  const options = Object.assign({}, raw);
  delete options.type;
  try {
    const keyEnv = typeof options.apiKeyEnv === "string" ? options.apiKeyEnv : null;
    createOpenAiEmbedder(
      Object.assign({}, options, {
        env: keyEnv ? { [keyEnv]: "offline-validation" } : {},
        fetch: () => {
          throw new Error("offline validation");
        },
      }),
    );
  } catch (error) {
    const field = error?.details?.field;
    errors.push({
      code: "invalid_embedder",
      field: typeof field === "string" ? `embedder.${field}` : "embedder",
      message: error.message,
    });
    return null;
  }
  return valid ? Object.assign({}, raw) : null;
}

// Returns { embedder, cacheDir, fusion: { alpha }, embedUnits } or null when
// no embedder is configured; problems go to `errors` like other project
// config errors.
function normalizeEmbeddingConfig(config, errors) {
  const source = isObject(config) ? config : {};
  if (source.embedder === undefined || source.embedder === null) return null;
  const embedder = checkEmbedder(source.embedder, errors);
  let cacheDir = null;
  if (source.cacheDir !== undefined && source.cacheDir !== null) {
    if (typeof source.cacheDir !== "string" || !source.cacheDir.trim()) {
      errors.push({
        code: "invalid_cache_dir",
        field: "cacheDir",
        message: "cacheDir must be a non-empty path.",
      });
    } else {
      cacheDir = source.cacheDir;
    }
  }
  let alpha = fusionAlphaSetting(undefined);
  let normalization = fusionNormalization(undefined);
  let adaptive = null;
  if (source.fusion !== undefined) {
    const unknown = isObject(source.fusion)
      ? Object.keys(source.fusion).filter((key) => !FUSION_FIELDS.includes(key))
      : [];
    try {
      if (!isObject(source.fusion) || unknown.length) throw new TypeError("fusion");
      alpha = fusionAlphaSetting(source.fusion.alpha);
      normalization = fusionNormalization(source.fusion.normalization);
      // WP3c-2: the adaptive rule's weights, { low, mid, high } (defaults when unset).
      if (source.fusion.adaptive !== undefined) adaptive = adaptiveWeights(source.fusion.adaptive);
    } catch {
      errors.push({
        code: "invalid_fusion",
        field: "fusion",
        message: `fusion must be { alpha, normalization, adaptive } with alpha "adaptive" or a number between 0 and 1, normalization one of ${FUSION_NORMALIZATIONS.join(", ")} and adaptive { low, mid, high } between 0 and 1 with high >= mid.`,
      });
    }
  }
  let embedUnits = DEFAULT_EMBED_UNITS;
  if (source.embedUnits !== undefined) {
    if (!EMBED_UNITS.includes(source.embedUnits)) {
      errors.push({
        code: "invalid_embed_units",
        field: "embedUnits",
        message: `embedUnits must be one of ${EMBED_UNITS.join(", ")}.`,
      });
    } else {
      embedUnits = source.embedUnits;
    }
  }
  if (!embedder) return null;
  const fusion = { alpha, normalization };
  if (adaptive) fusion.adaptive = Object.assign({}, adaptive);
  return { embedder, cacheDir, fusion, embedUnits };
}

// The --embedder-config file (JSON, or YAML for any other extension): either
// the project keys ({ embedder, cacheDir, fusion, embedUnits }) or a bare
// embedder block ({ type: openai, ... }). Throws on any problem: this is an
// operator's file, read once at startup.
function loadEmbeddingConfigFile(file) {
  const absolute = path.resolve(String(file));
  const text = fs.readFileSync(absolute, "utf8");
  const parsed = absolute.endsWith(".json") ? JSON.parse(text) : parseFrontmatterYaml(text);
  const settings =
    isObject(parsed) && parsed.embedder === undefined && parsed.type !== undefined
      ? { embedder: parsed }
      : parsed;
  const errors = [];
  if (isObject(settings)) {
    Object.keys(settings)
      .filter((key) => !SETTINGS_FIELDS.includes(key))
      .forEach((key) => {
        errors.push({ code: "unknown_embedding_field", field: key });
      });
  }
  const normalized = normalizeEmbeddingConfig(settings, errors);
  if (errors.length || !normalized) {
    const fields = errors.map((entry) => entry.field).filter(Boolean);
    const error = new Error(
      `Invalid embedder configuration${fields.length ? ` (${fields.join(", ")})` : ": an embedder block is required"}.`,
    );
    error.code = "invalid_embedder_config";
    error.details = { errors: errors.map(({ code, field }) => ({ code, field })) };
    throw error;
  }
  return normalized;
}

module.exports = {
  EMBEDDER_FIELDS,
  loadEmbeddingConfigFile,
  normalizeEmbeddingConfig,
};
