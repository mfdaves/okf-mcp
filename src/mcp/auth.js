"use strict";

// Bearer authentication for MCP over HTTP (plan I-2a). okf-mcp is a resource
// server only: it checks opaque tokens and never issues them.
//
// - `tokens:<file>`: a YAML list of { sha256, subject, actor, scopes } where
//   sha256 is the hex SHA-256 of a bearer token; tokens themselves are never
//   stored.
// - `introspect:<url>`: RFC 7662 introspection against an external
//   authorization server, with HTTP Basic client credentials taken from
//   OKF_INTROSPECTION_CLIENT_ID / OKF_INTROSPECTION_CLIENT_SECRET only. A
//   token is accepted when `active` is true, `aud` equals the public MCP URL,
//   `exp` is in the future and `scope` holds okf.read; the actor is
//   human:<username>. Answers are cached by token hash until the earlier of
//   `exp` and 60 s, so a revoked token can live that long here.
//
// Token values never reach an error, a log line, a response or the MCP
// request context: only their hash is kept.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  verifyBearerToken,
} = require("@modelcontextprotocol/server");

const { authorValue } = require("../authoring/candidates");
const { validActor } = require("../v02");
const { KNOWN_SCOPES, READ_SCOPE } = require("./principal");

const RESERVED_SCOPES = ["odoo.read"];
const CACHE_TTL_MS = 60 * 1000;
const CACHE_LIMIT = 10000;
const INTROSPECTION_TIMEOUT_MS = 5000;
const MAX_TOKEN_FILE_BYTES = 1024 * 1024;

class IntrospectionUnavailableError extends Error {}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function invalidToken() {
  return new OAuthError(OAuthErrorCode.InvalidToken, "The access token is not valid.");
}

// AuthInfo for verifyBearerToken: scopes and expiry are checked there; the
// principal rides in `extra`, and `token` stays empty.
function authInfoFor(principal, expiresAt, clientId) {
  return {
    token: "",
    clientId: clientId || principal.subject,
    scopes: [...principal.scopes],
    expiresAt,
    extra: { principal },
  };
}

function readTokenFile(file) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_TOKEN_FILE_BYTES) {
    throw new Error("The token file must be a regular file of at most 1 MiB.");
  }
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    return fs.readFileSync(descriptor, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

// The token file as a Map from token hash to principal. Errors name the
// entry and field, never a value.
function loadTokenFile(file) {
  let document;
  try {
    document = yaml.load(readTokenFile(file));
  } catch (error) {
    throw new Error(`Invalid token file: ${error.code === "ENOENT" ? "not found" : error.message}`);
  }
  const entries = document?.tokens;
  if (!Array.isArray(entries) || Object.keys(document).length !== 1) {
    throw new Error("Invalid token file: expected one `tokens` list.");
  }
  const principals = new Map();
  entries.forEach((entry, index) => {
    const fail = (field, message) => {
      throw new Error(`Invalid token file: tokens[${index}]${field} ${message}`);
    };
    const keys = entry && typeof entry === "object" ? Object.keys(entry) : [];
    const unknown = keys.find((key) => !["sha256", "subject", "actor", "scopes"].includes(key));
    if (!keys.length || unknown) fail(unknown ? `.${unknown}` : "", "is not a known field.");
    if (!/^[0-9a-f]{64}$/i.test(String(entry.sha256 || ""))) {
      fail(".sha256", "must be 64 hex characters.");
    }
    if (typeof entry.subject !== "string" || !entry.subject.trim()) {
      fail(".subject", "must be a non-empty string.");
    }
    if (!validActor(entry.actor))
      fail(".actor", "must be human:<id>, process:<id> or provider/model.");
    const scopes = Array.isArray(entry.scopes) ? entry.scopes : [];
    if (
      !scopes.length ||
      scopes.some((scope) => !KNOWN_SCOPES.concat(RESERVED_SCOPES).includes(scope))
    ) {
      fail(".scopes", `must list scopes among ${KNOWN_SCOPES.concat(RESERVED_SCOPES).join(", ")}.`);
    }
    const hash = entry.sha256.toLowerCase();
    if (principals.has(hash)) fail(".sha256", "repeats an earlier entry.");
    principals.set(hash, {
      subject: entry.subject,
      actor: entry.actor,
      scopes: new Set(scopes.filter((scope) => KNOWN_SCOPES.includes(scope))),
    });
  });
  return principals;
}

function tokenFileVerifier(file) {
  const principals = loadTokenFile(file);
  return {
    async verifyAccessToken(token) {
      const principal = principals.get(tokenHash(token));
      if (!principal) throw invalidToken();
      // Listed tokens do not expire; the bearer check wants an expiry.
      return authInfoFor(principal, Math.floor(Date.now() / 1000) + 3600);
    },
  };
}

// The principal an introspection answer grants, or null when the token is
// not accepted (shared contract, plan I-2a).
function introspectionPrincipal(answer, audience, nowSeconds) {
  if (answer?.active !== true || answer.aud !== audience) return null;
  if (typeof answer.exp !== "number" || !(answer.exp > nowSeconds)) return null;
  const scopes = typeof answer.scope === "string" ? answer.scope.split(" ") : [];
  const username = typeof answer.username === "string" ? answer.username : "";
  const subject = typeof answer.sub === "number" ? String(answer.sub) : answer.sub;
  if (!username || typeof subject !== "string" || !subject) return null;
  const principal = {
    subject,
    actor: `human:${username.replace(/[\s\p{Cc}]/gu, "-")}`,
    scopes: new Set(KNOWN_SCOPES.filter((scope) => scopes.includes(scope))),
  };
  try {
    const author = authorValue({ name: answer.name, email: answer.email });
    Object.assign(principal, author);
  } catch {
    // Without a usable name and email, commits keep the configured author.
  }
  return { principal, exp: answer.exp, clientId: answer.client_id };
}

// HTTP Basic credentials per RFC 6749 section 2.3.1: id and secret are
// form-urlencoded before they are joined and base64-encoded.
function basicCredentials(clientId, clientSecret) {
  const encode = (value) => new URLSearchParams([["", value]]).toString().slice(1);
  return Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`).toString("base64");
}

function introspectionVerifier(options) {
  const { url, audience, clientId, clientSecret } = options;
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || Date.now;
  const cache = new Map();
  const pending = new Map();

  // A full cache drops expired answers, then the oldest ones.
  function remember(hash, entry) {
    if (cache.size >= CACHE_LIMIT) {
      const time = now();
      for (const [key, value] of cache) if (value.until <= time) cache.delete(key);
      for (const key of cache.keys()) {
        if (cache.size < CACHE_LIMIT) break;
        cache.delete(key);
      }
    }
    cache.set(hash, entry);
  }

  async function introspect(token) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Basic ${basicCredentials(clientId, clientSecret)}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({ token }).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(INTROSPECTION_TIMEOUT_MS),
      });
    } catch {
      throw new IntrospectionUnavailableError("introspection unreachable");
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new IntrospectionUnavailableError("introspection refused");
    }
    try {
      return await response.json();
    } catch {
      throw new IntrospectionUnavailableError("introspection answer unreadable");
    }
  }

  async function lookup(hash, token) {
    const answer = await introspect(token);
    const result = introspectionPrincipal(answer, audience, now() / 1000);
    remember(hash, {
      result,
      until: Math.min(now() + CACHE_TTL_MS, result ? result.exp * 1000 : Number.POSITIVE_INFINITY),
    });
    return result;
  }

  return {
    async verifyAccessToken(token) {
      const hash = tokenHash(token);
      const cached = cache.get(hash);
      let result;
      if (cached && cached.until > now()) {
        result = cached.result;
      } else {
        if (!pending.has(hash)) {
          pending.set(
            hash,
            lookup(hash, token).finally(() => pending.delete(hash)),
          );
        }
        result = await pending.get(hash);
      }
      if (!result) throw invalidToken();
      return authInfoFor(result.principal, result.exp, result.clientId);
    },
  };
}

// The authentication of one HTTP server: { authenticate(request) → a
// principal or a ready Response, routes(request) → the protected-resource
// metadata document or undefined }.
function createHttpAuth(auth, options) {
  const config = options || {};
  const env = config.env || process.env;
  let verifier;
  let resourceMetadataUrl;
  let metadata = null;
  if (auth.mode === "tokens") {
    verifier = tokenFileVerifier(auth.file);
  } else {
    const clientId = env.OKF_INTROSPECTION_CLIENT_ID;
    const clientSecret = env.OKF_INTROSPECTION_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "--auth introspect needs OKF_INTROSPECTION_CLIENT_ID and OKF_INTROSPECTION_CLIENT_SECRET in the environment.",
      );
    }
    const resource = new URL(config.publicUrl);
    metadata = buildOAuthProtectedResourceMetadata({
      oauthMetadata: { issuer: auth.issuer },
      resourceServerUrl: resource,
      scopesSupported: [...KNOWN_SCOPES],
    });
    resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
    verifier = introspectionVerifier({
      url: auth.url,
      audience: resource.href,
      clientId,
      clientSecret,
      fetch: config.fetch,
      now: config.now,
    });
  }
  const bearer = { verifier, requiredScopes: [READ_SCOPE], resourceMetadataUrl };
  const metadataPaths = metadata
    ? new Set([new URL(resourceMetadataUrl).pathname, "/.well-known/oauth-protected-resource"])
    : new Set();

  return {
    async authenticate(request) {
      const [header] = (request.headers.get("authorization") || "").split(",");
      try {
        return (await verifyBearerToken(header || undefined, bearer)).extra.principal;
      } catch (error) {
        if (error instanceof IntrospectionUnavailableError) {
          return Response.json(
            { error: "temporarily_unavailable" },
            { status: 503, headers: { "retry-after": "5" } },
          );
        }
        return bearerAuthChallengeResponse(error, bearer);
      }
    },
    routes(request) {
      if (!metadataPaths.has(new URL(request.url).pathname)) return undefined;
      if (request.method !== "GET" && request.method !== "HEAD") {
        return Response.json(
          { error: "method_not_allowed" },
          { status: 405, headers: { allow: "GET, HEAD" } },
        );
      }
      return Response.json(metadata, { headers: { "access-control-allow-origin": "*" } });
    },
  };
}

module.exports = {
  createHttpAuth,
  /** @internal Exposed for the contract tests. */
  introspectionPrincipal,
  /** @internal */
  loadTokenFile,
  /** @internal */
  tokenHash,
};
