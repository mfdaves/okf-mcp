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
//   human:<username>. Accepted answers are cached by token hash until the
//   earlier of `exp` and 60 s, so a revoked token can live that long here;
//   refused ones for 30 s. At most 8 introspections run at once.
//
// Token values never reach an error, a log line or a response, and the
// caches keep only their hash; the verified token goes on only to tool-pack
// handlers, as ctx.subjectToken (src/tool-packs.js).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  OAuthError,
  OAuthErrorCode,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  verifyBearerToken,
} = require("@modelcontextprotocol/server");

const { authorEmail, authorName } = require("../authoring/candidates");
const { validActor } = require("../v02");
const {
  AUDIENCE_NAME,
  KNOWN_SCOPES,
  MAX_AUDIENCES,
  READ_SCOPE,
  SCOPE_NAME,
  audienceSet,
} = require("./principal");

// A scope a principal may carry: okf.read, okf.write, or any well-formed
// scope outside okf.* (such as odoo.read, which tool-pack tools declare).
function grantableScope(scope) {
  return (
    typeof scope === "string" &&
    SCOPE_NAME.test(scope) &&
    (KNOWN_SCOPES.includes(scope) || !scope.startsWith("okf."))
  );
}
const CACHE_TTL_MS = 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 30 * 1000;
const CACHE_LIMIT = 1000;
const MAX_CONCURRENT_INTROSPECTIONS = 8;
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
    const unknown = keys.find(
      (key) => !["sha256", "subject", "actor", "scopes", "audiences"].includes(key),
    );
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
    if (!scopes.length || !scopes.every(grantableScope)) {
      fail(".scopes", `must list ${KNOWN_SCOPES.join(", ")} or well-formed scopes outside okf.*.`);
    }
    const audiences = entry.audiences === undefined ? [] : entry.audiences;
    if (
      !Array.isArray(audiences) ||
      audiences.length > MAX_AUDIENCES ||
      !audiences.every((name) => typeof name === "string" && AUDIENCE_NAME.test(name))
    ) {
      fail(".audiences", "must list audience names: lowercase letters, digits, - and _.");
    }
    const hash = entry.sha256.toLowerCase();
    if (principals.has(hash)) fail(".sha256", "repeats an earlier entry.");
    principals.set(hash, {
      subject: entry.subject,
      actor: entry.actor,
      scopes: new Set(scopes),
      audiences: new Set(audiences),
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

// `aud` against the public MCP URL, verbatim except for one trailing slash
// on either side.
function sameAudience(aud, audience) {
  const trim = (value) => (value.endsWith("/") ? value.slice(0, -1) : value);
  return typeof aud === "string" && trim(aud) === trim(audience);
}

// The principal an introspection answer grants, or null when the token is
// not accepted (shared contract, plan I-2a). `name` and `email` are each
// optional and cleaned (authorName, authorEmail); one that is absent or
// unusable leaves that git author field to the configured identity.
function introspectionPrincipal(answer, audience, nowSeconds) {
  if (answer?.active !== true || !sameAudience(answer.aud, audience)) return null;
  if (typeof answer.exp !== "number" || !(answer.exp > nowSeconds)) return null;
  const scopes = typeof answer.scope === "string" ? answer.scope.split(" ") : [];
  const actor = humanActor(answer.username);
  const subject = typeof answer.sub === "number" ? String(answer.sub) : answer.sub;
  if (!actor || typeof subject !== "string" || !subject) return null;
  const principal = {
    subject,
    actor,
    scopes: new Set(scopes.filter(grantableScope).slice(0, 64)),
    // The audiences the authorization server places the user in; a missing or
    // malformed claim gives none.
    audiences: audienceSet(answer.audiences),
  };
  const name = authorName(answer.name);
  const email = authorEmail(answer.email);
  if (name) principal.name = name;
  if (email) principal.email = email;
  return { principal, exp: answer.exp, clientId: answer.client_id };
}

// The actor of an introspected user: human:<username> with every character
// outside [A-Za-z0-9._@+-] mapped to "-", so a username can never carry a
// "/" (the provider/model actor form) or anything a policy pattern treats
// specially. Null for an empty username.
function humanActor(username) {
  if (typeof username !== "string" || !username) return null;
  return `human:${username.replace(/[^A-Za-z0-9._@+-]/g, "-")}`;
}

// HTTP Basic credentials per RFC 6749 section 2.3.1: id and secret are
// form-urlencoded before they are joined and base64-encoded.
function basicCredentials(clientId, clientSecret) {
  const encode = (value) => new URLSearchParams([["", value]]).toString().slice(1);
  return Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`).toString("base64");
}

// A bounded least-recently-used map of token hash to { result, until }.
function lruCache(limit, now) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.until <= now()) return undefined;
      entries.set(key, entry);
      return entry;
    },
    set(key, entry) {
      entries.delete(key);
      if (entries.size >= limit) entries.delete(entries.keys().next().value);
      entries.set(key, entry);
    },
  };
}

// Answers are cached by token hash in two bounded LRU caches: accepted ones
// until the earlier of exp and 60 s, refused ones (inactive, wrong audience,
// expired) for 30 s. Concurrent lookups of one token share one upstream
// call, and at most `maxConcurrent` upstream calls run at once; a lookup
// beyond that is answered as unavailable (503) instead of queued.
function introspectionVerifier(options) {
  const { url, audience, clientId, clientSecret } = options;
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || Date.now;
  const limit = options.cacheLimit || CACHE_LIMIT;
  const maxConcurrent = options.maxConcurrent || MAX_CONCURRENT_INTROSPECTIONS;
  const accepted = lruCache(limit, now);
  const refused = lruCache(limit, now);
  const pending = new Map();
  let inFlight = 0;

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
    inFlight += 1;
    try {
      const answer = await introspect(token);
      const result = introspectionPrincipal(answer, audience, now() / 1000);
      if (result) {
        accepted.set(hash, { result, until: Math.min(now() + CACHE_TTL_MS, result.exp * 1000) });
      } else {
        refused.set(hash, { result: null, until: now() + NEGATIVE_CACHE_TTL_MS });
      }
      return result;
    } finally {
      inFlight -= 1;
    }
  }

  return {
    async verifyAccessToken(token) {
      const hash = tokenHash(token);
      const cached = accepted.get(hash) || refused.get(hash);
      let result;
      if (cached) {
        result = cached.result;
      } else {
        if (!pending.has(hash)) {
          if (inFlight >= maxConcurrent) {
            throw new IntrospectionUnavailableError("too many introspections in flight");
          }
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

// The authentication of one HTTP server: { authenticate(request) →
// { principal, subjectToken } or a ready Response, routes(request) → the protected-resource
// metadata document or undefined }.
function createHttpAuth(auth, options) {
  const config = options || {};
  const env = config.env || process.env;
  // The scopes to advertise: okf.read, okf.write and the tool packs' (see
  // advertisedScopes in src/tool-packs.js).
  const scopes = config.scopes || [...KNOWN_SCOPES];
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
      scopesSupported: scopes,
    });
    resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
    verifier = introspectionVerifier({
      url: auth.url,
      audience: resource.href,
      clientId,
      clientSecret,
      fetch: config.fetch,
      now: config.now,
      cacheLimit: config.cacheLimit,
      maxConcurrent: config.maxConcurrent,
    });
  }
  const bearer = { verifier, requiredScopes: [READ_SCOPE], resourceMetadataUrl };
  // The WWW-Authenticate challenge (RFC 6750 section 3). It names every scope
  // the server offers, so a client signing in asks for all of them and the
  // authorization server narrows them to the user's rights; error is set only
  // when a Bearer token was presented (section 3.1), and a token lacking
  // okf.read is told that it needs okf.read.
  const challenge = (status, error, required) => {
    const header = ['Bearer realm="okf-mcp"']
      .concat(error ? [`error="${error}"`] : [])
      .concat([`scope="${required.join(" ")}"`])
      .concat(resourceMetadataUrl ? [`resource_metadata="${resourceMetadataUrl}"`] : [])
      .join(", ");
    return Response.json(
      { error: error || "unauthorized" },
      { status, headers: { "www-authenticate": header } },
    );
  };
  const metadataPaths = metadata
    ? new Set([new URL(resourceMetadataUrl).pathname, "/.well-known/oauth-protected-resource"])
    : new Set();

  return {
    async authenticate(request) {
      const [header] = (request.headers.get("authorization") || "").split(",");
      // No credentials: no Authorization header, or none with a Bearer token.
      if (!/^\s*bearer\s+\S/i.test(header)) return challenge(401, null, scopes);
      try {
        const verified = await verifyBearerToken(header.trim(), bearer);
        // The token itself travels on only as a tool pack's subjectToken.
        return {
          principal: verified.extra.principal,
          subjectToken: header.trim().split(/\s+/)[1],
        };
      } catch (error) {
        if (error instanceof IntrospectionUnavailableError) {
          return Response.json(
            { error: "temporarily_unavailable" },
            { status: 503, headers: { "retry-after": "5" } },
          );
        }
        if (error?.code === OAuthErrorCode.InsufficientScope) {
          return challenge(403, "insufficient_scope", [READ_SCOPE]);
        }
        if (error?.code === OAuthErrorCode.InvalidToken) {
          return challenge(401, "invalid_token", scopes);
        }
        return Response.json({ error: "server_error" }, { status: 500 });
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
      // CORS for browser origins is added by the HTTP handler, as for the
      // MCP endpoint.
      return Response.json(metadata);
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
