"use strict";

// An offline OAuth 2.1 authorization server on node:http for tests of the
// SDK client's sign-in against okf-mcp: RFC 8414 metadata, RFC 7591 dynamic
// registration, an authorization endpoint that approves at once for the
// signed-in user set with `signIn({ username, sub, rights })` (granting the
// requested scopes narrowed to the user's rights, as an authorization server
// with group-based rights does), a token endpoint with PKCE S256, and RFC 7662
// introspection for okf-mcp with HTTP Basic client credentials.

const crypto = require("node:crypto");
const http = require("node:http");

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function basic(clientId, clientSecret) {
  const encode = (value) => new URLSearchParams([["", value]]).toString().slice(1);
  return `Basic ${Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`).toString("base64")}`;
}

async function startFakeAuthorizationServer(options) {
  const config = options || {};
  const introspector = basic(config.clientId, config.clientSecret);
  const codes = new Map();
  const tokens = new Map();
  const requested = [];
  let user = null;
  let issuer = "";
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, issuer);
    const send = (status, value, headers) => {
      response.writeHead(status, Object.assign({ "content-type": "application/json" }, headers));
      response.end(value === undefined ? "" : JSON.stringify(value));
    };
    const body = request.method === "POST" ? await readBody(request) : "";
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        introspection_endpoint: `${issuer}/introspect`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register" && request.method === "POST") {
      const metadata = JSON.parse(body || "{}");
      return send(
        201,
        Object.assign({}, metadata, {
          client_id: `client-${crypto.randomBytes(4).toString("hex")}`,
          token_endpoint_auth_method: "none",
        }),
      );
    }
    if (url.pathname === "/authorize") {
      const scope = (url.searchParams.get("scope") || "").split(" ").filter(Boolean);
      requested.push(scope.join(" "));
      const granted = scope.filter((entry) => user.rights.includes(entry));
      const code = crypto.randomBytes(12).toString("hex");
      codes.set(code, {
        scope: granted.join(" "),
        resource: url.searchParams.get("resource"),
        challenge: url.searchParams.get("code_challenge"),
        user,
      });
      const target = new URL(url.searchParams.get("redirect_uri"));
      target.searchParams.set("code", code);
      if (url.searchParams.get("state"))
        target.searchParams.set("state", url.searchParams.get("state"));
      return send(302, undefined, { location: target.href });
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const form = new URLSearchParams(body);
      const grant = codes.get(form.get("code"));
      codes.delete(form.get("code"));
      const verifier = form.get("code_verifier") || "";
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      if (!grant || challenge !== grant.challenge) return send(400, { error: "invalid_grant" });
      const token = crypto.randomBytes(16).toString("hex");
      tokens.set(token, Object.assign({}, grant, { exp: Math.floor(Date.now() / 1000) + 3600 }));
      return send(200, {
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        scope: grant.scope,
      });
    }
    if (url.pathname === "/introspect" && request.method === "POST") {
      if (request.headers.authorization !== introspector)
        return send(401, { error: "invalid_client" });
      const grant = tokens.get(new URLSearchParams(body).get("token"));
      if (!grant) return send(200, { active: false });
      return send(200, {
        active: true,
        sub: grant.user.sub,
        username: grant.user.username,
        scope: grant.scope,
        aud: grant.resource,
        exp: grant.exp,
        client_id: "okf-client",
      });
    }
    return send(404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;
  return {
    issuer,
    introspectionUrl: `${issuer}/introspect`,
    requested,
    signIn(next) {
      user = next;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { startFakeAuthorizationServer };
