"use strict";

// An offline stand-in for an RFC 7662 introspection endpoint on node:http,
// as test/fake-embeddings-server.js is for embeddings. It requires HTTP Basic
// client credentials (form-urlencoded before base64, RFC 6749 section
// 2.3.1), reads `token` from a form body, and answers the JSON registered for
// that token with `answer(token, json)`, else `{ "active": false }`. Every
// request is recorded; `control.status` makes it answer that HTTP status
// instead, `control.delayMs` holds each answer back, and `stats` counts the
// requests in flight and the most seen at once.

const http = require("node:http");

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function basicCredentials(clientId, clientSecret) {
  const encode = (value) => new URLSearchParams([["", value]]).toString().slice(1);
  return `Basic ${Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`).toString("base64")}`;
}

async function startFakeIntrospectionServer(options) {
  const config = options || {};
  const expectedAuthorization = basicCredentials(config.clientId, config.clientSecret);
  const answers = new Map();
  const requests = [];
  const sockets = new Set();
  const control = { status: null, delayMs: 0 };
  const stats = { inFlight: 0, maxInFlight: 0 };
  const server = http.createServer(async (request, response) => {
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    response.once("close", () => {
      stats.inFlight -= 1;
    });
    const body = await readBody(request);
    const token = new URLSearchParams(body).get("token");
    requests.push({
      method: request.method,
      url: request.url,
      contentType: request.headers["content-type"],
      authorized: request.headers.authorization === expectedAuthorization,
      token,
    });
    if (control.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
    const send = (status, value) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (control.status) return send(control.status, { error: "server_error" });
    if (request.method !== "POST" || request.url !== "/introspect") {
      return send(404, { error: "not_found" });
    }
    if (request.headers.authorization !== expectedAuthorization) {
      return send(401, { error: "invalid_client" });
    }
    return send(200, answers.get(token) || { active: false });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/introspect`,
    requests,
    control,
    stats,
    answer(token, json) {
      answers.set(token, json);
    },
    callsFor(token) {
      return requests.filter((entry) => entry.token === token).length;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { basicCredentials, startFakeIntrospectionServer };
