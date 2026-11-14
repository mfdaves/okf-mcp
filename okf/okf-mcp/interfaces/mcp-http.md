---
type: OKF Interface
title: MCP HTTP Transport
description: Streamable HTTP serving of the MCP tools with per-request principals, bearer authentication, and index refresh while serving.
tags:
  - mcp
  - http
  - streamable-http
  - authentication
  - interface
  - cors
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/mcp-server
  - type: related_to
    target: okf://okf-mcp/interfaces/mcp-tools
  - type: related_to
    target: okf://okf-mcp/policies/authoring-safety
  - type: configured_by
    target: repo://src/mcp/http.js
  - type: configured_by
    target: repo://src/mcp/auth.js
  - type: configured_by
    target: repo://src/mcp/principal.js
  - type: configured_by
    target: repo://src/cli/http-options.js
  - type: checked_by
    target: repo://test/call-queue.test.js
  - type: checked_by
    target: repo://test/mcp-principal.test.js
  - type: checked_by
    target: repo://test/http-mcp-contract.test.js
  - type: checked_by
    target: repo://test/http-auth.test.js
  - type: checked_by
    target: repo://test/http-refresh.test.js
  - type: checked_by
    target: repo://test/http-remote-load.test.js
  - type: configured_by
    target: repo://src/tool-packs.js
  - type: checked_by
    target: repo://test/http-cors.test.js
  - type: checked_by
    target: repo://test/http-proposals.test.js
  - type: checked_by
    target: repo://test/tool-packs.test.js
generated:
  by: anthropic/claude-code
  at: 2026-11-14T18:17:23.039Z
---

# MCP HTTP Transport

`okf mcp --http` serves the [MCP server](../runtime/mcp-server.md)'s resources, tools and schemas over Streamable HTTP instead of stdio. A small `node:http` bridge hands each request to the SDK's `createMcpHandler` as a web `Request`; the handler serves the `2026-07-28` revision and, through its stateless fallback, 2025-era clients including the `2025-11-25` `initialize` handshake. No session is kept, so `GET` and `DELETE` on the endpoint answer `405` to 2025-era clients.

The server binds `--host` (default `127.0.0.1`) and `--port` (default `8766`). `--public-url` names the URL clients use: its path is the endpoint path (default `/mcp`, answered with and without one trailing slash), its host is an accepted `Host`, and with introspection it is the token audience. Every request must carry an accepted `Host` (the localhost names, the public host, and `--allowed-host` values); requests to the endpoint must also come from an accepted browser `Origin` when they carry one (`--allowed-origin`), and are refused above 1 MiB with `413`. For an accepted browser origin the endpoint answers CORS: an `OPTIONS` preflight gets `204` before any authentication, and every answer, refusals included, echoes the exact origin (`Vary: Origin`) and exposes `WWW-Authenticate` and `Mcp-Session-Id`; a foreign origin gets `403` without CORS headers. `GET /health` answers `{"status":"ok"}`, also beside a deeper endpoint path (`/okf/mcp` gives `/okf/health`).

Each request builds an MCP server over the one shared catalog state for the request's principal, so tool calls from every client go through the state's single call queue. A principal carries a subject, an actor, scopes and optionally a name and an email. `okf.read` is required for any call; `okf.write` adds the live batch tools (with `--write`), producer runs, the stored-proposal reads `okf_list_proposals` and `okf_get_proposal` (whose candidate Markdown the REST API guards with its write token) and runtime remote loading (with `--allow-remote-tool`), which a principal without it neither sees nor can call; `list_bundles` shows absolute server paths only to it. Scopes outside `okf.*`, such as `odoo.read`, gate tool-pack tools. Writes stamp the principal's actor and are judged by the write policy for it; with `--git-commit` its name and email become the commit author, a missing one falling back to the configured identity, which stays the committer.

Without `--auth` every caller is anonymous and read-only, which is allowed only on a loopback address; `--write` then is a usage error, and `--authoring` is not available over HTTP. `--auth tokens:<file>` reads a YAML list of `{ sha256, subject, actor, scopes }`, so tokens are kept only as SHA-256 hashes. `--auth introspect:<url>` with `--authorization-server <issuer>` checks opaque bearer tokens by RFC 7662 introspection: it posts `token=<access token>` with HTTP Basic client credentials taken only from `OKF_INTROSPECTION_CLIENT_ID` and `OKF_INTROSPECTION_CLIENT_SECRET`, and accepts a token when `active` is true, `aud` equals the public URL (one trailing slash ignored on either side), `exp` is in the future and `scope` holds `okf.read`. The actor is `human:<username>` with every character outside `[A-Za-z0-9._@+-]` mapped to `-`, so it can never take the `provider/model` form. Accepted answers are cached by token hash until the earlier of `exp` and 60 seconds and refused ones for 30 seconds, in bounded LRU caches; at most 8 introspections run at once, and a request that would need a ninth gets `503`.

A refused or missing token gets `401` with a `WWW-Authenticate` challenge naming the RFC 9728 protected-resource metadata, which the server publishes with the configured issuer; a token without `okf.read` gets `403`; an authorization server that cannot answer gives `503` without detail. okf-mcp is only a resource server and never issues tokens. Token values never appear in responses, errors or logs, and the caches keep only their hash; the verified token is handed on only to tool-pack handlers, as `ctx.subjectToken`, so a pack can act for the caller on a data API of the authorization server.

Before a tool call or resource read (never `initialize`, `ping` or `tools/list`), at most once per `--refresh-interval` (default 2,000 ms), the server refreshes its index from disk inside the call queue, in the calls' order, so files changed outside okf-mcp are served without a restart. Behind a reverse proxy, okf-mcp binds a loopback address, the proxy terminates TLS, forwards the endpoint path, the health path and the metadata path unchanged with the `Authorization` header, sends an accepted `Host`, and does not buffer the Server-Sent Events responses. The [tool catalog](mcp-tools.md) and the [authoring safety policy](../policies/authoring-safety.md) apply unchanged.
