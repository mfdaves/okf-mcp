"use strict";

// Zero-dependency client for the OpenAI embeddings API and compatible servers
// (docs/plan-1.0.md R-8a): POST {baseUrl}/v1/embeddings over the global fetch
// of Node 22+. Every setting arrives through the options object from trusted
// project configuration; nothing here reads tool arguments. The API key is read
// once from the named environment variable and lives only in this closure.
// No server-controlled string is ever retained: an HTTP error carries a fixed
// message with the status, and its details hold the status plus a server code
// mapped onto a fixed enumeration (B-6, S-2). Filtering cannot promise
// secrecy; not retaining can.

const { EmbedderError } = require("./interface");
const { version: PACKAGE_VERSION } = require("../../package.json");

// Published limits of the OpenAI embeddings endpoint; compatible servers are
// usually looser, never stricter in a way the configuration cannot express.
// charsPerToken (4) is the reporting estimate; request budgets and the
// default truncation use conservativeCharsPerToken (3), because
// identifier-dense text (generated contracts, column lists) runs at about
// 2.6 characters per token and overflowed the 8,192-token input limit at
// 32,000 characters.
const OPENAI_EMBEDDING_LIMITS = Object.freeze({
  maxBatch: 2048,
  maxRequestTokens: 300000,
  maxInputTokens: 8192,
  charsPerToken: 4,
  conservativeCharsPerToken: 3,
});

const OPENAI_EMBEDDER_DEFAULTS = Object.freeze({
  batchSize: 512,
  timeoutMs: 60000,
  maxRetries: 5,
  concurrency: 2,
  maxInputChars: 24000,
  maxRequestTokens: OPENAI_EMBEDDING_LIMITS.maxRequestTokens,
});

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 30000;
const RETRY_AFTER_CAP_MS = 60000;
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const PROBE_TEXT = "okf-mcp";
// An input the provider rejects (invalid_request) is retried once at half its
// length, never below this many characters.
const REJECTED_INPUT_FLOOR_CHARS = 2000;
// Extra requests one rejected request may spend isolating its bad inputs by
// bisection: 16 per halving level, enough for several rejected inputs in a
// full batch. A request whose every input is rejected (a configuration
// problem, not a document) exhausts it and fails as before.
function isolationBudget(inputs) {
  return 16 * Math.ceil(Math.log2(inputs + 1)) + 8;
}
// The only server-derived value an error may carry: one of these constants,
// chosen from the HTTP status and the OpenAI-style error code or type.
const OPENAI_SERVER_CODES = Object.freeze([
  "invalid_api_key",
  "insufficient_quota",
  "rate_limited",
  "model_not_found",
  "invalid_request",
  "server_error",
  "unknown",
]);
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

// Conservative estimate for request budgets: ceil(chars / 3).
function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / OPENAI_EMBEDDING_LIMITS.conservativeCharsPerToken));
}

// The provider refused the request's content (an HTTP 4xx that is not about
// the key, quota, model or rate): with several inputs, one of them may be the
// cause. Decided from our own enumerated code, never from server text.
function isInputRejection(error) {
  return (
    error instanceof EmbedderError &&
    error.code === "embedder_http_error" &&
    error.details?.serverCode === "invalid_request"
  );
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

// Maps an error response onto SERVER_CODES. The body's code and type are
// compared with constants and then forgotten; the result is one of our own
// strings, so nothing a server sent can reach an error, a log or a receipt.
function classifyServerError(status, bodyText) {
  let code = null;
  let type = null;
  try {
    const parsed = JSON.parse(bodyText);
    const source = parsed?.error && typeof parsed.error === "object" ? parsed.error : parsed;
    if (source && typeof source === "object") {
      code = typeof source.code === "string" ? source.code : null;
      type = typeof source.type === "string" ? source.type : null;
    }
  } catch {
    // A body that is not JSON contributes nothing.
  }
  // Status first: a 5xx is a server failure whatever the body claims, 401,
  // 404 and 429 speak for themselves (a 429 or a 402/403 that names quota
  // exhaustion is that instead). Other 4xx go by code, then by type; code
  // beats type when both are present.
  const quota = code === "insufficient_quota" || type === "insufficient_quota";
  if (status >= 500 && status < 600) return "server_error";
  if (status === 401) return "invalid_api_key";
  if (status === 404) return "model_not_found";
  if (status === 429) return quota ? "insufficient_quota" : "rate_limited";
  if ((status === 402 || status === 403) && quota) return "insufficient_quota";
  if (status >= 400 && status < 500) {
    const byCode = {
      invalid_api_key: "invalid_api_key",
      model_not_found: "model_not_found",
      insufficient_quota: "insufficient_quota",
    }[code];
    if (byCode) return byCode;
    const byType = {
      authentication_error: "invalid_api_key",
      not_found_error: "model_not_found",
      rate_limit_error: "rate_limited",
      insufficient_quota: "insufficient_quota",
    }[type];
    return byType || "invalid_request";
  }
  return "unknown";
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

function invalidVector(reason) {
  return new EmbedderError(
    "Embeddings response contained an invalid vector.",
    "embedder_invalid_vector",
    { reason },
  );
}

// Structural problems (no list, wrong count, bad indices) return null and
// become embedder_bad_response. A vector that is empty, ragged, or holds a
// value that is not a finite number once stored as float32 (1e40 becomes
// Infinity and would poison every cosine score) throws
// embedder_invalid_vector; neither is retried.
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
      vectors[index] !== undefined
    ) {
      return null;
    }
    if (!Array.isArray(embedding) || embedding.length === 0) throw invalidVector("empty");
    if (dimension === null) dimension = embedding.length;
    if (embedding.length !== dimension) throw invalidVector("ragged");
    const vector = new Float32Array(dimension);
    for (let position = 0; position < dimension; position += 1) {
      const value = embedding[position];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw invalidVector("not_a_number");
      }
      vector[position] = value;
      if (!Number.isFinite(vector[position])) throw invalidVector("not_finite_as_float32");
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
  const { hostname, endpoint } = parseBaseUrl(config.baseUrl);
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
  // The ceiling stays at the 0.11.0-rc.1 value (8,192 x 4) so existing
  // configurations keep loading; an input the provider still rejects is
  // halved and retried (embedBatch below).
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
  if (
    Math.ceil(maxInputChars / OPENAI_EMBEDDING_LIMITS.conservativeCharsPerToken) > maxRequestTokens
  ) {
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
    halved: 0,
    rejected: 0,
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
        const error = new EmbedderError(
          `Embeddings request failed with HTTP ${response.status}.`,
          "embedder_http_error",
          { status: response.status, serverCode: classifyServerError(response.status, bodyText) },
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

  // One planned batch, isolating rejected inputs: a multi-input request the
  // provider refuses as invalid_request is split in halves (bisection) until
  // the refused inputs stand alone; a lone refused input is retried once at
  // half its length (floor REJECTED_INPUT_FLOOR_CHARS). An input refused even
  // then yields null and its error is kept in `rejections`. Any other error,
  // or an exhausted isolation budget, throws the error at hand.
  async function embedBatch(batch, signal, budget, rejections) {
    let failure;
    try {
      return await requestBatch(batch, signal);
    } catch (error) {
      if (!isInputRejection(error)) throw error;
      failure = error;
    }
    const count = batch.texts.length;
    if (count > 1) {
      if (budget.remaining < 2) throw failure;
      budget.remaining -= 2;
      const middle = Math.ceil(count / 2);
      const halves = [
        { offset: batch.offset, texts: batch.texts.slice(0, middle) },
        { offset: batch.offset + middle, texts: batch.texts.slice(middle) },
      ];
      const out = [];
      for (const half of halves) {
        out.push(...(await embedBatch(half, signal, budget, rejections)));
      }
      return out;
    }
    const text = batch.texts[0];
    const shorter = Math.max(REJECTED_INPUT_FLOOR_CHARS, Math.floor(text.length / 2));
    if (shorter < text.length) {
      if (budget.remaining < 1) throw failure;
      budget.remaining -= 1;
      try {
        const vectors = await requestBatch(
          { offset: batch.offset, texts: [text.slice(0, shorter)] },
          signal,
        );
        counters.halved += 1;
        return vectors;
      } catch (error) {
        if (!isInputRejection(error)) throw error;
        failure = error;
      }
    }
    counters.rejected += 1;
    rejections.push({ index: batch.offset, error: failure });
    return [null];
  }

  // options.skipRejected: true returns null in place of the vector of an
  // input the provider rejects even after the halving retry (the host records
  // it as skipped); without it, such an input fails the call as before. A
  // call whose every input (more than one) is rejected always fails: that is
  // a configuration problem, not a document.
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
    // A host that runs several calls at once passes concurrency: 1 so the
    // requests in flight equal its own bound; the configured value stays the
    // ceiling either way.
    const requested = embedOptions?.concurrency;
    const parallel =
      Number.isSafeInteger(requested) && requested > 0
        ? Math.min(concurrency, requested)
        : concurrency;
    const batches = planBatches(inputs, batchSize, maxRequestTokens);
    const out = new Array(inputs.length);
    const rejections = [];
    let next = 0;
    let failure = null;
    const worker = async () => {
      while (next < batches.length && !failure) {
        const batch = batches[next];
        next += 1;
        try {
          const budget = { remaining: isolationBudget(batch.texts.length) };
          const vectors = await embedBatch(batch, signal, budget, rejections);
          vectors.forEach((vector, position) => {
            out[batch.offset + position] = vector;
          });
        } catch (error) {
          failure = failure || error;
          run.abort();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, batches.length) }, worker));
    if (failure) throw failure;
    if (rejections.length) {
      const everyInput = inputs.length > 1 && rejections.length === inputs.length;
      if (embedOptions?.skipRejected !== true || everyInput) {
        rejections.sort((left, right) => left.index - right.index);
        throw rejections[0].error;
      }
    }
    return out;
  }

  // The id keys the cache: the normalised endpoint (gateways differ by path),
  // the model, the dimension and the truncation length all change what a
  // stored vector means, so each is part of it.
  const embedder = {
    kind: "openai",
    get id() {
      const dimension = state.dimension === null ? "?" : state.dimension;
      return `openai:${endpoint}:${model}:${dimension}:${maxInputChars}`;
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
  OPENAI_SERVER_CODES,
  REJECTED_INPUT_FLOOR_CHARS,
  classifyServerError,
  createOpenAiEmbedder,
  isLoopbackHost,
  parseRetryAfter,
  planBatches,
};
