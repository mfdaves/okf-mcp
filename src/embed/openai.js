"use strict";

// Zero-dependency client for the OpenAI embeddings API and compatible servers
// (docs/plan-1.0.md R-8a): POST {baseUrl}/v1/embeddings over the global fetch
// of Node 22+. Every setting arrives through the options object from trusted
// project configuration; nothing here reads tool arguments. The API key is read
// once from the named environment variable and lives only in this closure.
// Errors carry a code and an HTTP status but never input text, the key, or a
// server message that could echo input (B-6, S-2).

const { EmbedderError } = require("./interface");
const { version: PACKAGE_VERSION } = require("../../package.json");

// Published limits of the OpenAI embeddings endpoint; compatible servers are
// usually looser, never stricter in a way the configuration cannot express.
const OPENAI_EMBEDDING_LIMITS = Object.freeze({
  maxBatch: 2048,
  maxRequestTokens: 300000,
  maxInputTokens: 8192,
  charsPerToken: 4,
});

const OPENAI_EMBEDDER_DEFAULTS = Object.freeze({
  batchSize: 512,
  timeoutMs: 60000,
  maxRetries: 5,
  concurrency: 2,
  maxInputChars: 32000,
  maxRequestTokens: OPENAI_EMBEDDING_LIMITS.maxRequestTokens,
});

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 30000;
const RETRY_AFTER_CAP_MS = 60000;
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const MAX_SERVER_MESSAGE_CHARS = 200;
const PROBE_TEXT = "okf-mcp";
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,64}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function configError(field) {
  return new EmbedderError(`Embedder option ${field} is invalid.`, "invalid_embedder_config", {
    field,
  });
}

function integerOption(options, field, min, max) {
  const value = options[field] === undefined ? OPENAI_EMBEDDER_DEFAULTS[field] : options[field];
  if (!Number.isSafeInteger(value) || value < min || value > max) throw configError(field);
  return value;
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

// Accepts "https://api.openai.com", "https://api.openai.com/v1", or a gateway
// prefix such as "https://gw.example.com/openai"; rejects credentials, queries
// and fragments so the normalised URL is safe to print.
function parseBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw configError("baseUrl");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw configError("baseUrl");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw configError("baseUrl");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  const prefix = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`;
  return { host: url.host, hostname: url.hostname, endpoint: `${url.origin}${prefix}/embeddings` };
}

function parseRetryAfter(header, nowMs) {
  if (typeof header !== "string" || !header.trim()) return null;
  const value = header.trim();
  let waitMs;
  if (/^\d+(\.\d+)?$/.test(value)) {
    waitMs = Number(value) * 1000;
  } else {
    const date = Date.parse(value);
    if (!Number.isFinite(date)) return null;
    waitMs = date - nowMs;
  }
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, Math.round(waitMs)));
}

function backoffDelay(attempt, random) {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.floor(base / 2 + random() * (base / 2));
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / OPENAI_EMBEDDING_LIMITS.charsPerToken));
}

// Contiguous batches in input order, closed by the input count or the token
// budget, whichever comes first. A single input always fits because it was
// truncated to at most maxInputChars before this point.
function planBatches(inputs, batchSize, maxRequestTokens) {
  const batches = [];
  let current = null;
  inputs.forEach((text, index) => {
    const tokens = estimateTokens(text);
    if (
      !current ||
      current.texts.length >= batchSize ||
      current.tokens + tokens > maxRequestTokens
    ) {
      current = { offset: index, texts: [], tokens: 0 };
      batches.push(current);
    }
    current.texts.push(text);
    current.tokens += tokens;
  });
  return batches;
}

function scrubSecret(text, secret) {
  let out = String(text);
  if (secret) out = out.split(secret).join("[redacted]");
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

// A server may echo the request in its error body. Only a message that shares
// no input text with the batch is kept, and only under details, never in the
// error message itself.
function echoesInput(message, inputs) {
  return inputs.some((input) => {
    const probe = input.trim();
    if (probe.length < 8) return false;
    return message.includes(probe) || message.includes(probe.slice(0, 32));
  });
}

function serverErrorDetails(bodyText, inputs, secret) {
  const details = {};
  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }
  const source = parsed && typeof parsed === "object" ? parsed.error || parsed : null;
  let message = null;
  if (source && typeof source === "object") {
    for (const field of ["type", "code", "param"]) {
      const value = source[field];
      if (typeof value === "string" && IDENTIFIER.test(value)) details[field] = value;
    }
    if (typeof source.message === "string") message = source.message;
  } else if (parsed === null && typeof bodyText === "string") {
    message = bodyText;
  }
  if (message !== null) {
    const excerpt = scrubSecret(message, secret).slice(0, MAX_SERVER_MESSAGE_CHARS);
    if (excerpt.trim() && !echoesInput(excerpt, inputs)) details.message = excerpt;
  }
  return details;
}

function abortError(reason) {
  if (reason instanceof EmbedderError) return reason;
  return new EmbedderError("Embeddings request was aborted.", "embedder_aborted");
}

async function readBody(response, controller) {
  if (!response.body || typeof response.body.getReader !== "function") {
    return String(await response.text());
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      controller.abort();
      throw new EmbedderError(
        "Embeddings response exceeded the size limit.",
        "embedder_bad_response",
      );
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseVectors(payload, expectedCount) {
  const data = payload && typeof payload === "object" ? payload.data : null;
  if (!Array.isArray(data) || data.length !== expectedCount) return null;
  const vectors = new Array(expectedCount);
  let dimension = null;
  for (const entry of data) {
    const index = entry?.index;
    const embedding = entry?.embedding;
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= expectedCount ||
      vectors[index] !== undefined ||
      !Array.isArray(embedding) ||
      embedding.length === 0
    ) {
      return null;
    }
    if (dimension === null) dimension = embedding.length;
    if (embedding.length !== dimension) return null;
    const vector = new Float32Array(dimension);
    for (let position = 0; position < dimension; position += 1) {
      const value = embedding[position];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      vector[position] = value;
    }
    vectors[index] = vector;
  }
  return { vectors, dimension };
}

function usageOf(payload) {
  const usage = payload && typeof payload === "object" ? payload.usage : null;
  const count = (field) =>
    usage && Number.isSafeInteger(usage[field]) && usage[field] >= 0 ? usage[field] : 0;
  return { promptTokens: count("prompt_tokens"), totalTokens: count("total_tokens") };
}

function createOpenAiEmbedder(options) {
  const config = options && typeof options === "object" ? options : {};
  const { host, hostname, endpoint } = parseBaseUrl(config.baseUrl);
  const model = config.model;
  if (
    typeof model !== "string" ||
    !model.trim() ||
    model.length > 256 ||
    /[\s\p{Cc}]/u.test(model)
  ) {
    throw configError("model");
  }
  const dimensions =
    config.dimensions === undefined ? null : integerOption(config, "dimensions", 1, 65536);
  const batchSize = integerOption(config, "batchSize", 1, OPENAI_EMBEDDING_LIMITS.maxBatch);
  const timeoutMs = integerOption(config, "timeoutMs", 1, 3600000);
  const maxRetries = integerOption(config, "maxRetries", 0, 20);
  const concurrency = integerOption(config, "concurrency", 1, 64);
  const maxInputChars = integerOption(
    config,
    "maxInputChars",
    1,
    OPENAI_EMBEDDING_LIMITS.maxInputTokens * OPENAI_EMBEDDING_LIMITS.charsPerToken,
  );
  const maxRequestTokens = integerOption(
    config,
    "maxRequestTokens",
    1,
    OPENAI_EMBEDDING_LIMITS.maxRequestTokens,
  );
  const languages = config.languages === undefined ? [] : config.languages;
  if (!Array.isArray(languages) || languages.some((code) => typeof code !== "string")) {
    throw configError("languages");
  }
  const fetchImpl = config.fetch === undefined ? globalThis.fetch : config.fetch;
  if (typeof fetchImpl !== "function") throw configError("fetch");
  const env = config.env === undefined ? process.env : config.env;
  const sleep =
    config.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()));
  const random = config.random || Math.random;
  const now = config.now || Date.now;

  let apiKey = null;
  if (config.apiKeyEnv !== undefined && config.apiKeyEnv !== null) {
    if (typeof config.apiKeyEnv !== "string" || !ENV_NAME.test(config.apiKeyEnv)) {
      throw configError("apiKeyEnv");
    }
    const value = env[config.apiKeyEnv];
    if (typeof value !== "string" || !value.trim()) {
      throw new EmbedderError(
        `Embedder API key environment variable ${config.apiKeyEnv} is not set.`,
        "embedder_key_missing",
        { variable: config.apiKeyEnv },
      );
    }
    apiKey = value.trim();
  }

  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": `okf-mcp/${PACKAGE_VERSION}`,
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
  const state = { dimension: dimensions };
  const counters = {
    requests: 0,
    retries: 0,
    promptTokens: 0,
    totalTokens: 0,
    inputs: 0,
    truncated: 0,
  };

  function recordDimension(dimension) {
    if (state.dimension === null) {
      state.dimension = dimension;
      return;
    }
    if (dimension !== state.dimension) {
      throw new EmbedderError(
        `Embeddings response dimension ${dimension} does not match the expected ${state.dimension}.`,
        "embedder_dimension_mismatch",
        { expected: state.dimension, received: dimension },
      );
    }
  }

  // One HTTP attempt. Returns { ok: true, vectors } or { ok: false, error,
  // retryable, retryAfterMs }; throws only for conditions no retry can fix.
  async function attempt(batch, signal) {
    // An abort listener never fires for a signal that is already aborted.
    if (signal.aborted) throw abortError(signal.reason);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    const forward = () => controller.abort();
    signal.addEventListener("abort", forward, { once: true });
    counters.requests += 1;
    try {
      let response;
      let bodyText;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            input: batch.texts,
            encoding_format: "float",
            ...(dimensions ? { dimensions } : {}),
          }),
          signal: controller.signal,
        });
        bodyText = await readBody(response, controller);
      } catch (error) {
        if (error instanceof EmbedderError) throw error;
        if (signal.aborted) throw abortError(signal.reason);
        if (timedOut) {
          return {
            ok: false,
            retryable: true,
            retryAfterMs: null,
            error: new EmbedderError(
              `Embeddings request timed out after ${timeoutMs} ms.`,
              "embedder_timeout",
              { timeoutMs },
            ),
          };
        }
        const cause = error && (error.code || error.name);
        return {
          ok: false,
          retryable: true,
          retryAfterMs: null,
          error: new EmbedderError(
            "Embeddings request failed before a response arrived.",
            "embedder_network_error",
            typeof cause === "string" && IDENTIFIER.test(cause) ? { cause } : undefined,
          ),
        };
      }
      if (!response.ok) {
        const server = serverErrorDetails(bodyText, batch.texts, apiKey);
        const error = new EmbedderError(
          `Embeddings request failed with HTTP ${response.status}${server.code ? ` (${server.code})` : ""}.`,
          "embedder_http_error",
          { status: response.status, server },
        );
        error.status = response.status;
        const retryable = RETRYABLE_STATUSES.has(response.status);
        return {
          ok: false,
          retryable,
          retryAfterMs: retryable
            ? parseRetryAfter(response.headers.get("retry-after"), now())
            : null,
          error,
        };
      }
      let payload;
      try {
        payload = JSON.parse(bodyText);
      } catch {
        throw new EmbedderError("Embeddings response was not JSON.", "embedder_bad_response");
      }
      const parsed = parseVectors(payload, batch.texts.length);
      if (!parsed) {
        throw new EmbedderError(
          "Embeddings response did not contain one vector per input.",
          "embedder_bad_response",
        );
      }
      recordDimension(parsed.dimension);
      const usage = usageOf(payload);
      counters.promptTokens += usage.promptTokens;
      counters.totalTokens += usage.totalTokens;
      counters.inputs += batch.texts.length;
      return { ok: true, vectors: parsed.vectors };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    }
  }

  async function wait(ms, signal) {
    if (signal.aborted) throw abortError(signal.reason);
    await new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError(signal.reason));
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(sleep(ms)).then(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, reject);
    });
  }

  async function requestBatch(batch, signal) {
    for (let retry = 0; ; retry += 1) {
      const outcome = await attempt(batch, signal);
      if (outcome.ok) return outcome.vectors;
      if (!outcome.retryable || retry >= maxRetries) {
        outcome.error.details = { ...(outcome.error.details || {}), attempts: retry + 1 };
        throw outcome.error;
      }
      counters.retries += 1;
      const delay =
        outcome.retryAfterMs === null ? backoffDelay(retry, random) : outcome.retryAfterMs;
      await wait(delay, signal);
    }
  }

  async function embed(texts, embedOptions) {
    if (!Array.isArray(texts)) {
      throw new EmbedderError("Embedder input must be an array of strings.", "invalid_input");
    }
    const inputs = texts.map((text, index) => {
      if (typeof text !== "string") {
        throw new EmbedderError("Embedder inputs must be strings.", "invalid_input", { index });
      }
      if (text.length > maxInputChars) {
        counters.truncated += 1;
        return text.slice(0, maxInputChars);
      }
      return text.length === 0 ? " " : text;
    });
    if (inputs.length === 0) return [];
    const external = embedOptions?.signal;
    const run = new AbortController();
    const signal = external ? AbortSignal.any([external, run.signal]) : run.signal;
    const batches = planBatches(inputs, batchSize, maxRequestTokens);
    const out = new Array(inputs.length);
    let next = 0;
    let failure = null;
    const worker = async () => {
      while (next < batches.length && !failure) {
        const batch = batches[next];
        next += 1;
        try {
          const vectors = await requestBatch(batch, signal);
          vectors.forEach((vector, position) => {
            out[batch.offset + position] = vector;
          });
        } catch (error) {
          failure = failure || error;
          run.abort();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
    if (failure) throw failure;
    return out;
  }

  const embedder = {
    kind: "openai",
    get id() {
      return `openai:${host}:${model}:${state.dimension === null ? "?" : state.dimension}`;
    },
    get dimension() {
      return state.dimension;
    },
    languages: languages.slice(),
    remote: !isLoopbackHost(hostname),
    maxBatch: batchSize,
    maxInputChars,
    concurrency,
    model,
    endpoint,
    embed,
    async probe() {
      if (state.dimension === null) await embed([PROBE_TEXT]);
      return { id: embedder.id, dimension: state.dimension };
    },
    usage() {
      return { ...counters };
    },
  };
  return embedder;
}

module.exports = {
  OPENAI_EMBEDDER_DEFAULTS,
  OPENAI_EMBEDDING_LIMITS,
  createOpenAiEmbedder,
  isLoopbackHost,
  parseRetryAfter,
  planBatches,
};
