"use strict";

// An offline stand-in for an OpenAI-compatible embeddings endpoint on
// node:http. Vectors are derived from the SHA-256 of each input so tests can
// predict them; the server enforces the published request limits so the
// client's batching is verified end to end; and a script of per-request
// behaviours lets tests provoke 429/5xx answers, Retry-After headers, slow or
// malformed responses, reordered data entries, and bodies that echo the input.

const crypto = require("node:crypto");
const http = require("node:http");

const LIMITS = { maxBatch: 2048, maxRequestTokens: 300000, maxInputTokens: 8192 };

function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

// Deterministic unit vector: SHA-256 blocks of the text expanded with a counter,
// each 4-byte word mapped to [-1, 1), then L2-normalised.
function vectorFor(text, dimension) {
  const values = new Float32Array(dimension);
  let block = 0;
  let filled = 0;
  while (filled < dimension) {
    const digest = crypto.createHash("sha256").update(`${text}\u0000${block}`).digest();
    for (let offset = 0; offset + 4 <= digest.length && filled < dimension; offset += 4) {
      values[filled] = digest.readUInt32LE(offset) / 2 ** 31 - 1;
      filled += 1;
    }
    block += 1;
  }
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < dimension; index += 1) values[index] /= norm;
  return values;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response, status, headers, body) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(body);
}

function openAiError(message, type, code) {
  return JSON.stringify({ error: { message, type, code, param: null } });
}

async function startFakeEmbeddingsServer(options) {
  const config = options || {};
  const apiKey = config.apiKey === undefined ? null : config.apiKey;
  const defaultDimension = config.dimension || 8;
  const supportsDimensions = config.supportsDimensions !== false;
  const defaultDelayMs = config.delayMs || 0;
  const script = [];
  const requests = [];
  const sockets = new Set();
  // Requests being served right now and the most ever seen at once, so tests
  // can check how many requests a client keeps in flight.
  const stats = { inFlight: 0, maxInFlight: 0 };

  const server = http.createServer(async (request, response) => {
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    response.once("close", () => {
      stats.inFlight -= 1;
    });
    const bodyText = await readJson(request);
    const record = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: null,
    };
    requests.push(record);
    const behaviour = script.length ? script.shift() : {};
    const delayMs = behaviour.delayMs || defaultDelayMs;
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // The request stream is auto-destroyed once its body is read, so only
      // the response tells whether the client is still there.
      if (response.destroyed || response.socket?.destroyed) return;
    }
    if (request.method !== "POST" || request.url !== "/v1/embeddings") {
      send(response, 404, {}, openAiError("Not found", "invalid_request_error", "not_found"));
      return;
    }
    if (apiKey !== null && request.headers.authorization !== `Bearer ${apiKey}`) {
      send(
        response,
        401,
        {},
        openAiError("Incorrect API key provided.", "invalid_request_error", "invalid_api_key"),
      );
      return;
    }
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      send(response, 400, {}, openAiError("Invalid JSON body.", "invalid_request_error", null));
      return;
    }
    record.body = body;
    if (behaviour.status) {
      const headers = {
        ...(behaviour.retryAfter === undefined ? {} : { "retry-after": behaviour.retryAfter }),
        ...(behaviour.headers || {}),
      };
      send(
        response,
        behaviour.status,
        headers,
        behaviour.body === undefined
          ? openAiError(`Scripted ${behaviour.status}.`, "server_error", behaviour.code || null)
          : behaviour.body,
      );
      return;
    }
    if (behaviour.echoInput) {
      send(
        response,
        400,
        {},
        openAiError(`Input rejected: ${body.input[0]}`, "invalid_request_error", "invalid_input"),
      );
      return;
    }
    const input = Array.isArray(body.input) ? body.input : [body.input];
    if (input.some((text) => typeof text !== "string" || text.length === 0)) {
      send(response, 400, {}, openAiError("'$.input' is invalid.", "invalid_request_error", null));
      return;
    }
    if (input.length > LIMITS.maxBatch) {
      send(
        response,
        400,
        {},
        openAiError("Too many inputs.", "invalid_request_error", "too_many_inputs"),
      );
      return;
    }
    const tokens = input.map(estimateTokens);
    if (tokens.some((count) => count > LIMITS.maxInputTokens)) {
      send(
        response,
        400,
        {},
        openAiError(
          "Input exceeds the context length.",
          "invalid_request_error",
          "context_length_exceeded",
        ),
      );
      return;
    }
    const promptTokens = tokens.reduce((sum, count) => sum + count, 0);
    if (promptTokens > LIMITS.maxRequestTokens) {
      send(
        response,
        400,
        {},
        openAiError(
          "Request exceeds the token limit.",
          "invalid_request_error",
          "request_too_large",
        ),
      );
      return;
    }
    let dimension = defaultDimension;
    if (body.dimensions !== undefined) {
      if (!supportsDimensions) {
        send(
          response,
          400,
          {},
          openAiError(
            "Unknown parameter dimensions.",
            "invalid_request_error",
            "unknown_parameter",
          ),
        );
        return;
      }
      dimension = body.dimensions;
    }
    if (behaviour.dimension) dimension = behaviour.dimension;
    if (behaviour.malformed) {
      send(response, 200, {}, '{"object":"list","data":[');
      return;
    }
    let data = input.map((text, index) => ({
      object: "embedding",
      index,
      embedding: Array.from(vectorFor(text, dimension)),
    }));
    if (behaviour.reverse) data = data.slice().reverse();
    if (behaviour.dropLast) data = data.slice(0, -1);
    if (behaviour.component !== undefined) data[0].embedding[0] = behaviour.component;
    if (behaviour.emptyVector) data[0].embedding = [];
    send(
      response,
      200,
      {},
      JSON.stringify({
        object: "list",
        data,
        model: body.model,
        usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
      }),
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    stats,
    // Queue behaviours consumed one per request, in order; an exhausted script
    // answers normally.
    script(...behaviours) {
      script.push(...behaviours);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  LIMITS,
  estimateTokens,
  startFakeEmbeddingsServer,
  vectorFor,
};
