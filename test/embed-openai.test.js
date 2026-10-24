"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { EmbedderError, validateEmbedder } = require("../src/embed/interface");
const {
  OPENAI_EMBEDDING_LIMITS,
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
  assert.equal(embedder.id, `openai:${new URL(server.baseUrl).host}:fake-embed:8`);
  assert.equal(embedder.remote, false);
  assert.equal(embedder.dimension, 8);
  assert.equal(embedder.maxBatch, 3);
  assert.equal(embedder.maxInputChars, 32000);

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
  const heavy = "y".repeat(4000);
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
    [32000, 5],
  );
  assert.equal(embedder.usage().truncated, 1);
  const { embedder: narrow } = embedderFor(server, { maxInputChars: 100 });
  await narrow.embed(["b".repeat(1000)]);
  assert.equal(server.requests[1].body.input[0].length, 100);
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
    assert.equal(error.details.attempts, 2);
    return true;
  });
  assert.deepEqual(sleeps, [375]);
  server.script({ status: 400, code: "invalid_request" });
  await assert.rejects(embedder.embed(["bad"]), (error) => {
    assertMasked(error, ["bad"]);
    assert.match(error.message, /HTTP 400 \(invalid_request\)/);
    assert.equal(error.details.attempts, 1);
    return true;
  });
  assert.equal(server.requests.length, 3);
});

test("times out with an AbortController and retries within the budget", async (t) => {
  const server = await serverFor(t);
  const { embedder, sleeps } = embedderFor(server, { timeoutMs: 50, maxRetries: 1 });
  server.script({ delayMs: 400 }, { delayMs: 400 });
  const started = Date.now();
  await assert.rejects(embedder.embed(["slow"]), (error) => {
    assertMasked(error, ["slow"]);
    return (
      error.code === "embedder_timeout" &&
      error.details.timeoutMs === 50 &&
      error.details.attempts === 2
    );
  });
  assert.ok(Date.now() - started < 2000);
  assert.equal(sleeps.length, 1);
  const external = new AbortController();
  external.abort();
  await assert.rejects(
    embedder.embed(["never"], { signal: external.signal }),
    (error) => error.code === "embedder_aborted",
  );
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
    assert.equal(error.details.server.code, "invalid_input");
    assert.equal(error.details.server.message, undefined);
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
    assert.equal(error.details.server.message, undefined);
    return true;
  });
  server.script({ status: 500, body: "<html>gateway exploded</html>" });
  await assert.rejects(embedder.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    assert.equal(error.details.server.message, "<html>gateway exploded</html>");
    return true;
  });
  const wrongKey = await serverFor(t, { apiKey: "sk-other-key-9876543210" });
  const { embedder: unauthorised } = embedderFor(wrongKey, { maxRetries: 0 });
  await assert.rejects(unauthorised.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    return error.status === 401 && /invalid_api_key/.test(error.message);
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
  assert.equal(hosted.id, "openai:api.openai.com:text-embedding-3-small:512");
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
  assert.equal(local.id, "openai:localhost:11434:nomic-embed-text:?");
  assert.equal(local.dimension, null);
  assert.throws(
    () => validateEmbedder(local),
    (error) => error.details.field === "dimension",
  );
  const gateway = createOpenAiEmbedder({
    baseUrl: "http://[::1]:8000/openai",
    model: "m",
    fetch: never,
  });
  assert.equal(gateway.endpoint, "http://[::1]:8000/openai/v1/embeddings");
  assert.equal(gateway.remote, false);
  assert.equal(
    createOpenAiEmbedder({ baseUrl: "http://10.0.0.5:8000", model: "m", fetch: never }).remote,
    true,
  );

  const server = await serverFor(t, { dimension: 12 });
  const { embedder } = embedderFor(server, { dimensions: undefined });
  assert.equal(embedder.dimension, null);
  assert.deepEqual(await embedder.probe(), {
    id: `openai:${new URL(server.baseUrl).host}:fake-embed:12`,
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
    (error) => error.status === 400 && /unknown_parameter/.test(error.message),
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

test("keeps server-supplied strings out of error messages and drops tainted fields", async (t) => {
  const server = await serverFor(t);
  const { embedder } = embedderFor(server, { maxRetries: 0 });
  const secretInput = "confidential catalogue text that must never surface";
  const body = (error) => ({ status: 400, body: JSON.stringify({ error }) });

  // Key as code, bearer token as type, input as param, oversized message.
  server.script(
    body({
      code: KEY,
      type: `Bearer ${KEY}`,
      param: `field ${secretInput} end`,
      message: `${"long ".repeat(300)}tail`,
    }),
  );
  await assert.rejects(embedder.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    assert.equal(error.message, "Embeddings request failed with HTTP 400.");
    assert.deepEqual(Object.keys(error.details.server), ["message"]);
    assert.equal(error.details.server.message.length, 200);
    return true;
  });

  // A lowercase code reaches the message only when it carries no input text.
  server.script(body({ code: "invalid_api_key" }));
  await assert.rejects(
    embedder.embed([secretInput]),
    (error) =>
      error.message === "Embeddings request failed with HTTP 400 (invalid_api_key)." &&
      error.details.server.code === "invalid_api_key",
  );
  server.script(body({ code: "invalid_api_key" }));
  await assert.rejects(embedder.embed(["key"]), (error) => {
    assertMasked(error, ["key"]);
    return (
      error.message === "Embeddings request failed with HTTP 400." &&
      error.details.server.code === undefined
    );
  });

  // Mixed case, digits or punctuation never enter the message; a short input
  // of any length taints a field that contains it, and the key is matched in
  // any case.
  server.script(body({ code: "Invalid-Key-01", type: "x", param: "y" }));
  await assert.rejects(embedder.embed(["x"]), (error) => {
    assert.equal(error.message, "Embeddings request failed with HTTP 400.");
    assert.deepEqual(error.details.server, { code: "Invalid-Key-01", param: "y" });
    return true;
  });
  const lowerKey = "abcdefghijklmnopqrstuvwxyz";
  const lowerServer = await serverFor(t, { apiKey: lowerKey });
  const { embedder: lowerKeyed } = embedderFor(lowerServer, {
    maxRetries: 0,
    apiKeyEnv: "OKF_LOWER_KEY",
    env: { OKF_LOWER_KEY: lowerKey },
  });
  lowerServer.script(body({ code: lowerKey, type: lowerKey.toUpperCase(), message: "fine" }));
  await assert.rejects(lowerKeyed.embed([secretInput]), (error) => {
    const serialized = JSON.stringify({ message: error.message, details: error.details });
    assert.equal(serialized.toLowerCase().includes(lowerKey), false);
    assert.deepEqual(error.details.server, { message: "fine" });
    return true;
  });

  // A non-JSON body that echoes the input is dropped entirely.
  server.script({ status: 502, body: `upstream rejected: ${secretInput}` });
  await assert.rejects(embedder.embed([secretInput]), (error) => {
    assertMasked(error, [secretInput]);
    assert.deepEqual(error.details.server, {});
    return error.status === 502;
  });
});
