# okf-mcp

`okf-mcp` publishes [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) from the systems that already hold the knowledge, and serves the result to agents. It is a local-first consumer, validator, graph index, CLI, and MCP server.

The part that is hard is writing to a catalog safely. A configured producer reads an external source and returns a candidate bundle; okf-mcp validates it, then publishes it under an ownership manifest that records exactly which files it owns. Hand-authored content is never adopted, a source that did not change rewrites nothing, and no producer output escapes its bundle. [`@mfdaves/okf-postgres`](https://github.com/mfdaves/okf-postgres) reads PostgreSQL catalogs this way without reading a single table row.

Reading is the ordinary half. It consumes an OKF bundle directory of Markdown files with YAML frontmatter. An optional workspace mode can federate several bundles. Concepts are exposed through CLI commands and MCP resources and tools for validation, structured search, graph navigation, provenance inspection, and proposal-based authoring.

The core intentionally has no database, embeddings, build step, or hosted-service dependency. It uses `js-yaml` for safe YAML, CommonMark for Markdown structure, MiniSearch for in-memory BM25+ text retrieval, and the official Model Context Protocol TypeScript SDK v2 for MCP over stdio and Streamable HTTP. Local root mode makes no network calls. Optional remote loading fetches public Markdown concepts and only their explicitly referenced inert assets from GitHub. Nothing in the v0.2 computation support executes code or attests a receipt.

## OKF v0.2 Support And Extensions

OKF v0.2 intentionally specifies a portable file format, not a serving or query runtime. `okf-mcp` keeps that boundary explicit:

| Area | Official OKF v0.2 | okf-mcp behavior |
| --- | --- | --- |
| Bundle and identity | A directory tree of Markdown files; a Concept ID is its bundle-relative path without `.md` | `--root` maps directly to one bundle; `okf://` is an optional workspace locator, not the portable Concept ID |
| Concept metadata | Required `type`; recommended `title`, `description`, `resource`, and `tags`; unknown keys are allowed | Preserves extension fields and unknown types while reporting normative conformance separately from workspace policy |
| Provenance and lifecycle | `sources`, `usage_window`, `generated`, `verified`, `status`, and `stale_after` | Normalizes these fields for search, provenance traversal, trust tiers, and deterministic freshness checks |
| References | Markdown links and path-valued `resource`, `sources[].resource`, `computation`, `executor.resource`, and `attester.resource` fields | Builds graph edges and bounded inert asset snapshots without executing or implicitly fetching referenced code |
| Attested Computation | Defines contract fields and an informative consumer flow while deferring runtime wire protocols and attester packaging | Statically inspects contracts and digests, checks declared parameter and receipt field names, and never executes or claims attestation |
| v0.1 compatibility | Allows `timestamp` fallback when the whole `generated` mapping is absent and `# Citations` fallback when the `sources` key is absent | Consumes both forms and adds review-only migration checks and proposals |

The following are okf-mcp extensions rather than requirements of the format:

- CLI, MCP, and HTTP interfaces; in-memory search and graph views
- optional multi-bundle `okf.project.yaml` workspaces and typed `relations`
- compatibility `id`, `aliases`, and `okf://` locators
- proposal-backed authoring with explicit acceptance
- bounded GitHub remote loading and explicitly mapped pinned Git sources
- generator plugins and stricter opt-in project policies such as `strictLinks`

## Install And Run

Node 22 or newer is required.

Install from the GitHub release:

```bash
git clone --branch v0.12.0-rc.1 https://github.com/mfdaves/okf-mcp.git
cd okf-mcp
npm ci
node bin/okf-mcp.js --root ./path/to/okf validate
```

Pin the published version for reproducible use:

```bash
npx -y @mfdaves/okf-mcp@0.12.0-rc.1 --version
npx -y @mfdaves/okf-mcp@0.12.0-rc.1 --root ./path/to/okf validate
```

For a persistent installation:

```bash
npm install --global @mfdaves/okf-mcp@0.12.0-rc.1

okf --version
okf --root ./path/to/okf validate
okf-mcp --root ./path/to/okf mcp
```

To work from the current source branch:

```bash
git clone https://github.com/mfdaves/okf-mcp.git
cd okf-mcp
npm ci
npm test
node bin/okf-mcp.js --version
```

`--root` accepts one local OKF bundle directory and is the recommended okf-mcp interface for a single bundle. The portable identity of each concept is its extensionless path inside that root.

`--bundle` accepts either a path or `id=path`. Multiple flags remain supported for compatibility. `--project` and its `bundles:` list are an optional okf-mcp federation/authoring extension, not part of OKF v0.2.

`--remote-bundle` accepts `id=https://github.com/<owner>/<repo>/tree/<ref>/<path>`. It fetches public Markdown first, then only bundle-local files explicitly named by standard v0.2 resource fields. Remote content remains read-only and inert.

`--inspect` prints a compact graph summary and exits. Without `--inspect` and without an explicit command, the process starts a stdio MCP server.

The package exposes both `okf` and `okf-mcp` binaries when installed. Without an explicit source, the CLI first discovers the nearest root `index.md` declaring `okf_version`; nearest-project discovery remains a compatibility fallback.

CLI exit statuses are `0` for success, `1` for validation or operational failure, and `2` for invalid usage. Unknown options are rejected.

## Included OKF Reference

This repository publishes a self-describing OKF bundle for the product, its runtime boundaries, interfaces, authoring workflows, and safety policy. Its portable entry Concept ID is `overview/okf-mcp`; `okf://okf-mcp/overview/okf-mcp` remains the workspace/MCP resource locator.

Validate and query the bundled reference from a checkout or installed package:

```bash
okf --root okf/okf-mcp validate
okf --root okf/okf-mcp search "proposal"
okf --root okf/okf-mcp concept overview/okf-mcp
```

Load the reference bundle directly from the current source branch:

```bash
okf --remote-bundle okf-mcp=https://github.com/mfdaves/okf-mcp/tree/main/okf/okf-mcp --inspect
```

The published `v0.8.0` tag retains its original
`okf/bundles/okf-mcp` path. The shorter `okf/okf-mcp` path was prepared in the
unpublished `0.8.1` maintenance checkpoint and ships with `v0.9.0`; the
immutable `v0.8.0` release remains unchanged.

The `@mfdaves/okf-mcp` npm package includes both `okf.project.yaml` and the
complete reference bundle.

## Optional Multi-Bundle Project Config

Use `okf.project.yaml` only when one process must federate multiple roots, configure generators or external metadata producers, or enforce a project-wide relation vocabulary:

```yaml
project: Example
strictLinks: false
bundles:
  - id: app
    root: okf/bundles/app
    include: ["**/*.md"]
    exclude: ["archive/**"]
  - id: data
    root: okf/bundles/data
  - id: company-database
    root: okf/company-database
relationTypes:
  - deployed_by
remoteBundles:
  - id: shared
    url: https://github.com/example/okf-atlas/tree/main/bundles/shared
    include: ["public/**"]
    exclude: ["drafts/**"]
plugins:
  - name: docs
    type: filesystem
    root: docs
    output: okf/bundles/app/generated/docs
    bundle: app
producers:
  - name: main-database
    type: postgresql
    package: "@mfdaves/okf-postgres"
    bundle: company-database
    config:
      connectionEnv: DATABASE_URL
      source: company-db
      schemas: [public]
      includeIndexes: true
```

Run project commands:

```bash
okf --project okf.project.yaml validate
okf --project okf.project.yaml search "orders"
okf --project okf.project.yaml graph mermaid
okf --project okf.project.yaml generate
okf --project okf.project.yaml producer list
okf --project okf.project.yaml producer preview main-database
okf --project okf.project.yaml producer run main-database --write --actor process:nightly-refresh
okf --project okf.project.yaml mcp
okf --project okf.project.yaml mcp --authoring
okf --project okf.project.yaml mcp --allow-remote-tool
OKF_WRITE_TOKEN=change-me okf --project okf.project.yaml serve
okf --remote-bundle shared=https://github.com/example/okf-atlas/tree/main/bundles/shared --inspect
```

Commands:

- `mcp`
- `validate`
- `graph [json|dot|mermaid]`
- `search <query>`
- `concept <concept-id-or-locator>`
- `neighbors <concept-id-or-locator>`
- `paths <from> <to>`
- `provenance <uri>`
- `edge-kinds`
- `computation inspect|prepare|check-receipt`
- `asset <okf-asset-uri>`
- `source <concept-id-or-locator> <source-id>`
- `migrate check|preview`
- `generate`
- `producer list|preview|run`
- `serve`

### External metadata producers

Producers are separate from the built-in `plugins:` generators. A producer reads metadata from an external source and returns an in-memory candidate OKF bundle; `okf-mcp` validates and publishes that candidate. Install each producer package alongside the project, then allowlist its exact bare package name in the trusted project configuration. MCP callers can select a configured producer but cannot replace its package, configuration, credentials, queries, bundle, or output paths.

The package must be installed under a `node_modules` directory belonging to the project, resolved by its exact bare name. Ordinary registry installs, npm workspaces, `npm link`, and store-backed layouts such as pnpm all satisfy this; a path in configuration never does.

The package must export the versioned `okfProducer` API. Producer API v1 targets OKF v0.2 and separates `validateConfig()` from side-effect-free destination generation. Candidate concepts require native `generated` and non-empty `sources` provenance. The host rejects unsafe paths, malformed concepts, unresolved links or typed relations, unowned file collisions, locally modified managed files, secret values in output, and any candidate that would leave the complete project invalid.

Both interfaces run the same host. Use the CLI for scheduled refreshes:

```bash
okf --project okf.project.yaml producer preview main-database
okf --project okf.project.yaml producer run main-database --write --actor process:nightly-refresh
```

`producer preview` exits `1` when the candidate is invalid; `producer run` exits `1` when nothing was published. Both print the same receipt the MCP tools return. A producer that cannot generate may throw an error with its own `code` (lowercase, `^[a-z][a-z0-9_]{0,63}$`, for example `access_denied`) and a `details` object of scalar values; the receipt then carries one producer-layer diagnostic with that code and the bounded details (identifier keys, finite numbers, booleans, null, single-line strings up to 200 characters that hold no secret the producer read). The error's message is never reported. An error without such a code is reported as `producer_execution_failed`.

For a configured project, MCP exposes:

- `okf_list_producers`: list configuration without loading package code or reading the source
- `okf_preview_producer`: read source metadata and return a validated, non-writing diff
- `okf_run_producer`: regenerate under the shared writer queue and publish with revision checks and rollback; available only with `--write` plus a truthful `--actor` using `human:<id>`, `process:<id>`, or `provider/model` syntax

Preview and run accept only the configured producer name plus optional receipt detail. Receipts include bounded numeric source-object summaries and publication-diff counts. Publication records owned relative paths and SHA-256 digests in the bundle-local `.okf-producer.json`. Only unchanged paths owned by the prior manifest can be updated or removed; hand-authored content is never adopted implicitly. The manifest contains no producer configuration, credentials, or connection details.

Two rules keep a managed bundle stable across repeated runs:

- A producer restamps `generated.at` on every run. The host compares each candidate against the published file ignoring that stamp, so a source that did not change reports `unchanged` and leaves the bytes, the timestamps, and the manifest untouched. Publication-diff counts therefore describe the source, not the run.
- A manifest entry alone is not authority to destroy work. Any file the host would rewrite or remove must itself carry `generated` provenance, so a damaged, hand-merged, or forged manifest cannot make a producer delete hand-authored content.

Directories emptied by a stale deletion are removed with their last managed file.

`@mfdaves/okf-postgres` is the PostgreSQL implementation. Its average-use v1 covers database, schema, table/view, column, key, check, enum, index, and description metadata without reading table rows. Keep connection strings in an environment variable named by `connectionEnv`; do not place a connection string in YAML.

`serve` options:

- `--host <host>`: bind host, default `127.0.0.1`
- `--port <port>`: bind port, default `8765`
- `--write-token <token>`: bearer token for write endpoints; defaults to `OKF_WRITE_TOKEN`
- `--proposal-root <path>`: proposal JSON directory; defaults to `.okf-proposals` under the selected local root or project

Proposals are stored state, not a derived cache, so the proposal directory is never cleaned up automatically. A server started with `--git-commit` refuses to publish while the worktree has untracked files, so that directory must be ignored by Git: add `.okf-proposals/` to `.gitignore` (as this repository does), or pass `--proposal-root` with a directory Git already ignores. In project mode the proposal root must stay inside the project root.

## MCP Client Config

The npm-based examples below use the current published release. A source checkout can invoke its executable `bin/okf-mcp.js` with the same arguments.

Example client configuration:

```json
{
  "mcpServers": {
    "okf": {
      "command": "npx",
      "args": [
        "-y",
        "@mfdaves/okf-mcp@0.12.0-rc.1",
        "--root",
        "/absolute/path/to/okf",
        "mcp"
      ]
    }
  }
}
```

Project config mode, with read-only project helpers but without proposal mutations:

```json
{
  "mcpServers": {
    "okf": {
      "command": "npx",
      "args": [
        "-y",
        "@mfdaves/okf-mcp@0.12.0-rc.1",
        "--project",
        "/absolute/path/to/repo/okf.project.yaml",
        "mcp"
      ]
    }
  }
}
```

Add `--authoring` to enable proposal creation, acceptance, and rejection. For a smaller direct-write surface, add `--write --actor <actor>` to expose read-only `okf_validate_changes` and validated-batch `okf_apply_changes`; add `--git-commit` to commit each successful batch when the catalog is in a clean Git worktree. Add `--allow-remote-tool` to let MCP clients load arbitrary supported public remote bundles at runtime. Configured remote bundles remain readable without that runtime-loading flag.

The stdio server uses `@modelcontextprotocol/server` v2. It serves the modern
`2026-07-28` MCP revision and the SDK's compatibility path for 2025-era
clients, including `2025-11-25`. The SDK owns protocol negotiation, framing,
resource dispatch, tool dispatch, and advertised-schema validation.

Expected failures from a known tool, such as a missing concept, a read-only
bundle, a failed remote fetch, invalid arguments, or a proposal conflict, are
returned as MCP tool results with `isError: true`. Calls to tools that are not
enabled are rejected by SDK dispatch. Unexpected implementation errors are
masked instead of exposing internal details.

## MCP over HTTP

From 0.13.0-rc.1 the `mcp` command can serve the same tools, resources and
schemas over Streamable HTTP instead of stdio:

```bash
okf --root /path/to/okf mcp --http
# OKF MCP HTTP server listening on http://127.0.0.1:8766/mcp
```

| Flag | Meaning |
| --- | --- |
| `--http` | Serve MCP over Streamable HTTP. |
| `--host <host>` | Address to bind (default `127.0.0.1`). A non-loopback address requires `--auth`. |
| `--port <port>` | Port (default `8766`; `0` picks a free one). |
| `--public-url <url>` | The URL clients use for the MCP endpoint. Its path is the endpoint path (default `/mcp`; served with and without one trailing slash), its host is accepted in `Host` headers, and with introspection it is the token audience and the advertised `resource`, as written. |
| `--allowed-host <host>` | Another accepted `Host` header (hostname; the port is ignored); repeatable. `localhost`, `127.0.0.1` and `[::1]` are always accepted. |
| `--allowed-origin <origin>` | Another accepted browser `Origin` (hostname or origin URL); repeatable. Requests without an `Origin` header are not affected. |
| `--auth tokens:<file>`, `--auth introspect:<url>` | Bearer authentication, see below. |
| `--authorization-server <issuer>` | With introspection, the issuer named in the protected-resource metadata. |
| `--refresh-interval <ms>` | Check the files for changes made outside okf-mcp before a tool call or resource read at most this often (default `2000`; `0` checks before every one). |

The server answers:

- the MCP endpoint, through the SDK's `createMcpHandler`: protocol revision
  `2026-07-28`, and 2025-era clients (including the `2025-11-25` `initialize`
  handshake) through its stateless fallback. No session is kept: `GET` and
  `DELETE` on the endpoint answer `405` to 2025-era clients.
- `GET /health` with `{"status":"ok"}`, also beside the endpoint when its
  path is deeper (`/okf/mcp` → `/okf/health`).
- with introspection, the RFC 9728 protected-resource metadata at
  `/.well-known/oauth-protected-resource` plus the path of `--public-url`
  (for example `/.well-known/oauth-protected-resource/mcp`) and at
  `/.well-known/oauth-protected-resource`.

Every request is checked against the accepted `Host` names (`403`
otherwise); requests to the MCP endpoint are also checked against the accepted
origins (`403`, without CORS headers) and refused above 1 MiB (`413`). For an
accepted browser origin the endpoint answers CORS: an `OPTIONS` preflight gets
`204` without authentication, with `Access-Control-Allow-Origin` (the exact
origin, `Vary: Origin`), `Access-Control-Allow-Methods: GET, POST, DELETE,
OPTIONS` and `Access-Control-Allow-Headers: Authorization, Content-Type,
Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID`; every other answer,
`401` and `403` included, carries the same `Access-Control-Allow-Origin` and
`Access-Control-Expose-Headers: WWW-Authenticate, Mcp-Session-Id`. Each request builds its MCP
server over the one shared catalog state, and tool calls from all clients run
one at a time through one queue.

### Principals and scopes

Every HTTP request runs for a principal: a subject, an actor, scopes, and
optionally a name and an email. `okf.read` is required for any call.
`okf.write` adds the live write tools (`okf_validate_changes`,
`okf_apply_changes`, when the server runs with `--write`), producer runs
(`okf_run_producer`), the stored proposals (`okf_list_proposals`,
`okf_get_proposal`, which can hold complete candidate Markdown) and, with
`--allow-remote-tool`, `load_remote_bundle`, which changes the index every
principal reads. Over stdio those flags alone enable them, as before. A principal without `okf.write` does not see those
tools in `tools/list`, and calling one fails as calling a disabled tool does.

Writes made for a principal stamp its actor in `generated.by` and are judged
by the write policy for that actor. With `--git-commit`, the principal's name
and email become the commit author; a missing one falls back to the
repository's configured Git identity, which also stays the committer. Author
data never fails or blocks a write: `<`, `>`, control characters and
surrounding whitespace are removed, a name made only of characters git
refuses (such as `'` or `"`) and an email that is not a plausible address are
dropped, and the dropped field falls back to the configured identity.
Producer runs keep
`process:<producer>`. `--write` still requires `--actor`, which names the
server process as over stdio; every authenticated HTTP principal writes as
its own actor.

Without `--auth`, every caller is an anonymous read-only principal. That mode
is allowed only on a loopback address, and `--write` is a usage error there.
`--authoring` is not available with `--http` in this release: which scope may
create and accept proposals over HTTP is not decided yet. Over stdio the
principal comes from the flags (`--actor`, and `okf.write` only with
`--write`), so stdio behaves as before.

### Token file

`--auth tokens:<file>` reads a YAML list of tokens by their SHA-256 hash;
plaintext tokens are never stored:

```yaml
tokens:
  - sha256: 3f0c…            # hex SHA-256 of the bearer token
    subject: ci
    actor: process:ci-nightly
    scopes: [okf.read, okf.write]
```

`printf %s "$TOKEN" | sha256sum` prints the hash. The file must be a regular
file of at most 1 MiB; unknown fields, unknown scopes, invalid actors and
repeated hashes are startup errors that name the entry and field, never a
value. Listed tokens do not expire; remove an entry and restart the server to
revoke it.

### Token introspection

`--auth introspect:<url>` checks opaque bearer tokens against an external
OAuth 2.0 authorization server with RFC 7662 introspection. okf-mcp is only a
resource server: it never issues tokens, and clients obtain them from the
authorization server named in the protected-resource metadata.

```bash
OKF_INTROSPECTION_CLIENT_ID=okf-mcp OKF_INTROSPECTION_CLIENT_SECRET=… \
okf --root /srv/okf --write --actor process:okf-mcp --git-commit mcp --http \
  --public-url https://mcp.example.com/mcp \
  --auth introspect:https://auth.example.com/oauth/introspect \
  --authorization-server https://auth.example.com
```

- okf-mcp posts `token=<access token>` as a form to the URL, with HTTP Basic
  client credentials (form-urlencoded before base64, RFC 6749 section 2.3.1)
  read from `OKF_INTROSPECTION_CLIENT_ID` and
  `OKF_INTROSPECTION_CLIENT_SECRET` only. The URL must be `https`, or `http`
  on a loopback host, without credentials, query or fragment; redirects are
  not followed.
- A token is accepted when `active` is `true`, `aud` equals `--public-url`
  (one trailing slash ignored on either side), `exp` is in the future and
  `scope` holds `okf.read`. The principal's subject
  is `sub`, its actor `human:<username>` (every character outside
  `A-Z`, `a-z`, `0-9` and `._@+-` replaced by `-`, so a username can never
  take the `provider/model` form), its scopes the `okf.read` and `okf.write` entries of
  `scope` (others are ignored), and its git author `name` and `email`, each
  optional.
- A missing or refused token gets `401` with a `WWW-Authenticate: Bearer`
  challenge carrying `resource_metadata`; a token without `okf.read` gets
  `403 insufficient_scope`. When the authorization server cannot be reached,
  times out (5 s) or answers anything but `200` with JSON, the request gets
  `503` with `{"error":"temporarily_unavailable"}` and no further detail.
- Answers are cached by the token's SHA-256 in two bounded caches: accepted
  ones until the earlier of `exp` and 60 seconds (a revoked token keeps
  working for up to a minute), refused ones for 30 seconds. At most 8
  introspection requests run at once; a request that would need a ninth gets
  `503` with `{"error":"temporarily_unavailable"}`.

Token values never appear in a response, an error, a log line or the MCP
request context; only their hash is kept.

### Index freshness

Over HTTP the server re-reads files changed outside okf-mcp (for example by
`git pull` or an editor) before a tool call or a resource read, at most once
per `--refresh-interval`; `initialize`, `ping` and `tools/list` never trigger
it. The check runs in the call queue, in the same order as the calls. Changes are detected by file size and modification time,
as for writes. An unchanged check costs about 35 ms at 5,000 concepts.

### Behind a reverse proxy

- Bind okf-mcp to a loopback address and let the proxy terminate TLS.
- Set `--public-url` to the external URL of the endpoint and forward that
  path unchanged; forward the health path and
  `/.well-known/oauth-protected-resource…` as well.
- Forward the `Host` header as the public host (accepted automatically), or
  accept the host the proxy sends with `--allowed-host`.
- Forward the `Authorization` header unchanged.
- Responses can be Server-Sent Events streams: turn response buffering off
  for the endpoint and allow long-lived responses.
- One process serves one root or one project; run one process per catalog.

## MCP Registry Metadata

`server.json` describes the npm package `io.github.mfdaves/okf-mcp` twice:
as a stdio server, and as a Streamable HTTP server at
`http://127.0.0.1:8766/mcp` started with the extra `--http` argument.
Registry-aware clients should prompt for an absolute OKF root path, pass it
through `--root`, and append the fixed `mcp` command.

## Concept Identity And Extensions

Concept IDs are their bundle-relative Markdown paths with `.md` removed. This extensionless path is the portable OKF identity. okf-mcp also exposes a workspace-scoped compatibility locator:

```text
okf://<bundle-id>/<extensionless-concept-id>
```

The former `.md` URI and a valid custom `id` remain compatibility lookup aliases. A bare Concept ID resolves only when unique across loaded bundles. For standalone aggregate catalogs, a URI-shaped portable path such as `okf://services/queue.md` also resolves when `services/queue` is globally unique and `services` is not a loaded bundle id. Exact canonical URIs always win; a known-bundle miss or ambiguous portable path stays unresolved. Reserved `index.md` and `log.md` resources retain their filenames because they are not concepts.

The `id`, `aliases`, and typed `relations` fields below are `okf-mcp` extensions. The standard v0.2 identity remains path-derived:

```markdown
---
id: okf://app/routes/order-status
type: API Route
title: Order Status Route
description: Serves order status state.
aliases: [order-status]
tags: [api, orders]
relations:
  - type: consumes
    target: okf://data/tables/order_status
  - type: configured_by
    target: repo://src/routes/order-status.js
---

# Order Status Route
```

New content should use normal relative or bundle-root Markdown paths for internal links and extension relation targets. Existing `okf://` targets remain supported; non-OKF schemes such as `repo://` remain opaque compatibility references.

### Pinned Git Sources

Code knowledge may live outside the code repository without recording a machine-specific path. Point a standard `sources` entry at a `Git Repository` concept and add the okf-mcp `git` extension below:

```yaml
sources:
  - id: implementation
    resource: /repositories/application.md
    git:
      revision: 0123456789abcdef0123456789abcdef01234567
      path: src/application.js
      lines: { from: 10, to: 30 }
```

Map the repository concept only in the local process configuration:

```bash
okf --root /path/to/catalog \
  --repo repositories/application=/work/application \
  source architecture/application implementation
```

`read_git_source` and the `source` CLI command read the pinned blob from the mapped Git object database. They never read the dirty worktree or fetch. Missing mappings and unpinned revisions remain visible but unavailable. Repository mappings may point to normal checkouts, bare repositories, or mounted paths; credentials and local paths stay outside the OKF bundle.

## Tools

- `list_bundles`
- `list_concepts`
- `get_concept`
- `search_concepts`
- `list_types`
- `list_tags`
- `list_relation_types`
- `list_edge_kinds`
- `get_provenance`
- `inspect_attested_computation`
- `read_bundle_asset`
- `read_git_source`
- `prepare_attested_computation`
- `check_computation_receipt`
- `check_v02_migration`
- `load_remote_bundle`
- `list_remote_bundles`
- `okf_validate_concept`
- `okf_suggest_concept_path`
- `okf_propose_concept`
- `okf_propose_update`
- `okf_propose_attested_computation`
- `okf_propose_v02_migration`
- `okf_list_proposals`
- `okf_get_proposal`
- `okf_accept_proposal`
- `okf_reject_proposal`
- `okf_validate_changes`
- `okf_apply_changes`
- `okf_list_producers`
- `okf_preview_producer`
- `okf_run_producer`
- `get_graph`
- `get_neighbors`
- `get_subgraph`
- `find_paths`
- `graph_summary`
- `validate_bundle`
- `validate_project`
- `export_graph`

Most MCP tools are read-only over the current index. `load_remote_bundle` mutates only the server's in-memory index by fetching a public GitHub tree; it does not write files. Concept listing and search default to compact summaries; pass `detail: "full"` when navigation metadata, signals, ranking, or snippets are required. Relationship paths are deduplicated by node sequence even when parallel edge kinds connect the same concepts.

Every MCP tool includes a purpose-specific description, descriptions for its input parameters, and standard annotations covering read-only behavior, destructive behavior, idempotency, and external access.

Tool arguments are validated against the advertised input schemas before
execution. Unsupported fields, missing required values, incorrect primitive
types, and out-of-range integers are rejected without coercion. Unknown or
disabled tool names remain protocol-level invalid-parameter errors.

Tool discovery and direct invocation use the same capability checks:

| Mode | Normal proposals | Direct live write | Computation proposal | Runtime remote load |
| --- | --- | --- | --- | --- |
| default | disabled | disabled | disabled | disabled |
| `--authoring` | enabled | disabled | disabled | disabled |
| `--write --actor openai/gpt-5.6` | disabled | enabled | disabled | disabled |
| `--authoring --allow-computation-authoring` | enabled | disabled | enabled | disabled |
| `--allow-remote-tool` | disabled | disabled | disabled | enabled |

An explicit local root or project workspace exposes concept validation, path suggestion, and proposal inspection helpers. Proposal mutation tools require `--authoring`. The direct live tools instead require `--write` plus a truthful actor using `human:<id>`, `process:<id>`, or `provider/model` syntax. In normal single-root mode, callers omit `bundle`; it is required only to select among multiple project roots. Remote roots remain read only.

Generic concept tools cannot create or change an Attested Computation contract. `okf_propose_attested_computation` additionally requires `--allow-computation-authoring` and creates one coordinated review proposal for the concept plus an optional external computation file.

## Live Concept Authoring

Start the server with the direct-write capability only when the MCP client/user approval boundary is sufficient review:

```bash
okf --root /path/to/catalog --write --actor openai/gpt-5.6 mcp
```

The agent sees one read-only batch validator and one destructive apply tool. It supplies structured concept fields rather than YAML; OKF serializes compatible Markdown frontmatter and stamps the configured `generated.by` plus one `generated.at` timestamp for the whole batch.

```json
{
  "name": "okf_apply_changes",
  "arguments": {
    "message": "docs(okf): document order creation",
    "changes": [
      {
        "op": "create",
        "type": "MCP Tool",
        "title": "Create Order",
        "body": "# Create Order\n\nCreates a validated order.",
        "tags": ["orders", "mcp"],
        "sources": ["/repositories/orders-service.md"],
        "relations": [
          { "type": "related_to", "target": "/workflows/order-creation.md" }
        ]
      }
    ]
  }
}
```

Create paths are optional. The server first uses a strong dominant directory convention from existing same-type concepts within the requested prefix, then falls back to deterministic type/title slugs. `okf_suggest_concept_path` reports the strategy, evidence, path availability, and same-type/title matches so an available filename is not mistaken for a safe duplicate. Updates identify an existing `uri`; stale locators return bounded likely replacements, while scalar fields replace existing values and `tags`, `sources`, and `relations` use explicit `add`/`remove` patches. `metadata` carries extension frontmatter but cannot override identity, generation, collection, or computation fields. Paths and URIs are immutable during update: moving a concept changes its portable identity and remains a separate, intentionally unsupported operation.

Every 1–100 item batch is validated as one future graph, so concepts created together can reference one another and same-type/title conflicts are detected across creates and updates. Call `okf_validate_changes` with the complete intended batch to receive a time-of-check preview without writing files. Validation and apply share the same planner; apply repeats every check under the writer queue because revisions and Git state can change after a preview. Compact receipts are the v0.8 default; pass `detail: "full"` for the v0.7 planning layout. Effects expose structured relations and keep server-managed generation provenance separate from substantive `changedFields`.

The server writes nothing unless every candidate is valid, revision checks still match, and every target stays inside one writable bundle. Process-generated documents, generator output directories, hidden/control-plane paths such as `.git/**`, reserved files, and Attested Computation contracts are not live-write targets. Rollback checks revisions immediately before each restore and reports detected replacements as a partial `rollback_conflict`. That protection is best effort under the documented single-external-writer requirement; it is not a cross-process compare-and-swap guarantee.

Add `--git-commit` as server policy to create one commit per successful batch. A detected Git worktree must be completely clean and have a configured identity before publication. Active Git filter attributes and `assume-unchanged`/`skip-worktree` index flags block the operation so validation cannot execute configured filters or overlook hidden user changes; replace-object resolution is disabled so hidden replacement history cannot alter the parent tree. The server builds an isolated index from the validated Markdown bytes, creates that exact tree with `commit-tree`, publishes it with a compare-and-swap ref update, synchronizes only the affected ordinary-index paths afterward, and never pushes. Concurrent unrelated staged entries cannot enter the commit. A determinate commit failure leaves matching valid files as working-tree-only; an ambiguous ref-update timeout is reported as unknown unless the resulting commit tree can be proven. Non-Git catalogs are written normally. Every response makes the repository root, commit state, index state, target-byte state, and persistence boundary explicit.

### Write policy

A write policy narrows what each actor may write through live batches and proposals. It is trusted configuration: declare it as `writePolicy` in `okf.project.yaml`, or pass `--policy <file>` (the same mapping as a YAML file) with `--root` and `--write` or `--authoring`. Tool and HTTP arguments cannot name, replace, or relax it.

```yaml
writePolicy:
  defaultEffect: deny          # allow (default) or deny when no rule decides
  rules:
    - name: humans
      actors: ["human:*"]
    - name: nightly-seo
      actors: ["process:nightly-*", "openai/*"]
      bundles: ["customers-*"]
      paths: ["findings/**"]
      types: ["SEO Finding"]
      requiredFields: ["sources", "stale_after"]
      defaultStatus: draft     # stamped on creates that set no status
      maxConceptsPerBatch: 20
    - name: no-drafts
      actors: ["**"]
      paths: ["drafts/**"]
      effect: deny
  applyToProducers: false      # true also judges producer runs
```

For each concept in a batch, the first rule whose `actors` match the configured `--actor` and whose other selectors (when present) match decides. `effect` is `allow` by default; `requiredFields`, `defaultStatus`, and `maxConceptsPerBatch` apply to allow rules. Patterns use a fixed glob subset: `*` within one segment, `**` as a whole segment for any depth, and literal segments. They are never compiled to regular expressions, and absolute, empty, `.` and `..` segments are rejected when the policy loads. A malformed policy is a project error, so no writable server starts on it. The policy judges only the concepts a batch creates or updates; existing content is never retro-validated.

Violations are structured: `{ code: "policy_violation", rule, reason, field?, path?, bundleId?, uri?, limit?, count? }`, where `rule` is the rule's `name`, else its index, and `null` when `defaultEffect` decided. `reason` is one of `actor_denied`, `bundle_denied`, `path_denied`, `type_denied`, `missing_required_field`, or `batch_too_large`. `okf_validate_changes` reports them read-only in `policyViolations` and as `layer: "policy"` diagnostics; `okf_apply_changes` refuses such a batch with status `rejected` before staging or touching any file. Receipts carry `policyViolations` only when a policy is configured; messages name rules, paths, and URIs, never catalog text.

Scope. Live batches (`okf_validate_changes`, `okf_apply_changes`) are judged against `--actor`. Proposals are judged twice. When `okf_propose_concept`, `okf_propose_update`, `okf_propose_attested_computation`, `okf_propose_v02_migration` (every child update and the `index.md` version declaration, before any is stored) or their HTTP equivalents would store one, it is judged against the proposing actor (`--actor`, which `--authoring` also accepts); a refused proposal returns `created: false` with `policyViolations` and is not stored. When `okf_accept_proposal` or `POST /v1/proposals/<id>/accept` would write it, it is judged against the actor recorded on the proposal (`proposedBy`), else the accepting actor; a refusal returns `accepted: false` before any file is written, and an accepted create the matching rule gives a `defaultStatus` is published with that status. A write with no actor (an HTTP call, or a proposal stored before an actor or a policy was configured) is judged as the literal actor `unknown`: `*` and `**` match it and a rule can name it, so legacy proposals are judged as `unknown` at acceptance unless the accepting server has an actor. `okf serve` takes the policy from `okf.project.yaml`, or from `--policy <file>` with `--root` and `--authoring`. Producers publish under `process:<producer name>` and are exempt unless `applyToProducers: true`, in which case `okf_preview_producer` reports the violations of the created and updated concept files read-only and `okf_run_producer` / `producer run` refuse before publication. Producer output is never rewritten, so `defaultStatus` does not apply to it: a required `status` must be in the produced file, or the run is refused with `missing_required_field`. The reserved `index.md` and `log.md` files of a producer bundle are not judged.

## Authoring Concepts

The reviewable proposal workflow remains available through MCP tools started with `--authoring` and through the HTTP API. Clients never need direct local file access.

MCP proposal flow:

```json
{
  "name": "okf_propose_concept",
  "arguments": {
    "path": "tools/create-order.md",
    "frontmatter": {
      "type": "MCP Tool",
      "title": "Create Order",
      "relations": [
        {
          "type": "related_to",
          "target": "/workflows/order-creation.md"
        }
      ]
    },
    "body": "# Create Order\n\nCreates an order through the application MCP tool.",
    "message": "Document create_order for agents."
  }
}
```

Then call `okf_accept_proposal` with the returned `proposal.id`.

To correct an existing concept, read it with `get_concept`, then propose only the fields that need to change:

```json
{
  "name": "okf_propose_update",
  "arguments": {
    "uri": "okf://app/tools/create-order",
    "frontmatter": {
      "title": "Create Order Tool",
      "description": "Creates a validated order."
    },
    "removeFrontmatterKeys": ["deprecatedField"],
    "message": "Correct outdated tool metadata."
  }
}
```

Omitted frontmatter fields and an omitted body are preserved. The concept URI cannot change through an update. Each update proposal records the source file revision, and acceptance checks it again immediately before replacing the file so detected concurrent changes are rejected.

Safety rules:

- concept paths must be safe, non-hidden relative `.md` paths inside a writable bundle
- concept writes cannot traverse symbolic links under a writable bundle
- missing subdirectories are created only when a proposal is accepted
- `index.md` and `log.md` cannot be authored as concepts
- duplicate paths and duplicate `okf://` IDs are rejected
- updates cannot change concept identity and reject detected changes made after proposal creation
- invalid IDs, invalid relation types, and broken internal OKF relations fail validation
- external relation targets such as `repo://...` are allowed
- direct batches are serialized within one process and validate the combined future graph before publication
- independent processes still require external single-writer coordination

## HTTP API

The REST authoring API below is separate from [MCP over HTTP](#mcp-over-http) (`mcp --http`).

Start the HTTP server:

```bash
OKF_WRITE_TOKEN=change-me okf --root /path/to/catalog serve --host 127.0.0.1 --port 8765
```

Read/validation endpoints:

- `GET /health`
- `GET /v1/bundles`
- `POST /v1/concepts/validate`
- `POST /v1/concepts/suggest-path`

Proposal inspection and mutation endpoints require `Authorization: Bearer <OKF_WRITE_TOKEN>` because pending records can contain complete candidate Markdown and computation code:

- `GET /v1/proposals`
- `GET /v1/proposals/:id`
- `POST /v1/proposals`
- `POST /v1/proposals/update`
- `POST /v1/proposals/:id/accept`
- `POST /v1/proposals/:id/reject`

The default file-backed proposal store writes proposal JSON under `.okf-proposals` in the selected root or project. Accepted proposals write Markdown concepts into the selected local root.

`POST /v1/concepts/validate` and `POST /v1/concepts/suggest-path` do not persist anything. `POST /v1/proposals` persists only a proposal record. Only `POST /v1/proposals/:id/accept` writes a concept Markdown file.

## Remote Bundles

Remote bundles let one workspace consume concepts published by another repository without vendoring them. For a host-agnostic setup, clone or mount an OKF repository from any Git host and pass its directory through `--root`; transport and synchronization remain outside the OKF specification.

Supported source:

- Public GitHub repository tree URLs: `https://github.com/<owner>/<repo>/tree/<ref>/<path>`

Remote loading:

- inventories the tree, fetches selected `.md` documents first, then fetches only explicitly referenced bundle-local assets
- records resolved revision metadata, SHA256 digests, document/asset byte counts, and unresolved references
- inventories remote paths but never downloads the contents of unreferenced `.sql`, `.py`, or binary files
- keeps each remote bundle under its configured bundle id
- supports `include` and `exclude` filters
- resolves Markdown links inside the remote bundle path
- enforces file count and byte limits
- does not execute code from the remote repository

CLI examples:

```bash
okf --remote-bundle shared=https://github.com/example/okf-atlas/tree/main/bundles/shared --inspect
okf --project okf.project.yaml --remote-bundle vendor=https://github.com/example/vendor-okf/tree/main/bundles/catalog validate
```

MCP runtime loading:

Start the MCP server with `--allow-remote-tool` before calling `load_remote_bundle`.

```json
{
  "name": "load_remote_bundle",
  "arguments": {
    "id": "shared",
    "url": "https://github.com/example/okf-atlas/tree/main/bundles/shared",
    "include": ["public/**"]
  }
}
```

Use `list_remote_bundles` to inspect what was loaded.

## Structured Search

`search_concepts` accepts:

- `query`
- `bundle`
- `types`
- `tagsAny`
- `tagsAll`
- `pathPrefix`
- `frontmatter`
- `linkedTo`
- `linkedFrom`
- `relationType`
- `orphanOnly`
- `statuses`
- `trustTiers`
- `freshness` and deterministic `asOf`
- `hasSources`
- `runtime` and `attestationReady`
- `generatedBy` and `verifiedBy`
- `detail` (`compact` by default, or `full`)
- `limit`
- `offset`

`list_concepts` also accepts a text `query` (and `mode`) and applies it
together with its listing filters. Text search tokenizes case-insensitively,
folds diacritics, drops stop words and single letters, and stems every term
with the catalog's languages (English and Italian at 1.0). `mode` is `auto`
by default since 0.10: the concepts matching every term come first, in their
own order, and when fewer than `autoFill` of them exist (default 3) the
concepts matching only some of the terms follow them (the response's `mode`
is then `auto`; it is `any` when nothing matches every term and `all` when
nothing was appended). This keeps one long document that happens to contain
every term from hiding the shorter documents that match most of them.
`autoFill` is a library search option and an `okf.project.yaml` key
(`autoFill: 0` restores the 0.10 rule: fall back only when nothing matches
every term), never a tool argument. `all` restores the pre-0.10
behaviour and `any` ranks anything matching one term. BM25+ ranks title,
type, tags, aliases, description, path, body, and an exact field (ids,
paths, aliases, raw title tokens) that is never stemmed, so identifiers and
SKUs still match literally. Double-quoted text is matched literally (no
stemming or accent folding, stop words and single letters kept) against ids,
paths, aliases, titles and raw tokens, and unquoted tokens containing digits
or hyphens stay literal as well; stems only ever reach the text fields.
Frontmatter remains available through exact structured filters but is not
copied into the text index. Scores are
relative within a result set and are not a stable cross-version scale; use
ordering and `relevance` instead.

Query responses report `mode` (the one that ran), `queryTerms`,
`droppedTerms`, `allTermsTotal` (concepts matching every term, also under
`any`) and `lowConfidence`, true when `mode` is `any` (the any-term ranking produced the page)
and its top result matched fewer than half of the terms. Each result carries
`coverage` (share of query terms matched), `relevance` (score over the top
score) and, in full detail, `matchedTerms`. Opt-in floors `minCoverage` and
`minRelevance` drop weaker results; `freshnessPrior` down-weights deprecated
(0.5), stale (0.7), and draft (0.85) concepts. Compact results contain
`uri`, `title`, `type`, `description`, `coverage`, and `relevance`; title,
type, and description are bounded, while full results remain lossless.

Queries are bounded to 512 characters and 16 terms after stop words. Prefix
expansion and fuzzy matching are intentionally disabled. The stemming
languages come from the project config key `languages` (`auto`, `none`, or
codes such as `[it, en]`) or `--languages` in `--root` mode; `auto` detects
each bundle's languages from its documents. Punctuation-only queries return
no matches. Tags and types are matched case-insensitively. Arbitrary
frontmatter filters support exact scalar matching and array-contains
matching. `relationType` selects concepts with an outgoing relation of that
type.

The SDK regression suite also budgets a neutral four-step research path from actual serialized MCP text. It uses UTF-8 bytes divided by four as a deterministic estimate, not an exact model tokenizer or billing count, and guards both an absolute compact budget and a compact/full ratio.

Example:

```json
{
  "query": "catalog",
  "types": ["API Route"],
  "tagsAll": ["api", "orders"],
  "limit": 10
}
```

For local relevance and performance checks, run the non-packaged development
benchmark with a bundle root and an optional JSON array of `{ "query": "...",
"expected": "path/or/concept-id" }` judgments:

```bash
node --expose-gc scripts/search-benchmark.js \
  --root /path/to/okf \
  --qrels /path/to/qrels.json
```

It reports OKF and search-index build time, retained heap/RSS, p50/p95 query
latency, Recall@10, MRR@10, and representative rankings. Search indexes are
process-local and keyed to the parsed OKF index, so remote loads and accepted
proposals receive a fresh index automatically.

### Budgeted context and section anchors (0.11)

`get_context` (MCP, read-only) and `okf context <query> [--budget <tokens>]
[--limit <n>] [--provenance compact|full|none]` (CLI, JSON) answer a question
with the sections that matter instead of whole concepts. Candidates come from
the same search as `search_concepts` (same filters, `mode`, `minCoverage`,
`minRelevance`, `lowConfidence`, `queryTerms`). Their sections are scored on
their own text (BM25; the concept's type, tags and path add at most 20%) and
ordered by the candidate concept rank; within a concept, sections whose text
matches the query come before sections found only through that metadata, and
a strongly matching section may move ahead of up to four weaker concepts.
Sections are deduplicated and packed in that order while they fit
`budgetTokens` (default 1,200, never exceeded). The budget covers the whole
response as delivered: `usedTokens` is `ceil(characters / 4)` of the entire
JSON result, every field included (the candidate `concepts`, `queryTerms`,
the counters and every section field, scoring fields too), and `get_context`
returns that JSON compact, so the text an agent receives is what was
measured. Sections are packed into what the rest of the response leaves;
when even the fields around them do not fit, the candidate concept list is
shortened from its tail (`omittedConcepts`), and only a budget smaller than
the query echo and the field names can be exceeded (then no section and no
concept is returned). Each section's `tokens` is the same estimate for that
section, and the estimator is named in the response. Before 0.11.0-rc.2 only
the sections' content fields were counted, so responses ran at 1.6-1.7 times
the budget. Provenance is
`compact` by default (`status`, `freshness`, `verified` as a boolean,
`sourceCount`); `provenance: "full"` returns `status`, `staleAfter`,
`freshness`, `trustTier`, `verified`, `generated` and `sources`, and
`provenance: "none"` (or `includeProvenance: false`) spends the whole budget
on the sections. The library exposes
`assembleContext(index, options)`, `conceptSections(doc)` and
`sectionUnits(index)`.

Section anchors are an okf-mcp extension; OKF v0.2 defines none and nothing
in a bundle needs them. A concept is cut at its document-level headings: the
text before the first heading (with the title and description) is addressed
by the concept URI alone, every other section by `uri#slug`. The heading
text is first normalised (the line breaks of a setext or wrapped heading and
every whitespace run become one space, then trimmed); the slug then follows
GitHub's rule: lower-cased, every character other than a letter, a combining
mark, a digit, an underscore, a hyphen or a space removed, and each space
turned into a hyphen (so `## Consentito / Allowed` gives
`consentito--allowed`, as on GitHub). A repeated heading takes `-1`, `-2`,
... in document order. A reader that drops the fragment still lands on the
concept. An anchor depends only on the heading texts up to its own: edits to
any section body, whitespace-only edits and edits to later sections leave it
unchanged, while renaming the heading, or adding a heading with the same text
before it, changes it.

## Embeddings (0.11, opt-in)

Dense retrieval is off unless configured, and the default install makes no network calls. 0.11 ships the embedder interface, a zero-dependency client for the OpenAI embeddings API and compatible servers (Ollama, vLLM, LM Studio), a vector cache kept outside the bundle under `$XDG_CACHE_HOME/okf-mcp/<sha256 of the root>/` (`~/.cache/okf-mcp/` or `%LOCALAPPDATA%\okf-mcp\`), so a populated cache never dirties a Git worktree and can be deleted at any time, and hybrid search over it.

Enable it in `okf.project.yaml` (or, for `--root` mode, in a JSON or YAML file passed with `--embedder-config <file>`, which may also be a bare embedder block; `--cache-dir <dir>` overrides the cache location):

```yaml
embedder:
  type: openai
  baseUrl: https://api.openai.com   # or a local OpenAI-compatible server
  model: text-embedding-3-small
  apiKeyEnv: OPENAI_API_KEY         # the key is read only from this variable
  dimensions: 512
  # optional: batchSize, timeoutMs, maxRetries, concurrency, maxInputChars
cacheDir: ../okf-vectors            # optional; relative to the project root, never inside it
fusion:
  alpha: 0.4                        # weight of the dense side (default 0.4, chosen on the development queries)
  normalization: tmm                # tmm (default), lexical-tmm or minmax
embedUnits: concepts                # concepts (default) or sections (one vector per section; better on synonym queries)
```

Embedder settings are never accepted as tool arguments. At startup the server validates the embedder, discovers the dimension when it is not configured, opens the cache and embeds the missing units in the background; it never fails to start because of the embedder. `search_concepts` then fuses the lexical ranking with cosine similarity over the cache by convex combination of normalised scores: each side is scaled by its best score above a lower bound: by default the theoretical minimum of its scoring function (0 for the lexical score, -1 for cosine; `tmm`); `lexical-tmm` uses the theoretical minimum on the lexical side only and `minmax` the observed minimum on both, as in Bruch et al., arXiv:2210.11934 (`hybrid: false` per call keeps it lexical and makes no request). Remote bundles stay lexical-only: their text is never embedded. `mode`, `coverage`, `allTermsTotal` and the `minCoverage`/`minRelevance` floors keep their lexical meaning (an explicit `mode: "all"` only re-ranks the all-term matches): the lexical hits are fused with the 200 nearest concepts by cosine, a fixed candidate set so every page of a query paginates the same ranking, and each candidate carries its own lexical evidence (matched terms, coverage, score), which the floors and `lowConfidence` (computed on the displayed top result) read. When the all-term pass ran and the query holds quoted or identifier-like terms, the all-term matches stay ahead of every semantic neighbour. `relevance` and `score` become fused and each result adds `lexicalScore`, `denseScore` (cosine) and `fusedScore`. The response adds `hybrid`, `alpha`, `normalization`, `embedder: { id, remote, dimension, degraded, code?, serverCode? }`, `cache: { rows, dir? }` (`dir` only on a `--write` server), `usage: { promptTokens, requests }` for the query encoding, and `timings: { queryEncodingMs, searchMs, totalMs }`. Whenever the embedder is missing, failing or the cache is empty, search runs lexical-only with `embedder.degraded: true`, a fixed `code` and, for HTTP failures, the enumerated `serverCode`; no server-supplied text is ever returned. After a failed query encoding the server stays lexical for 30 seconds before trying again. After each successful `okf_apply_changes` batch only the changed units are embedded (one request when the batch fits) and the receipt carries `embedding: { units, embedded, skipped, embedder, cache, usage, durationMs }`. The read-only `embedding_status` tool, listed only when an embedder is configured, reports the embedder, the cache, the startup and last preparation receipts and the token usage. Receipts report `embedder.remote: true` whenever text leaves the machine. The cache is keyed by the embedder identity `openai:<endpoint>:<model>:<dimension>:<maxInputChars>`, so a change of endpoint, model, dimension or truncation length rebuilds it. The library exposes `createOpenAiEmbedder`, `openVectorCache`, `resolveCacheDir`, `prepareEmbeddings`, `openEmbeddingRuntime`, `denseSearch` and `fuseRankings`; `node scripts/eval-search.js --embedder <file>` scores hybrid runs on the retrieval fixtures.

Long or identifier-dense documents: the client truncates every input at `maxInputChars` (default 24,000 characters) and plans requests with a conservative estimate of one token per 3 characters, because generated contracts and column lists run at about 2.6 characters per token and overflow the provider's 8,192-token input limit at the old 32,000-character default (the default change rebuilds caches keyed with 32000). If the provider still refuses a request as `invalid_request`, the client splits the batch in halves until the refused inputs stand alone (a bounded number of extra requests), retries each refused input once at half its length (never below 2,000 characters) and, if it is refused again, skips that unit: the preparation receipt lists it under `skipped: [{ id, reason: "input_rejected" }]`, every other unit is embedded and search stays hybrid. `embedding_status` reports `skipped: { count, ids }` (the first five ids) for the last preparation, and the startup receipt carries the same field; a skipped unit is retried by the next preparation and is found by its lexical score meanwhile. A request whose every input is refused is a configuration problem and still fails as before.

Adaptive fusion weight (0.12): `fusion.alpha: adaptive` decides the weight of the semantic side once per query, from what the lexical pass already knows, so every page of a query uses the same weight: `fusion.adaptive.low` when the query holds quoted or identifier-like terms and some concept matches every term (the all-term matches still stay ahead of every semantic neighbour), `mid` when at least `autoFill` concepts match every term, `high` when no concept matches every term and none matches even half of them, and in between linear in the best lexical coverage, from `high` at 0.5 to `mid` at 1. The weights default to the development-split choice `{ low: 0.1, mid: 0.5, high: 0.9 }`; `high` may not be below `mid`. Hybrid responses report `alphaUsed` and `alphaReason` (`fixed`, `literal_terms`, `all_terms`, `weak_lexical` or `interpolated`) and `embedding_status` reports the setting and its weights. The default stays the fixed 0.4, which ranks exactly as 0.11 did: on the fixtures the adaptive weight raised alpinaria Recall@5 from 0.830 to 0.838 (synonyms 0.542 to 0.604) but lowered atlas from 0.882 to 0.870, so it missed its pre-registered conditions (`test/fixtures/retrieval/reports/hybrid-0.12-2026-10-25.md`).

```yaml
fusion:
  alpha: adaptive                   # or a number between 0 and 1 (default 0.4)
  adaptive: { low: 0.1, mid: 0.5, high: 0.9 }
```

Contextual units (0.12): `embedUnits: contextual-sections` embeds each section after a one-line prefix naming its concept, `title · type · path` (at most 160 characters; a long title is shortened first), so a bare "Limits" or "Steps" section carries the system it belongs to; `contextual-concepts` puts `type · path` before the concept text. Anchors are those of `sections`. The prefixed texts have their own hashes, so switching unit sets re-embeds every unit once (the preparation receipt, the startup receipt and `embedding_status` name the unit set; `embedded` and `pruned` count the switch), and afterwards a body edit re-embeds only its section (a title, type or path edit re-embeds every section of that concept). `concepts` stays the default: on the development queries no other unit set beat it by the pre-registered rule (mean dev Recall@5 0.844 for concepts, 0.843 contextual-concepts, 0.841 contextual-sections, 0.834 sections), and on the fixtures' short sections the prefix costs 56% more prompt tokens (6.6% for contextual-concepts).

Confidence (0.12): every `search_concepts` and `get_context` response to a query carries `confidence: { coverage, topSimilarity, lowConfidence, reasons }`. `coverage` is the share of query terms the top result matched; `topSimilarity` is the best cosine similarity between the query and any candidate's units when the semantic side ran (`null` otherwise); `lowConfidence` (also the top-level field) is true when the any-term fallback produced the results and the top result matched fewer than half of the terms (reason `weak_lexical_match`), or when the top result matched fewer than half of the terms and `topSimilarity` is below `confidence.minSimilarity` (reason `low_similarity`). Lexical-only responses have no similarity and keep the 0.10 rule. `get_context` takes `abstainOnLowConfidence: true` to return no sections for a low-confidence query (the response keeps the confidence block and the candidate concepts and says `abstained: true`). The similarity threshold depends on the embedding model; the default, 0, was chosen on the development queries for `text-embedding-3-small`: no threshold up to 0.8 flagged a single extra unanswerable query there, because every unanswerable query whose top result matched fewer than half of the terms was already an any-term fallback. A deployment can set its own:

```yaml
confidence:
  minSimilarity: 0.3                # cosine below which a weakly matched top result is flagged
```

## Graph Behavior

As an okf-mcp graph projection, Markdown links become `markdown_link` edges, extension `relations` become typed `relation` edges, and standard v0.2 path-valued fields become `resource`, `source`, `computation`, `executor`, and `attester` edges. Internal concept references resolve to canonical nodes; explicitly referenced non-Markdown files resolve to okf-mcp `okf-asset://` nodes; URLs and scope descriptors remain unfetched external or opaque leaves.

For navigation convenience, okf-mcp resolves links to a nested bundle directory to that directory's reserved
`index.md` when there is no exact document target. This applies to local and
remote bundles and to candidate validation during proposal authoring.

Graph tools return bounded JSON:

```json
{
  "nodes": [
    {
      "id": "okf://app/routes/order-status",
      "bundle": "app",
      "path": "routes/order-status.md",
      "type": "API Route",
      "title": "Order Status Route",
      "tags": ["api", "orders"],
      "description": "Serves order status state."
    }
  ],
  "edges": [],
  "warnings": []
}
```

Use `graph_summary` first for counts by lifecycle, trust, freshness, runtime, readiness, and edge kind. Graph tools accept `edgeKinds`; pass `includeExternal: true` or `includeAssets: true` when those leaf nodes are needed.

Default relation types:

- `depends_on`
- `produces`
- `consumes`
- `persists_to`
- `materializes_to`
- `configured_by`
- `checked_by`
- `owned_by`
- `supersedes`
- `related_to`

Add project-specific relation types with `relationTypes` in `okf.project.yaml`.

Project paths in `bundles` and `plugins` must be relative paths that stay inside the directory containing `okf.project.yaml`. Absolute paths and `../` escapes are rejected.

Bundle `include` and `exclude` filters use simple path patterns:

- exact file paths, such as `services/order-status.md`
- directory prefixes, such as `archive/`
- `*` for one path segment
- `**` for any nested path

## Validation

`validate`, `validate_bundle`, and `validate_project` return separate `conformant` and `validForProject` fields plus structured diagnostics. `valid` remains a compatibility alias for `validForProject`.

OKF conformance covers, when the corresponding files are present:

- parseable YAML mapping frontmatter on non-reserved concept documents
- a non-empty `type`
- the reserved structure of `index.md` and `log.md`

Unknown frontmatter keys and unknown concept type values do not fail conformance. The YAML parser supports nested mappings, arrays, block scalars, and other structures accepted by its safe YAML core schema; duplicate keys and unsupported custom tags are rejected.

Missing `index.md` files and broken cross-links do not fail OKF conformance. `strictLinks` affects only okf-mcp workspace validity (`validForProject`), not the normative `conformant` result.

Project validity additionally reports:

- duplicate OKF URIs
- broken internal Markdown links as advisories by default; set project `strictLinks: true` or pass `--strict-links` to make them project-invalid
- invalid relation types
- missing relation targets
- broken `okf://` relation targets
- duplicate bundle IDs
- invalid or escaping project paths
- links that resolve outside the configured bundle root
- missing bundle roots

The server keeps serving valid concepts from partial bundles.

Optional v0.2 families are normalized into `signals`. Malformed provenance, generation, verification, lifecycle, freshness, or computation metadata produces an advisory and never creates a fourth trust tier. Verification fails closed to `unverified`; absent status defaults to `stable`; freshness is evaluated at an explicit `asOf` date when supplied. Authoring is stricter than consumption and rejects malformed known v0.2 fields.

## Attested Computation

`inspect_attested_computation` reports the runtime, declared parameters, sanctioned inline or file computation digest, executor receipt fields, attester reference, indexed assets, readiness, and diagnostics. `prepare_attested_computation` checks declared parameter names and returns digests without returning values. `check_computation_receipt` checks field presence without returning values, persisting the receipt, or claiming attestation.

okf-mcp has no execution or attestation adapter. It never runs the computation, executor resource, or attester resource, and it never fetches an external contract URI on demand.

CLI parity is available through `computation inspect|prepare|check-receipt`, `provenance`, `edge-kinds`, and `asset`. Supply sensitive values with `--parameters-file <path|->` or `--receipt-file <path|->`; raw parameter and receipt JSON is intentionally rejected in process arguments. `-` reads one JSON object from stdin. Asset reads accept `--max-content-bytes` up to the indexed 1 MiB limit.

## Migrating Existing Catalogs To v0.2

The v0.2 specification keeps v0.1 bundles consumable through two fallbacks: legacy `timestamp` when `generated` is absent, and a legacy body `# Citations` list when `sources` is absent. okf-mcp applies those fallbacks during reads and offers an optional review-only conversion workflow.

For one root, inspect migration readiness and preview the proposed native fields without writing anything:

```bash
okf --root /path/to/catalog migrate check
okf --root /path/to/catalog migrate preview \
  '{"metrics/revenue.md":{"by":"human:owner","confirmed":true}}'
```

In optional multi-root project mode, supply the root id before the actor-mapping JSON.

Migration is deliberately conservative:

- native `generated` and `sources` fields always win
- a valid `timestamp` is copied into a new `generated: { by, at }` mapping only after a truthful `by` actor is explicitly confirmed
- `# Citations` becomes `sources` only from one top-level H1 section containing at least one safely parseable list entry and no unparsed prose, nested sections, ambiguous entries, or escaping paths
- legacy fields and citation prose are retained for compatibility
- concepts marked by `--generated-path`, a document flag, or `generated_file`/`generatedFile` frontmatter must be changed through their generator; remote roots are report-only
- identity collisions, invalid documents, unsafe references, and unresolved assets block the version declaration

`okf_propose_v02_migration` requires local-root authoring. It creates a review manifest, one proposal per affected file, and a gated root `okf_version: "0.2"` proposal. Nothing is accepted automatically; the root proposal can be accepted only after every child is accepted and the complete catalog validates.

## Generator Plugins

Generator plugins are configured in `okf.project.yaml` and run with `generate`.

Built-in plugins:

- `filesystem`: creates one concept per matching source file. Defaults to Markdown files.
- `json-spec`: creates one concept per JSON file and can emit `persists_to` relations when a destination table is present.

Generated output is regular Markdown/YAML OKF and is validated by the same indexer as hand-authored concepts.

## Limitations

- MCP is served over stdio and, with `mcp --http`, over Streamable HTTP. The separate HTTP authoring API (`serve`) is not MCP over HTTP.
- MCP protocol compatibility follows the pinned official SDK v2 dependency.
- There is no file watcher. Over stdio, restart the server after external file changes; over HTTP, changes are picked up before a request at most once per `--refresh-interval`. Concepts accepted through MCP authoring refresh the MCP server index immediately.
- With `mcp --http`, proposal authoring (`--authoring`) is not available, a revoked introspected token stays valid for up to 60 seconds, and one process still serves one root or project for every principal.
- The HTTP API is a lightweight built-in server, not a full hosted multi-tenant service.
- OKF v0.2 computation support is static inspection and preflight only; no computation or attester is executed.
