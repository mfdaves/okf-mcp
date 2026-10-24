"use strict";

// Zero-dependency client for the OpenAI embeddings API and compatible servers
// (docs/plan-1.0.md R-8a): POST {baseUrl}/v1/embeddings over the global fetch
// of Node 22+. Every setting arrives through the options object from trusted
// project configuration; nothing here reads tool arguments. The API key is read
// once from the named environment variable and lives only in this closure.
// Errors carry a code and an HTTP status; error.message never contains a
// server-supplied string other than a checked lowercase code, and nothing
// retained can carry input text or the key (B-6, S-2).

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
const MAX_SERVER_FIELD_CHARS = 64;
const PROBE_TEXT = "okf-mcp";
// The only shape of server-supplied code allowed into error.message.
const SERVER_CODE = /^[a-z][a-z_]{0,39}$/;
// Node and undici error codes and names, which are not server-supplied.
const NODE_ERROR_CODE = /^[A-Za-z_]{1,48}$/;
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
// budget, whichever comes first. An input that alone exceeds the budget gets
// a batch of its own; the client's configuration rules that case out, other
// callers of this helper may not.
function planBatches(inputs, batchSize, maxRequestTokens) {
  const batches = [];
  let current = null;
  inputs.forEach((text, index) => {
    const tokens = estimateTokens(text);
    const oversized = tokens > maxRequestTokens;
    if (
      !current ||
      oversized ||
      current.texts.length >= batchSize ||
      current.tokens + tokens > maxRequestTokens
    ) {
      current = { offset: index, texts: [], tokens: 0 };
      batches.push(current);
    }
    current.texts.push(text);
    current.tokens += tokens;
    if (oversized) current = null;
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

// Every string in an error body is untrusted: a server may echo the request,
// the key, or anything else. A string is retained, under details only, when
// it contains neither the key (in any case), nor a bearer token, nor any
// non-blank input of the batch at any length; it is then scrubbed and cut.
function retainServerString(value, maxChars, inputs, secret) {
  if (typeof value !== "string" || !value.trim()) return null;
  const lower = value.toLowerCase();
  if (secret && lower.includes(secret.toLowerCase())) return null;
  if (/bearer\s+\S+/i.test(value)) return null;
  if (inputs.some((input) => input.trim().length > 0 && value.includes(input.trim()))) {
    return null;
  }
  return scrubSecret(value, secret).slice(0, maxChars);
}

// Returns { server, diagnostic }: `server` holds the retained fields for
// details; `diagnostic` is the server code, only when it is a bare lowercase
// identifier that passed the same checks, and is the one server-derived
// token error.message may carry.
function serverErrorDetails(bodyText, inputs, secret) {
  const server = {};
  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }
  const source = parsed && typeof parsed === "object" ? parsed.error || parsed : null;
  if (source && typeof source === "object") {
    for (const field of ["type", "code", "param"]) {
      const kept = retainServerString(source[field], MAX_SERVER_FIELD_CHARS, inputs, secret);
      if (kept !== null) server[field] = kept;
    }
    const message = retainServerString(source.message, MAX_SERVER_MESSAGE_CHARS, inputs, secret);
    if (message !== null) server.message = message;
  } else if (parsed === null) {
    const message = retainServerString(bodyText, MAX_SERVER_MESSAGE_CHARS, inputs, secret);
    if (message !== null) server.message = message;
  }
  const diagnostic =
    typeof server.code === "string" && server.code === source.code && SERVER_CODE.test(server.code)
      ? server.code
      : null;
  return { server, diagnostic };
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
  if (Math.ceil(maxInputChars / OPENAI_EMBEDDING_LIMITS.charsPerToken) > maxRequestTokens) {
    throw new EmbedderError(
      "Embedder option maxRequestTokens must admit one input of maxInputChars characters.",
      "invalid_embedder_config",
      { field: "maxRequestTokens" },
    );
  }
  const languages = config.languages === undefined ? [] : config.languages;
  if (!Array.isArray(languages) || languages.some((code) => typeof code !== "string")) {
    throw configError("languages");
  }
  const fetchImpl = config.fetch === undefined ? globalThis.fetch : config.fetch;
  if (typeof fetchImpl !== "function") throw configError("fetch");
  const env = config.env === undefined ? process.env : config.env;
  const sleep = typeof config.sleep === "function" ? config.sleep : null;
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
          // A redirect would carry the whole batch to another destination
          // and could turn a local endpoint remote; it is a configuration
          // error, never followed.
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel?.();
          throw new EmbedderError(
            `Embeddings endpoint answered with a redirect (HTTP ${response.status}); configure the final base URL.`,
            "embedder_redirect",
            { status: response.status },
          );
        }
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
        const cause = error?.cause?.code || error?.code || error?.name;
        return {
          ok: false,
          retryable: true,
          retryAfterMs: null,
          error: new EmbedderError(
            "Embeddings request failed before a response arrived.",
            "embedder_network_error",
            typeof cause === "string" && NODE_ERROR_CODE.test(cause) ? { cause } : undefined,
          ),
        };
      }
      if (!response.ok) {
        const { server, diagnostic } = serverErrorDetails(bodyText, batch.texts, apiKey);
        const error = new EmbedderError(
          `Embeddings request failed with HTTP ${response.status}${diagnostic ? ` (${diagnostic})` : ""}.`,
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

  // The retry wait keeps the process alive on purpose: a CLI run must not
  // exit mid-retry. The timer is cleared the moment the run is aborted.
  async function wait(ms, signal) {
    if (signal.aborted) throw abortError(signal.reason);
    await new Promise((resolve, reject) => {
      let timer = null;
      const onAbort = () => {
        if (timer !== null) clearTimeout(timer);
        reject(abortError(signal.reason));
      };
      const settle = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (sleep) {
        Promise.resolve(sleep(ms)).then(settle, (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        });
      } else {
        timer = setTimeout(settle, ms);
      }
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
