"use strict";

// Flags of `okf mcp --http` (plan WP6a, I-2): the main option parser hands
// each argument to parseHttpOption first; httpServerOptions then checks the
// combination and builds the options of runMcpHttpServer (src/mcp/http.js).

const DEFAULT_HTTP_PORT = 8766;

function createHttpOptions() {
  return {
    enabled: false,
    publicUrl: "",
    allowedHosts: [],
    allowedOrigins: [],
    auth: "",
    authorizationServer: "",
  };
}

// Value flags: `repeat` ones collect every value, the others take one.
const VALUE_FLAGS = {
  "--public-url": { key: "publicUrl" },
  "--allowed-host": { key: "allowedHosts", repeat: true },
  "--allowed-origin": { key: "allowedOrigins", repeat: true },
  "--auth": { key: "auth" },
  "--authorization-server": { key: "authorizationServer" },
};

// Consumes one HTTP flag at argv[index]: returns how many extra arguments
// it used, or -1 when `arg` is not an HTTP flag. `fail` builds a usage error.
function parseHttpOption(arg, argv, index, http, fail) {
  if (arg === "--http") {
    http.enabled = true;
    return 0;
  }
  const equals = arg.indexOf("=");
  const name = equals > 0 ? arg.slice(0, equals) : arg;
  const flag = VALUE_FLAGS[name];
  if (!flag) return -1;
  const inline = equals > 0;
  const value = inline ? arg.slice(equals + 1) : argv[index + 1];
  if (!value || (!inline && String(value).startsWith("-"))) {
    throw fail(`${name} requires a value.`);
  }
  if (flag.repeat) {
    http[flag.key].push(value);
  } else {
    if (http[flag.key]) throw fail(`${name} may be supplied only once.`);
    http[flag.key] = value;
  }
  return inline ? 0 : 1;
}

function isLoopback(host) {
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

// A hostname as the SDK's Host and Origin allowlists compare it (no scheme
// or port; IPv6 in brackets), from a hostname, host:port or origin URL.
function hostnameOf(value, name, fail) {
  try {
    const hostname = new URL(value.includes("://") ? value : `http://${value}`).hostname;
    if (hostname) return hostname;
  } catch {
    // Reported below.
  }
  throw fail(`${name} must be a hostname or an origin URL.`);
}

// --auth tokens:<file> | introspect:<url> (plan I-2a). The introspection
// URL comes only from this flag (B-3): https, or http on a loopback host.
function authOf(http, publicUrl, fail) {
  const issuerOnly = () => fail("--authorization-server requires --auth introspect:<url>.");
  if (!http.auth) {
    if (http.authorizationServer) throw issuerOnly();
    return null;
  }
  const colon = http.auth.indexOf(":");
  const mode = colon > 0 ? http.auth.slice(0, colon) : "";
  const target = colon > 0 ? http.auth.slice(colon + 1) : "";
  if (mode === "tokens" && target) {
    if (http.authorizationServer) throw issuerOnly();
    return { mode, file: target };
  }
  if (mode !== "introspect" || !target) {
    throw fail("--auth must be tokens:<file> or introspect:<url>.");
  }
  let url;
  try {
    url = new URL(target);
  } catch {
    throw fail("--auth introspect:<url> needs an absolute URL.");
  }
  const loopback = url.protocol === "http:" && isLoopback(url.hostname.replace(/^\[|\]$/g, ""));
  if (!(url.protocol === "https:" || loopback) || url.username || url.password) {
    throw fail(
      "--auth introspect:<url> must be https (or http on a loopback host), without credentials.",
    );
  }
  if (url.search || url.hash) {
    throw fail("--auth introspect:<url> must not carry a query or fragment.");
  }
  if (!http.authorizationServer) {
    throw fail("--auth introspect:<url> requires --authorization-server <issuer>.");
  }
  if (!publicUrl) {
    throw fail("--auth introspect:<url> requires --public-url, the token audience.");
  }
  return { mode, url: url.href, issuer: http.authorizationServer };
}

function publicUrlOf(value, fail) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("--public-url must be an absolute http or https URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw fail("--public-url must be an http or https URL without credentials.");
  }
  if (url.search || url.hash) {
    throw fail("--public-url must not carry a query or fragment.");
  }
  return url;
}

// The options of runMcpHttpServer, or null without --http.
function httpServerOptions(args, fail) {
  const http = args.http;
  if (!http.enabled) {
    const given = [
      http.publicUrl,
      http.allowedHosts.length,
      http.allowedOrigins.length,
      http.auth,
      http.authorizationServer,
    ];
    if (given.some(Boolean)) {
      throw fail(
        "--public-url, --allowed-host, --allowed-origin, --auth and --authorization-server require --http.",
      );
    }
    return null;
  }
  // Which scope may create and accept proposals over HTTP is not decided,
  // so the proposal tools stay a stdio feature for now.
  if (args.authoring) {
    throw fail("--authoring is not available with --http.");
  }
  const publicUrl = http.publicUrl ? publicUrlOf(http.publicUrl, fail) : null;
  const auth = authOf(http, publicUrl, fail);
  if (args.write && !auth) {
    throw fail("--write with --http requires --auth: an unauthenticated HTTP caller is read-only.");
  }
  if (!isLoopback(args.host) && !auth) {
    throw fail("--http on a non-loopback --host requires --auth.");
  }
  const port = args.portGiven ? args.port : DEFAULT_HTTP_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw fail("--port must be an integer from 0 through 65535.");
  }
  const mcpPath = publicUrl ? publicUrl.pathname.replace(/(.)\/+$/, "$1") : "/mcp";
  return {
    host: args.host,
    port,
    mcpPath,
    publicUrl: publicUrl ? publicUrl.href : null,
    allowedHosts: http.allowedHosts
      .map((value) => hostnameOf(value, "--allowed-host", fail))
      .concat(publicUrl ? [publicUrl.hostname] : []),
    allowedOrigins: http.allowedOrigins.map((value) => hostnameOf(value, "--allowed-origin", fail)),
    auth,
  };
}

module.exports = {
  DEFAULT_HTTP_PORT,
  createHttpOptions,
  httpServerOptions,
  parseHttpOption,
};
