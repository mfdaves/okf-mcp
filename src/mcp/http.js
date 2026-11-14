"use strict";

// MCP over Streamable HTTP (plan I-2): a node:http server with a small bridge
// to the web Request/Response that the SDK's createMcpHandler serves, instead
// of an @modelcontextprotocol/node dependency. The SDK entry validates
// nothing, so this module checks Host on every request and Origin on the MCP
// endpoint, caps request bodies at the stdio message limit, and resolves the
// principal each request runs for (anonymous read-only unless an
// authenticator is configured). Every request builds its McpServer over the
// one shared state, so the calls of all clients share the state's call queue.
// `legacy: "stateless"` serves 2025-era clients next to 2026-07-28 ones.

const http = require("node:http");
const {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} = require("@modelcontextprotocol/server");

const { anonymousPrincipal } = require("./principal");
const { MAX_MCP_MESSAGE_BYTES, createStateAsync, registerMcpInterface } = require("./server");

const DEFAULT_MCP_PATH = "/mcp";
const HEALTH_PATH = "/health";

function jsonRpcError(status, code, message) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

// The request body, or null when it is larger than `limit` bytes; reading
// stops there and the caller answers 413 and closes the connection.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > limit) {
      resolve(null);
      return;
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        req.pause();
        settle(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => settle(Buffer.concat(chunks)));
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

// node:http request → web Request. The URL is built on a fixed base from the
// request path only; the Host header travels as a header and is checked.
function toWebRequest(req, body, signal) {
  const headers = new Headers();
  for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
    headers.append(req.rawHeaders[index], req.rawHeaders[index + 1]);
  }
  const url = new URL("http://localhost/");
  const target = String(req.url || "/");
  const query = target.indexOf("?");
  url.pathname = query < 0 ? target : target.slice(0, query);
  url.search = query < 0 ? "" : target.slice(query);
  return new Request(url, {
    method: req.method,
    headers,
    signal,
    ...(body?.length ? { body, duplex: "half" } : {}),
  });
}

// web Response → node:http response, streaming the body (SSE included) with
// backpressure; a client that goes away cancels the stream.
async function sendWebResponse(res, response, extraHeaders) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, Object.assign(headers, extraHeaders || {}));
  if (!response.body || res.req.method === "HEAD") {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  res.once("close", () => {
    reader.cancel().catch(() => {});
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      if (!res.write(value)) {
        await new Promise((resolve) => {
          res.once("drain", resolve);
          res.once("close", resolve);
        });
      }
    }
  } catch {
    // The client went away or the stream failed; nothing more to send.
  } finally {
    res.end();
  }
}

// The request handler for one shared state. `options`: mcpPath, allowedHosts
// and allowedOrigins (hostnames, added to the localhost names),
// `authenticate(request)` resolving to a principal or to a challenge
// Response, `routes(request)` for extra documents (a Response or undefined),
// and `beforeRequest()` awaited before each MCP request.
function createMcpHttpHandler(state, options) {
  const config = options || {};
  const mcpPath = config.mcpPath || DEFAULT_MCP_PATH;
  const allowedHosts = localhostAllowedHostnames().concat(config.allowedHosts || []);
  const allowedOrigins = localhostAllowedOrigins().concat(config.allowedOrigins || []);
  const mcp = createMcpHandler(
    (context) =>
      registerMcpInterface(state, context.authInfo?.extra?.principal || anonymousPrincipal()),
    { legacy: "stateless" },
  );

  async function route(req, signal) {
    const probe = toWebRequest(req, null, signal);
    const rejected = hostHeaderValidationResponse(probe, allowedHosts);
    if (rejected) return rejected;
    const pathname = new URL(probe.url).pathname;
    if (pathname === HEALTH_PATH && (req.method === "GET" || req.method === "HEAD")) {
      return Response.json({ status: "ok" });
    }
    const extra = config.routes ? await config.routes(probe) : undefined;
    if (extra) return extra;
    if (pathname !== mcpPath) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const foreign = originValidationResponse(probe, allowedOrigins);
    if (foreign) return foreign;
    const principal = config.authenticate ? await config.authenticate(probe) : anonymousPrincipal();
    if (principal instanceof Response) return principal;
    const body = await readBody(req, MAX_MCP_MESSAGE_BYTES);
    if (body === null) {
      return { response: jsonRpcError(413, -32600, "Request body too large."), close: true };
    }
    if (config.beforeRequest) await config.beforeRequest();
    // createMcpHandler hands authInfo to the factory as-is; it carries the
    // principal, never the bearer token.
    const authInfo = {
      token: "",
      clientId: principal.subject,
      scopes: [...principal.scopes],
      extra: { principal },
    };
    return mcp.fetch(toWebRequest(req, body, signal), { authInfo });
  }

  async function handle(req, res) {
    const aborter = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) aborter.abort();
    });
    let outcome;
    try {
      outcome = await route(req, aborter.signal);
    } catch {
      outcome = jsonRpcError(500, -32603, "Internal server error.");
    }
    const closing = !(outcome instanceof Response) && outcome.close;
    const response = outcome instanceof Response ? outcome : outcome.response;
    await sendWebResponse(res, response, closing ? { connection: "close" } : undefined);
  }

  return { handle, close: () => mcp.close() };
}

// Starts `okf mcp --http`: builds the server state like the stdio server does,
// listens on host:port and resolves once listening with { url, port, close }.
async function runMcpHttpServer(bundleArgs, options) {
  const config = options || {};
  const state = await createStateAsync(bundleArgs, config);
  const handler = createMcpHttpHandler(state, config.http);
  const server = http.createServer((req, res) => {
    handler.handle(req, res).catch(() => res.destroy());
  });
  const host = config.http?.host || "127.0.0.1";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.http?.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address();
  const shown = host.includes(":") ? `[${host}]` : host;
  return {
    state,
    port,
    url: `http://${shown}:${port}${config.http?.mcpPath || DEFAULT_MCP_PATH}`,
    async close() {
      await handler.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  DEFAULT_MCP_PATH,
  createMcpHttpHandler,
  runMcpHttpServer,
};
