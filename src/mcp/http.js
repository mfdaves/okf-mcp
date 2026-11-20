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

const { advertisedScopes } = require("../tool-packs");
const { createHttpAuth } = require("./auth");
const { anonymousPrincipal } = require("./principal");
const {
  MAX_MCP_MESSAGE_BYTES,
  createStateAsync,
  registerMcpInterface,
  viewStateFor,
} = require("./server");

const DEFAULT_MCP_PATH = "/mcp";
const DEFAULT_REFRESH_INTERVAL_MS = 2000;

// CORS for the origins --allowed-origin (and the localhost names) accept:
// the exact origin is echoed, never "*".
const CORS_ALLOW_METHODS = "GET, POST, DELETE, OPTIONS";
const CORS_ALLOW_HEADERS =
  "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID";
const CORS_EXPOSE_HEADERS = "WWW-Authenticate, Mcp-Session-Id";

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-expose-headers": CORS_EXPOSE_HEADERS,
  };
}

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
  for (const [key, value] of Object.entries(extraHeaders || {})) {
    headers[key] = key === "vary" && headers.vary ? `${headers.vary}, ${value}` : value;
  }
  res.writeHead(response.status, headers);
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

// Plan I-2c: the refresher the server state runs before a call or resource
// read that uses the index (never for initialize, ping or tools/list),
// inside the call queue and in the same job as that read: when at least
// `intervalMs` has passed since the last check, the shared index is
// refreshed from disk. A failed refresh leaves the index as it was.
function indexRefresher(state, intervalMs) {
  let checkedAt = Date.now();
  // A write through any state of the process (the server's own or a view's)
  // makes this one look at its files again at once.
  const generation = () => (state.base || state).writeGeneration || 0;
  let seen = generation();
  return () => {
    const now = Date.now();
    if (generation() === seen && now - checkedAt < intervalMs) return;
    seen = generation();
    checkedAt = now;
    try {
      state.refreshIndex();
    } catch {
      // Served from the index it had.
    }
  };
}

// The request handler for one shared state. `options`: mcpPath, allowedHosts
// and allowedOrigins (hostnames, added to the localhost names),
// `authenticate(request)` resolving to a principal or to a challenge
// Response, `routes(request)` for extra documents (a Response or undefined),
// and `refreshIntervalMs` (default 2,000; see indexRefresher).
function createMcpHttpHandler(state, options) {
  const config = options || {};
  // From now on many principals share this state (see GATES.runtimeRemote).
  state.transport = "http";
  // Each view of the project (plan I-2d) gets a refresher of its own.
  state.viewRefresher = (target) =>
    indexRefresher(target, config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS);
  state.refreshBeforeRead = state.viewRefresher(state);
  const mcpPath = config.mcpPath || DEFAULT_MCP_PATH;
  // The endpoint answers with and without one trailing slash, so a
  // --public-url written either way reaches it.
  const mcpPaths = new Set([mcpPath, mcpPath === "/" ? "/" : `${mcpPath}/`]);
  // GET /health, and beside the endpoint as well (/okf/mcp → /okf/health),
  // where a client deriving it from the MCP URL looks for it.
  const healthPaths = new Set(["/health", `${mcpPath.replace(/\/[^/]*$/, "")}/health`]);
  const allowedHosts = localhostAllowedHostnames().concat(config.allowedHosts || []);
  const allowedOrigins = localhostAllowedOrigins().concat(config.allowedOrigins || []);
  const mcp = createMcpHandler(
    (context) => {
      // Each principal is served from the state of its view: the bundles it
      // may read (plan I-2d).
      const principal = context.authInfo?.extra?.principal || anonymousPrincipal();
      return registerMcpInterface(viewStateFor(state, principal), principal, {
        subjectToken: context.authInfo?.extra?.subjectToken,
      });
    },
    { legacy: "stateless" },
  );

  // The response for one request, with the headers to add to it:
  // { response, headers?, close? }.
  async function route(req, signal) {
    const probe = toWebRequest(req, null, signal);
    const rejected = hostHeaderValidationResponse(probe, allowedHosts);
    if (rejected) return { response: rejected };
    const pathname = new URL(probe.url).pathname;
    if (healthPaths.has(pathname) && (req.method === "GET" || req.method === "HEAD")) {
      return { response: Response.json({ status: "ok" }) };
    }
    const extra = config.routes ? await config.routes(probe) : undefined;
    if (!extra && !mcpPaths.has(pathname)) {
      return { response: Response.json({ error: "not_found" }, { status: 404 }) };
    }
    // The MCP endpoint and the documents beside it (the protected-resource
    // metadata): a foreign origin gets 403 and no CORS headers; an accepted
    // one gets them on every answer, refusals included, and a preflight is
    // answered before authentication.
    const foreign = originValidationResponse(probe, allowedOrigins);
    if (foreign) return { response: foreign };
    const origin = probe.headers.get("origin");
    const headers = origin ? corsHeaders(origin) : undefined;
    if (origin && req.method === "OPTIONS") {
      const preflight = new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-methods": extra ? "GET, HEAD, OPTIONS" : CORS_ALLOW_METHODS,
          "access-control-allow-headers": CORS_ALLOW_HEADERS,
        },
      });
      return { response: preflight, headers };
    }
    if (extra) return { response: extra, headers };
    const verified = config.authenticate
      ? await config.authenticate(probe)
      : { principal: anonymousPrincipal() };
    if (verified instanceof Response) return { response: verified, headers };
    const { principal, subjectToken } = verified;
    const body = await readBody(req, MAX_MCP_MESSAGE_BYTES);
    if (body === null) {
      const tooLarge = jsonRpcError(413, -32600, "Request body too large.");
      return { response: tooLarge, headers, close: true };
    }
    // createMcpHandler hands authInfo to the factory as-is: the principal,
    // and the verified token only for tool-pack handlers (ctx.subjectToken).
    const authInfo = {
      token: "",
      clientId: principal.subject,
      scopes: [...principal.scopes],
      extra: { principal, subjectToken },
    };
    return { response: await mcp.fetch(toWebRequest(req, body, signal), { authInfo }), headers };
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
      outcome = { response: jsonRpcError(500, -32603, "Internal server error.") };
    }
    const headers = Object.assign(
      {},
      outcome.headers,
      outcome.close ? { connection: "close" } : {},
    );
    await sendWebResponse(res, outcome.response, headers);
  }

  return { handle, close: () => mcp.close() };
}

// Starts `okf mcp --http`: builds the server state like the stdio server does,
// sets up authentication (`http.auth`, see src/mcp/auth.js; `http.env` and
// `http.fetch` stand in for the process's in tests), listens on host:port and
// resolves once listening with { url, port, close }.
async function runMcpHttpServer(bundleArgs, options) {
  const config = options || {};
  const httpOptions = Object.assign({}, config.http);
  // The state first: the tool packs it loads add to the advertised scopes.
  const state = await createStateAsync(bundleArgs, config);
  if (httpOptions.auth) {
    const auth = createHttpAuth(httpOptions.auth, {
      publicUrl: httpOptions.publicUrl,
      env: httpOptions.env,
      fetch: httpOptions.fetch,
      scopes: advertisedScopes(state.toolPacks),
    });
    httpOptions.authenticate = auth.authenticate;
    httpOptions.routes = auth.routes;
  }
  const handler = createMcpHttpHandler(state, httpOptions);
  const server = http.createServer((req, res) => {
    handler.handle(req, res).catch(() => res.destroy());
  });
  const host = httpOptions.host || "127.0.0.1";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(httpOptions.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address();
  const shown = host.includes(":") ? `[${host}]` : host;
  return {
    state,
    port,
    url: `http://${shown}:${port}${httpOptions.mcpPath || DEFAULT_MCP_PATH}`,
    async close() {
      await handler.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  DEFAULT_MCP_PATH,
  DEFAULT_REFRESH_INTERVAL_MS,
  createMcpHttpHandler,
  runMcpHttpServer,
};
