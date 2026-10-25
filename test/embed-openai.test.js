"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const { EmbedderError, validateEmbedder } = require("../src/embed/interface");
const {
  OPENAI_EMBEDDER_DEFAULTS,
  OPENAI_EMBEDDING_LIMITS,
  classifyServerError,
  createOpenAiEmbedder,
  parseRetryAfter,
  planBatches,
} = require("../src/embed/openai");
const {
  estimateTokens,
  startFakeEmbeddingsServer,
  vectorFor,
} = require("./fake-embeddings-server");

const KEY = "sk-test-0123456789abcdefghijklmnop";
const ENV = { OKF_TEST_EMBED_KEY: KEY };

async function serverFor(t, options) {
  const server = await startFakeEmbeddingsServer({ apiKey: KEY, dimension: 8, ...(options || {}) });
  t.after(() => server.close());
  return server;
}

function embedderFor(server, overrides) {
  const sleeps = [];
  const embedder = createOpenAiEmbedder({
    baseUrl: server.baseUrl,
    model: "fake-embed",
    apiKeyEnv: "OKF_TEST_EMBED_KEY",
    env: ENV,
    dimensions: 8,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
    ...(overrides || {}),
  });
  return { embedder, sleeps };
}

function idFor(server, model, dimension, maxInputChars) {
  return `openai:${server.baseUrl}/v1/embeddings:${model}:${dimension}:${maxInputChars || 24000}`;
}

function assertClose(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) < 1e-6, `component ${index}`);
  }
}

// B-6 and S-2: no error, however it is serialised, carries input text or the key.
function assertMasked(error, inputs) {
  assert.ok(error instanceof EmbedderError, `expected EmbedderError, got ${error}`);
  const serialized = JSON.stringify({
    message: error.message,
    details: error.details,
    stack: error.stack,
  });
  assert.equal(serialized.includes(KEY), false, "key leaked into the error");
  for (const input of inputs) {
    assert.equal(serialized.includes(input), false, "input text leaked into the error");
  }
}

test("embeds in input order across batches and workers, and reports usage", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server, { batchSize: 3, concurrency: 3 });
  validateEmbedder(embedder);
  assert.equal(embedder.id, idFor(server, "fake-embed", 8));
  assert.equal(embedder.remote, false);
  assert.equal(embedder.dimension, 8);
  assert.equal(embedder.maxBatch, 3);
  assert.equal(embedder.maxInputChars, 24000);

  const texts = Array.from({ length: 8 }, (_, index) => `alpine boot guide number ${index}`);
  const vectors = await embedder.embed(texts);
  assert.equal(vectors.length, 8);
  vectors.forEach((vector, index) => {
    assert.ok(vector instanceof Float32Array);
    assertClose(vector, vectorFor(texts[index], 8));
  });
  assert.equal(server.requests.length, 3);
  const sizes = server.requests.map((request) => request.body.input.length).sort();
  assert.deepEqual(sizes, [2, 3, 3]);
  for (const request of server.requests) {
    assert.equal(request.url, "/v1/embeddings");
    assert.equal(request.headers.authorization, `Bearer ${KEY}`);
    assert.equal(request.body.model, "fake-embed");
    assert.equal(request.body.encoding_format, "float");
    assert.equal(request.body.dimensions, 8);
  }
  const promptTokens = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
  assert.deepEqual(embedder.usage(), {
    requests: 3,
    retries: 0,
    promptTokens,
    totalTokens: promptTokens,
    inputs: 8,
    truncated: 0,
    halved: 0,
    rejected: 0,
  });
  assert.deepEqual(await embedder.embed([]), []);
  assert.equal(server.requests.length, 3);
});

test("batches close at the input limit and at the token budget", async (t) => {
  const short = "x";
  const many = planBatches(new Array(5000).fill(short), OPENAI_EMBEDDING_LIMITS.maxBatch, 300000);
  assert.deepEqual(
    many.map((batch) => batch.texts.length),
    [2048, 2048, 904],
  );
  assert.deepEqual(
    many.map((batch) => batch.offset),
    [0, 2048, 4096],
  );
  // Budgets use the conservative ceil(chars / 3): 3,000 characters are 1,000 tokens.
  const heavy = "y".repeat(3000);
  const byTokens = planBatches([heavy, heavy, heavy, heavy, short], 2048, 2500);
  assert.deepEqual(
    byTokens.map((batch) => batch.texts.length),
    [2, 3],
  );
  assert.deepEqual(
    byTokens.map((batch) => batch.tokens),
    [2000, 2001],
  );

  const server = await serverFor(t);
  const { embedder } = embedderFor(server, { maxRequestTokens: 10000 });
  const long = "z".repeat(32000);
  const vectors = await embedder.embed([long, long, long, "tail"]);
  assert.equal(vectors.length, 4);
  assert.deepEqual(
    server.requests.map((request) => request.body.input.length),
    [1, 1, 2],
  );
  assert.throws(
    () => embedderFor(server, { batchSize: OPENAI_EMBEDDING_LIMITS.maxBatch + 1 }),
    (error) => error.code === "invalid_embedder_config" && error.details.field === "batchSize",
  );
});

test("truncates inputs at maxInputChars and counts the truncations", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server);
  await embedder.embed(["a".repeat(40000), "short"]);
  assert.deepEqual(
    server.requests[0].body.input.map((text) => text.length),
    [24000, 5],
  );
  assert.equal(embedder.usage().truncated, 1);
  const { embedder: narrow } = embedderFor(server, { maxInputChars: 100 });
  await narrow.embed(["b".repeat(1000)]);
  assert.equal(server.requests[1].body.input[0].length, 100);
  assert.equal(narrow.id, idFor(server, "fake-embed", 8, 100));
  assert.throws(
    () => embedderFor(server, { maxInputChars: 32769 }),
    (error) => error.details.field === "maxInputChars",
  );
});

test("reconciles output order by the response index field", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server);
  server.script({ reverse: true });
  const texts = ["first", "second", "third"];
  const vectors = await embedder.embed(texts);
  for (const [index, text] of texts.entries()) assertClose(vectors[index], vectorFor(text, 8));
});

test("rejects malformed responses without retrying", async (t) => {
  const server = await serverFor(t);
  const { embedder, sleeps } = embedderFor(server, { maxRetries: 3 });
  server.script({ malformed: true });
  await assert.rejects(embedder.embed(["unit-alpha-7f3e"]), (error) => {
    assertMasked(error, ["unit-alpha-7f3e"]);
    return error.code === "embedder_bad_response";
  });
  server.script({ dropLast: true });
  await assert.rejects(embedder.embed(["unit-alpha-7f3e", "unit-beta-9c1d"]), (error) => {
    assertMasked(error, ["unit-alpha-7f3e", "unit-beta-9c1d"]);
    return error.code === "embedder_bad_response";
  });
  server.script({ dimension: 4 });
  await assert.rejects(embedder.embed(["unit-alpha-7f3e"]), (error) => {
    assertMasked(error, ["unit-alpha-7f3e"]);
    return (
      error.code === "embedder_dimension_mismatch" &&
      error.details.expected === 8 &&
      error.details.received === 4
    );
  });
  assert.equal(server.requests.length, 3);
  assert.deepEqual(sleeps, []);
});

test("rejects vectors that are not finite as float32 without retrying", async (t) => {
  const server = await serverFor(t);
  const { embedder, sleeps } = embedderFor(server, { maxRetries: 3 });
  const texts = ["unit-alpha-7f3e", "unit-beta-9c1d"];
  for (const component of [1e40, -1e40, null, "0.5"]) {
    server.script({ component });
    await assert.rejects(embedder.embed(texts), (error) => {
      assertMasked(error, texts);
      return error.code === "embedder_invalid_vector";
    });
  }
  server.script({ emptyVector: true });
  await assert.rejects(
    embedder.embed(texts),
    (error) => error.code === "embedder_invalid_vector" && error.details.reason === "empty",
  );
  assert.equal(server.requests.length, 5);
  assert.deepEqual(sleeps, [], "an invalid vector is not retried");
  // A value inside the float32 range survives.
  server.script({ component: 3.4e38 });
  const [vector] = await embedder.embed(["unit-alpha-7f3e"]);
  assert.equal(Number.isFinite(vector[0]), true);
});

test("retries 429 and 5xx honouring Retry-After in seconds and as an HTTP date", async (t) => {
  const server = await serverFor(t);
  const nowMs = Date.UTC(2026, 9, 24, 12, 0, 0);
  const { embedder, sleeps } = embedderFor(server, { maxRetries: 5, now: () => nowMs });
  server.script(
    { status: 429, retryAfter: "2" },
    { status: 503, retryAfter: new Date(nowMs + 5000).toUTCString() },
    { status: 500 },
    { status: 502 },
    { status: 504 },
  );
  const [vector] = await embedder.embed(["patient"]);
  assertClose(vector, vectorFor("patient", 8));
  // 2 s from the header, 5 s from the date, then equal-jitter backoff on
  // attempts 2, 3 and 4 with random() = 0.5: 1500, 3000, 6000.
  assert.deepEqual(sleeps, [2000, 5000, 1500, 3000, 6000]);
  assert.equal(server.requests.length, 6);
  assert.equal(embedder.usage().retries, 5);
  assert.equal(embedder.usage().requests, 6);
});

test("stops after maxRetries, never retries 4xx, and keeps the status in the error", async (t) => {
  const server = await serverFor(t);
  const { embedder, sleeps } = embedderFor(server, { maxRetries: 1 });
  server.script({ status: 500 }, { status: 500 });
  await assert.rejects(embedder.embed(["unlucky"]), (error) => {
    assertMasked(error, ["unlucky"]);
    assert.equal(error.code, "embedder_http_error");
    assert.equal(error.status, 500);
    assert.deepEqual(error.details, { status: 500, serverCode: "server_error", attempts: 2 });
    return true;
  });
  assert.deepEqual(sleeps, [375]);
  server.script({ status: 400, code: "invalid_request" });
  await assert.rejects(embedder.embed(["bad"]), (error) => {
    assertMasked(error, ["bad"]);
    assert.equal(error.message, "Embeddings request failed with HTTP 400.");
    assert.deepEqual(error.details, { status: 400, serverCode: "invalid_request", attempts: 1 });
    return true;
  });
  assert.equal(server.requests.length, 3);
});

test("times out with an AbortController and retries within the budget", async (t) => {
  const server = await serverFor(t);
  const { embedder, sleeps } = embedderFor(server, { timeoutMs: 50, maxRetries: 1 });
  server.script({ delayMs: 400 }, { delayMs: 400 });
  await assert.rejects(embedder.embed(["slow"]), (error) => {
    assertMasked(error, ["slow"]);
    return (
      error.code === "embedder_timeout" &&
      error.details.timeoutMs === 50 &&
      error.details.attempts === 2
    );
  });
  assert.equal(embedder.usage().requests, 2);
  assert.equal(embedder.usage().retries, 1);
  assert.equal(sleeps.length, 1);
  const external = new AbortController();
  external.abort();
  await assert.rejects(
    embedder.embed(["never"], { signal: external.signal }),
    (error) => error.code === "embedder_aborted",
  );
});

test("an abort during a retry wait clears the timer and rejects promptly", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server, { maxRetries: 3, sleep: undefined });
  server.script({ status: 429, retryAfter: "30" });
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(
    embedder.embed(["unit-alpha-7f3e"], { signal: controller.signal }),
    (error) => error.code === "embedder_aborted",
  );
  assert.ok(Date.now() - started < 5000, "the 30 s Retry-After wait was cut short");
  assert.equal(embedder.usage().retries, 1);
  assert.equal(server.requests.length, 1);
});

test("names a missing key variable without its value and sends no header without one", async (t) => {
  const server = await serverFor(t);
  assert.throws(
    () => embedderFor(server, { apiKeyEnv: "OKF_MISSING_EMBED_KEY" }),
    (error) =>
      error.code === "embedder_key_missing" &&
      /OKF_MISSING_EMBED_KEY/.test(error.message) &&
      error.details.variable === "OKF_MISSING_EMBED_KEY",
  );
  assert.throws(
    () => embedderFor(server, { apiKeyEnv: "OKF_EMPTY", env: { OKF_EMPTY: "   " } }),
    (error) => error.code === "embedder_key_missing",
  );
  assert.throws(
    () => embedderFor(server, { apiKeyEnv: "not a name" }),
    (error) => error.code === "invalid_embedder_config" && error.details.field === "apiKeyEnv",
  );
  const open = await serverFor(t, { apiKey: null });
  const { embedder } = embedderFor(open, { apiKeyEnv: undefined });
  await embedder.embed(["anonymous"]);
  assert.equal(open.requests[0].headers.authorization, undefined);
  assert.match(open.requests[0].headers["user-agent"], /^okf-mcp\//);
});

test("masks input text and the key in every error path", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server, { maxRetries: 0 });
  const secretInput = "confidential catalogue text that must never surface";
  server.script({ echoInput: true });
  await assert.rejects(embedder.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    assert.equal(error.details.serverCode, "invalid_request");
    return true;
  });
  server.script({
    status: 400,
    body: JSON.stringify({
      error: {
        message: `Incorrect API key provided: ${KEY}. Bearer ${KEY} rejected.`,
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    }),
  });
  await assert.rejects(embedder.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    assert.equal(error.details.serverCode, "invalid_api_key");
    return true;
  });
  server.script({ status: 500, body: "<html>gateway exploded</html>" });
  await assert.rejects(embedder.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    assert.equal(error.details.serverCode, "server_error");
    return true;
  });
  const wrongKey = await serverFor(t, { apiKey: "sk-other-key-9876543210" });
  const { embedder: unauthorised } = embedderFor(wrongKey, { maxRetries: 0 });
  await assert.rejects(unauthorised.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    return error.status === 401 && error.details.serverCode === "invalid_api_key";
  });
  const closed = await startFakeEmbeddingsServer({ apiKey: KEY });
  const { baseUrl } = closed;
  await closed.close();
  const { embedder: unreachable } = embedderFor({ baseUrl }, { maxRetries: 0 });
  await assert.rejects(unreachable.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    return error.code === "embedder_network_error";
  });
});

test("returns constant-shaped errors whatever an error body contains", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server, { maxRetries: 0 });
  const secretInput = "confidential catalogue text that must never surface";
  const encodedKey = encodeURIComponent(KEY);
  const base64Key = Buffer.from(KEY).toString("base64");
  const forbidden = [
    KEY,
    encodedKey,
    base64Key,
    secretInput,
    secretInput.toUpperCase(),
    secretInput.slice(5, 25),
    Buffer.from(secretInput).toString("base64"),
  ];
  const bodies = [
    JSON.stringify({
      error: {
        code: KEY,
        type: `Bearer ${KEY}`,
        param: secretInput,
        message: "x".repeat(1000),
      },
    }),
    JSON.stringify({ error: { code: encodedKey, message: `key=${encodedKey}` } }),
    JSON.stringify({ error: { code: base64Key, type: base64Key } }),
    JSON.stringify({
      error: { code: KEY.slice(0, 10), type: KEY.slice(10, 20), param: KEY.slice(20) },
    }),
    JSON.stringify({
      error: { message: secretInput.toUpperCase(), param: secretInput.slice(5, 25) },
    }),
    JSON.stringify({ error: { code: "totally_made_up_code", type: "also_made_up" } }),
    JSON.stringify({ message: secretInput, code: "flat_shape" }),
    JSON.stringify([KEY, secretInput]),
    `Authorization: Bearer ${encodedKey} / ${base64Key} / ${secretInput}`,
    "<html>upstream exploded</html>",
    "",
  ];
  const shapes = new Set();
  for (const body of bodies) {
    server.script({ status: 400, body });
    await assert.rejects(embedder.embed([secretInput]), (error) => {
      assert.equal(error.message, "Embeddings request failed with HTTP 400.");
      assert.deepEqual(error.details, { status: 400, serverCode: "invalid_request", attempts: 1 });
      const serialized = JSON.stringify({
        message: error.message,
        details: error.details,
        stack: error.stack,
        own: Object.keys(error),
      });
      for (const needle of forbidden) {
        assert.equal(serialized.includes(needle), false, `leaked: ${needle}`);
      }
      shapes.add(JSON.stringify([error.message, Object.keys(error.details).sort()]));
      return true;
    });
  }
  assert.equal(shapes.size, 1, "every adversarial body produced the same error shape");

  // The server code is one of our constants, chosen from status and code.
  // End to end through the server; the full precedence table has its own test.
  const typed = (type, code) => JSON.stringify({ error: { type, code, message: "m" } });
  const cases = [
    [401, typed("invalid_request_error", null), "invalid_api_key"],
    [404, typed("invalid_request_error", null), "model_not_found"],
    [429, "", "rate_limited"],
    [429, typed("insufficient_quota", null), "insufficient_quota"],
    [400, typed("authentication_error", null), "invalid_api_key"],
    [418, "teapot", "invalid_request"],
    [500, "<html>gateway exploded</html>", "server_error"],
    [503, typed("authentication_error", KEY), "server_error"],
  ];
  for (const [status, body, expected] of cases) {
    server.script({ status, body });
    await assert.rejects(embedder.embed([secretInput]), (error) => {
      assert.equal(error.message, `Embeddings request failed with HTTP ${status}.`);
      assert.equal(error.details.serverCode, expected, `${status} ${body}`);
      assert.deepEqual(Object.keys(error.details).sort(), ["attempts", "serverCode", "status"]);
      return true;
    });
  }
});

test("classifies server errors by status, then code, then type", () => {
  const body = (code, type) => JSON.stringify({ error: { code, type, message: "m" } });
  // [status, code, type, expected]
  const table = [
    // Any 5xx is a server failure whatever the body claims.
    [500, null, null, "server_error"],
    [502, "invalid_api_key", "authentication_error", "server_error"],
    [503, "insufficient_quota", "insufficient_quota", "server_error"],
    // 401, 404 and 429 speak for themselves.
    [401, null, "invalid_request_error", "invalid_api_key"],
    [401, "model_not_found", "not_found_error", "invalid_api_key"],
    [404, null, "invalid_request_error", "model_not_found"],
    [404, "invalid_api_key", null, "model_not_found"],
    [429, null, "invalid_request_error", "rate_limited"],
    [429, "rate_limit_exceeded", "rate_limit_error", "rate_limited"],
    // ... unless quota exhaustion is named, on 429, 402 or 403.
    [429, "insufficient_quota", null, "insufficient_quota"],
    [429, null, "insufficient_quota", "insufficient_quota"],
    [402, null, "insufficient_quota", "insufficient_quota"],
    [403, "insufficient_quota", null, "insufficient_quota"],
    [402, null, "invalid_request_error", "invalid_request"],
    [403, "permission_denied", null, "invalid_request"],
    // Other 4xx: code first.
    [400, "invalid_api_key", null, "invalid_api_key"],
    [400, "model_not_found", null, "model_not_found"],
    [400, "insufficient_quota", null, "insufficient_quota"],
    [400, "context_length_exceeded", null, "invalid_request"],
    [400, "rate_limit_exceeded", null, "invalid_request"],
    // Then type.
    [400, null, "authentication_error", "invalid_api_key"],
    [400, null, "not_found_error", "model_not_found"],
    [400, null, "rate_limit_error", "rate_limited"],
    [400, null, "insufficient_quota", "insufficient_quota"],
    [400, null, "invalid_request_error", "invalid_request"],
    // Code beats type when both are present; an unknown code falls to type.
    [400, "model_not_found", "authentication_error", "model_not_found"],
    [400, "unknown_code", "rate_limit_error", "rate_limited"],
    [422, null, null, "invalid_request"],
    // Outside 4xx/5xx nothing is claimed.
    [399, "invalid_api_key", "authentication_error", "unknown"],
  ];
  for (const [status, code, type, expected] of table) {
    assert.equal(
      classifyServerError(status, body(code, type)),
      expected,
      `${status} ${code} ${type}`,
    );
  }
  assert.equal(classifyServerError(400, "not json"), "invalid_request");
  assert.equal(
    classifyServerError(400, JSON.stringify({ code: "invalid_api_key" })),
    "invalid_api_key",
  );
  assert.equal(classifyServerError(400, JSON.stringify([1, 2])), "invalid_request");
});

test("derives id, endpoint and remote from the base URL and discovers the dimension", async (t) => {
  const never = () => {
    throw new Error("no request expected");
  };
  const hosted = createOpenAiEmbedder({
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    dimensions: 512,
    fetch: never,
  });
  assert.equal(
    hosted.id,
    "openai:https://api.openai.com/v1/embeddings:text-embedding-3-small:512:24000",
  );
  assert.equal(hosted.endpoint, "https://api.openai.com/v1/embeddings");
  assert.equal(hosted.remote, true);
  assert.deepEqual(hosted.languages, []);
  const local = createOpenAiEmbedder({
    baseUrl: "http://localhost:11434/",
    model: "nomic-embed-text",
    fetch: never,
    languages: ["en", "it"],
  });
  assert.equal(local.endpoint, "http://localhost:11434/v1/embeddings");
  assert.equal(local.remote, false);
  assert.deepEqual(local.languages, ["en", "it"]);
  assert.equal(local.id, "openai:http://localhost:11434/v1/embeddings:nomic-embed-text:?:24000");
  assert.equal(local.dimension, null);
  assert.throws(
    () => validateEmbedder(local),
    (error) => error.details.field === "dimension",
  );
  const gateway = createOpenAiEmbedder({
    baseUrl: "http://[::1]:8000/openai",
    model: "m",
    fetch: never,
    dimensions: 4,
  });
  assert.equal(gateway.endpoint, "http://[::1]:8000/openai/v1/embeddings");
  assert.equal(gateway.remote, false);
  assert.equal(gateway.id, "openai:http://[::1]:8000/openai/v1/embeddings:m:4:24000");
  // Gateways that differ only by path key different caches.
  const otherPath = createOpenAiEmbedder({
    baseUrl: "http://[::1]:8000/other",
    model: "m",
    fetch: never,
    dimensions: 4,
  });
  assert.notEqual(otherPath.id, gateway.id);
  assert.equal(
    createOpenAiEmbedder({ baseUrl: "http://10.0.0.5:8000", model: "m", fetch: never }).remote,
    true,
  );

  const server = await serverFor(t, { dimension: 12 });
  const { embedder } = embedderFor(server, { dimensions: undefined });
  assert.equal(embedder.dimension, null);
  assert.deepEqual(await embedder.probe(), {
    id: idFor(server, "fake-embed", 12),
    dimension: 12,
  });
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].body.input.length, 1);
  assert.equal(server.requests[0].body.dimensions, undefined);
  await embedder.probe();
  assert.equal(server.requests.length, 1);
  validateEmbedder(embedder);
  const [vector] = await embedder.embed(["after probe"]);
  assert.equal(vector.length, 12);

  const strict = await serverFor(t, { supportsDimensions: false });
  const { embedder: unsupported } = embedderFor(strict, { maxRetries: 0 });
  await assert.rejects(
    unsupported.embed(["x"]),
    (error) => error.status === 400 && error.details.serverCode === "invalid_request",
  );
});

test("rejects unsafe configuration without echoing the values", () => {
  const cases = [
    [{ baseUrl: "https://user:pw-secret@api.example.com", model: "m" }, "baseUrl"],
    [{ baseUrl: "https://api.example.com/?token=abc", model: "m" }, "baseUrl"],
    [{ baseUrl: "ftp://api.example.com", model: "m" }, "baseUrl"],
    [{ baseUrl: "not a url", model: "m" }, "baseUrl"],
    [{ baseUrl: "https://api.example.com", model: "has space" }, "model"],
    [{ baseUrl: "https://api.example.com", model: "m", batchSize: 0 }, "batchSize"],
    [{ baseUrl: "https://api.example.com", model: "m", maxRetries: -1 }, "maxRetries"],
    [{ baseUrl: "https://api.example.com", model: "m", concurrency: 0 }, "concurrency"],
    [{ baseUrl: "https://api.example.com", model: "m", timeoutMs: 0 }, "timeoutMs"],
    [{ baseUrl: "https://api.example.com", model: "m", dimensions: 1.5 }, "dimensions"],
    [
      { baseUrl: "https://api.example.com", model: "m", maxRequestTokens: 300001 },
      "maxRequestTokens",
    ],
    [{ baseUrl: "https://api.example.com", model: "m", languages: "en" }, "languages"],
    [{ baseUrl: "https://api.example.com", model: "m", fetch: null }, "fetch"],
  ];
  for (const [options, field] of cases) {
    assert.throws(
      () => createOpenAiEmbedder({ fetch: () => {}, ...options }),
      (error) => {
        assert.equal(error.code, "invalid_embedder_config", field);
        assert.equal(error.details.field, field);
        assert.equal(error.message.includes("pw-secret"), false);
        assert.equal(error.message.includes("token=abc"), false);
        return true;
      },
    );
  }
});

test("parses Retry-After in both formats and caps the wait", () => {
  const nowMs = Date.UTC(2026, 9, 24, 12, 0, 0);
  assert.equal(parseRetryAfter("3", nowMs), 3000);
  assert.equal(parseRetryAfter("0.5", nowMs), 500);
  assert.equal(parseRetryAfter(new Date(nowMs + 7000).toUTCString(), nowMs), 7000);
  assert.equal(parseRetryAfter(new Date(nowMs - 7000).toUTCString(), nowMs), 0);
  assert.equal(parseRetryAfter("3600", nowMs), 60000);
  assert.equal(parseRetryAfter("soon", nowMs), null);
  assert.equal(parseRetryAfter(null, nowMs), null);
});

test("never follows a redirect, so no request reaches the redirect target", async (t) => {
  const target = await serverFor(t, { apiKey: null });
  const origin = await serverFor(t);
  const { embedder, sleeps } = embedderFor(origin, { maxRetries: 3 });
  const secretInput = "confidential catalogue text that must never surface";
  for (const status of [301, 302, 307, 308]) {
    origin.script({
      status,
      headers: { location: `${target.baseUrl}/v1/embeddings` },
      body: "moved",
    });
    await assert.rejects(embedder.embed([secretInput]), (error) => {
      assertMasked(error, [secretInput]);
      assert.equal(error.code, "embedder_redirect");
      assert.equal(error.details.status, status);
      assert.equal(error.message.includes(target.baseUrl), false);
      return true;
    });
  }
  assert.equal(target.requests.length, 0);
  assert.equal(origin.requests.length, 4);
  assert.deepEqual(sleeps, [], "a redirect is not retried");
  assert.equal(embedder.remote, false);
});

test("keeps every input within the request token budget", async (t) => {
  const server = await serverFor(t);
  assert.throws(
    () => embedderFor(server, { maxInputChars: 32000, maxRequestTokens: 1000 }),
    (error) =>
      error.code === "invalid_embedder_config" && error.details.field === "maxRequestTokens",
  );
  const { embedder } = embedderFor(server, {
    maxInputChars: 3000,
    maxRequestTokens: 1000,
    concurrency: 1,
  });
  await embedder.embed(["a".repeat(40000), "b", "c".repeat(40000)]);
  assert.deepEqual(
    server.requests.map((request) => request.body.input.length),
    [1, 1, 1],
  );
  assert.deepEqual(
    server.requests.map((request) => request.body.input[0].length),
    [3000, 1, 3000],
  );
  const oversized = "x".repeat(6000);
  assert.deepEqual(
    planBatches(["a", oversized, "b"], 2048, 1000).map((batch) => batch.texts.length),
    [1, 1, 1],
  );
  assert.deepEqual(
    planBatches([oversized, oversized], 2048, 1000).map((batch) => batch.tokens),
    [2000, 2000],
  );
  assert.deepEqual(
    planBatches(["a", "b", oversized, "c"], 2048, 1000).map((batch) => batch.offset),
    [0, 2, 3],
  );
});

test("caps the requests in flight per call through options.concurrency", async (t) => {
  const server = await serverFor(t, { delayMs: 30 });
  const { embedder } = embedderFor(server, { batchSize: 1, concurrency: 3 });
  const texts = ["a1", "b2", "c3", "d4", "e5", "f6"];
  await embedder.embed(texts, { concurrency: 1 });
  assert.equal(server.stats.maxInFlight, 1);
  await embedder.embed(texts, { concurrency: 9 });
  assert.ok(server.stats.maxInFlight <= 3, "the configured concurrency stays the ceiling");
  assert.equal(server.requests.length, 12);
});

test("a retry wait keeps a process alive until the retried request completes", async (t) => {
  const server = await serverFor(t, { apiKey: null, dimension: 4 });
  server.script({ status: 429, retryAfter: "1" });
  const clientPath = path.join(__dirname, "..", "src", "embed", "openai.js");
  const script = [
    `const { createOpenAiEmbedder } = require(${JSON.stringify(clientPath)});`,
    "createOpenAiEmbedder({ baseUrl: process.argv[1], model: 'm', dimensions: 4, maxRetries: 2 })",
    "  .embed(['kept alive'])",
    "  .then(",
    "    (vectors) => console.log('vectors', vectors.length),",
    "    (error) => { console.error(error.code); process.exitCode = 2; },",
    "  );",
  ].join("\n");
  const child = await new Promise((resolve) => {
    const proc = spawn(process.execPath, ["-e", script, server.baseUrl], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(child.code, 0, child.stderr);
  assert.equal(child.stdout.trim(), "vectors 1");
  assert.equal(server.requests.length, 2, "the child exited only after the retried request");
});

test("a failed batch cancels its in-flight sibling and schedules nothing further", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server, { batchSize: 1, concurrency: 2, maxRetries: 0 });
  server.script({ status: 500 }, { delayMs: 300 });
  await assert.rejects(
    embedder.embed(["unit-a1", "unit-b2", "unit-c3"]),
    (error) => error.code === "embedder_http_error" && error.status === 500,
  );
  assert.ok(server.requests.length <= 2, "the server saw at most the two in-flight requests");
  assert.equal(embedder.usage().requests, 2, "the third batch was never requested");
});

test("sends at most 2,048 inputs per request through embed()", async (t) => {
  const server = await serverFor(t, { dimension: 2 });
  const { embedder } = embedderFor(server, { batchSize: 2048, dimensions: 2, concurrency: 1 });
  const texts = Array.from({ length: 2049 }, (_, index) => `t${index}`);
  const vectors = await embedder.embed(texts);
  assert.equal(vectors.length, 2049);
  assertClose(vectors[2048], vectorFor("t2048", 2));
  assert.deepEqual(
    server.requests.map((request) => request.body.input.length),
    [2048, 1],
  );
});

test("budgets tokens at ceil(chars / 3) and truncates at 24,000 characters by default", () => {
  assert.equal(OPENAI_EMBEDDING_LIMITS.conservativeCharsPerToken, 3);
  assert.equal(OPENAI_EMBEDDING_LIMITS.charsPerToken, 4, "reporting estimate unchanged");
  assert.equal(OPENAI_EMBEDDER_DEFAULTS.maxInputChars, 24000);
  assert.ok(
    Math.ceil(OPENAI_EMBEDDER_DEFAULTS.maxInputChars / 3) <= OPENAI_EMBEDDING_LIMITS.maxInputTokens,
  );
  assert.deepEqual(
    planBatches(["a".repeat(3000), "b".repeat(3)], 2048, 1000).map((batch) => batch.tokens),
    [1000, 1],
  );
});

test("a lone input over the provider's limit is retried once at half its length", async (t) => {
  const server = await serverFor(t, { rejectInputsAbove: 5000 });
  const { embedder, sleeps } = embedderFor(server);
  const long = "contract_column_identifier ".repeat(300).slice(0, 8000);
  const [vector] = await embedder.embed([long]);
  assertClose(vector, vectorFor(long.slice(0, 4000), 8));
  assert.deepEqual(
    server.requests.map((request) => request.body.input[0].length),
    [8000, 4000],
  );
  assert.equal(embedder.usage().halved, 1);
  assert.equal(embedder.usage().rejected, 0);
  assert.deepEqual(sleeps, [], "a rejection is not a retryable failure");
  // Never below the floor: a 3,000-character input is retried at 2,000.
  server.rejectInputsAbove = 2500;
  const [short] = await embedder.embed(["y".repeat(3000)]);
  assertClose(short, vectorFor("y".repeat(2000), 8));
  assert.equal(server.requests.at(-1).body.input[0].length, 2000);
});

test("bisection isolates one rejected input in the middle of a batch", async (t) => {
  const server = await serverFor(t, { rejectInputsAbove: 5000 });
  const { embedder } = embedderFor(server, { concurrency: 1 });
  const texts = Array.from({ length: 9 }, (_, index) => `ordinary unit number ${index}`);
  // Still above the limit once halved, so it stays rejected.
  const bad = "x".repeat(12000);
  texts.splice(4, 0, bad);
  const vectors = await embedder.embed(texts, { skipRejected: true });
  assert.equal(vectors.length, 10);
  assert.equal(vectors[4], null);
  texts.forEach((text, index) => {
    if (index !== 4) assertClose(vectors[index], vectorFor(text, 8));
  });
  const usage = embedder.usage();
  assert.equal(usage.rejected, 1);
  assert.equal(usage.halved, 0);
  // The rejected request, two per halving level, and one halving retry.
  assert.ok(server.requests.length <= 1 + 2 * Math.ceil(Math.log2(10)) + 1);
  const sent = server.requests.flatMap((request) => request.body.input);
  assert.ok(sent.includes(bad.slice(0, 6000)), "the halving retry ran");
  // Each good input reached a successful request exactly once.
  const accepted = server.requests
    .filter((request) => !request.body.input.some((text) => text.length > 5000))
    .flatMap((request) => request.body.input);
  assert.deepEqual(accepted.slice().sort(), texts.filter((_, index) => index !== 4).sort());
});

test("without skipRejected a rejected input still fails the call, masked", async (t) => {
  const server = await serverFor(t, { rejectInputsAbove: 5000 });
  const { embedder } = embedderFor(server);
  const bad = "secret column list ".repeat(700);
  await assert.rejects(embedder.embed(["fine", bad, "also fine"]), (error) => {
    assertMasked(error, [bad.slice(0, 200)]);
    assert.equal(error.code, "embedder_http_error");
    assert.equal(error.details.serverCode, "invalid_request");
    return true;
  });
  assert.equal(embedder.usage().rejected, 1);
});

test("a request whose every input is rejected fails within the isolation budget", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server, { concurrency: 1 });
  const texts = Array.from({ length: 64 }, (_, index) => `unit ${index}`);
  // A configuration problem: every request answers 400 invalid_request.
  server.script(...Array.from({ length: 1000 }, () => ({ status: 400 })));
  await assert.rejects(
    embedder.embed(texts, { skipRejected: true }),
    (error) => error.details.serverCode === "invalid_request",
  );
  const budget = 16 * Math.ceil(Math.log2(65)) + 8;
  assert.ok(server.requests.length <= 1 + budget, `${server.requests.length} requests`);
  const few = await serverFor(t);
  const { embedder: small } = embedderFor(few);
  few.script({ status: 400 }, { status: 400 }, { status: 400 });
  await assert.rejects(
    small.embed(["one", "two"], { skipRejected: true }),
    (error) => error.details.serverCode === "invalid_request",
  );
  assert.equal(few.requests.length, 3);
});
