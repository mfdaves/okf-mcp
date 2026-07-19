# okf-mcp

`okf-mcp` is a project-agnostic Open Knowledge Format CLI, graph index, generator runner, MCP stdio server, and optional HTTP authoring API.

It consumes one or more directories of Markdown files with YAML frontmatter, treats non-reserved Markdown files as OKF concepts, and exposes those concepts through CLI commands plus MCP resources and tools for structured search, validation, graph navigation, and proposal-based authoring.

The core intentionally has no database, embeddings, build step, or hosted-service dependency. It uses `js-yaml` for standards-oriented YAML parsing. Local bundle mode makes no network calls. Optional remote bundles can fetch public Markdown concepts from GitHub when configured. Generator plugins and accepted authoring proposals are the write paths, and both write only under configured project directories.

## Install And Run

The current release candidate is published under npm's `next` tag. Pin the
exact version for unattended MCP clients:

```bash
npx -y @mfdaves/okf-mcp@0.3.2-rc.1 --version
npx -y @mfdaves/okf-mcp@0.3.2-rc.1 --project ./okf.project.yaml validate
```

For a persistent installation:

```bash
npm install --global @mfdaves/okf-mcp@0.3.2-rc.1

okf --version
okf --project ./okf.project.yaml validate
okf-mcp --project ./okf.project.yaml mcp
```

To work from the source repository:

```bash
git clone https://github.com/mfdaves/okf-mcp.git
cd okf-mcp
npm ci
npm test
node bin/okf-mcp.js --version
```

Node 22 or newer is required.

`--bundle` accepts either a path or `id=path`. Multiple `--bundle` flags are allowed.

`--remote-bundle` accepts `id=https://github.com/<owner>/<repo>/tree/<ref>/<path>`. It fetches public Markdown files from that GitHub tree and indexes them as a read-only bundle.

`--inspect` prints a compact graph summary and exits. Without `--inspect` and without an explicit command, the process starts a stdio MCP server.

The package exposes both `okf` and `okf-mcp` binaries when installed. If neither `--project` nor a bundle source is passed, the CLI discovers the nearest `okf.project.yaml` or `okf.project.json` from the current directory.

CLI exit statuses are `0` for success, `1` for validation or operational failure, and `2` for invalid usage. Unknown options are rejected.

## Published OKF Reference

This repository publishes a self-describing OKF bundle for the product, its runtime boundaries, interfaces, authoring workflows, and safety policy. The canonical entry point is `okf://okf-mcp/overview/okf-mcp`.

Validate and query the bundled reference from a checkout or installed package:

```bash
okf --project okf.project.yaml validate
okf --project okf.project.yaml search "proposal"
okf --project okf.project.yaml concept okf://okf-mcp/overview/okf-mcp
```

Load the latest published reference directly from GitHub:

```bash
okf --remote-bundle okf-mcp=https://github.com/mfdaves/okf-mcp/tree/main/okf/bundles/okf-mcp --inspect
```

For reproducible consumption, replace `main` with a release tag. The
`@mfdaves/okf-mcp` npm package includes both `okf.project.yaml` and the
complete reference bundle.

## Project Config

For project-agnostic use, create an `okf.project.yaml` at a repository root:

```yaml
project: Example
bundles:
  - id: app
    root: okf/bundles/app
    include: ["**/*.md"]
    exclude: ["archive/**"]
  - id: data
    root: okf/bundles/data
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
```

Run project commands:

```bash
okf --project okf.project.yaml validate
okf --project okf.project.yaml search "orders"
okf --project okf.project.yaml graph mermaid
okf --project okf.project.yaml generate
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
- `concept <uri>`
- `neighbors <uri>`
- `paths <from> <to>`
- `generate`
- `serve`

`serve` options:

- `--host <host>`: bind host, default `127.0.0.1`
- `--port <port>`: bind port, default `8765`
- `--write-token <token>`: bearer token for write endpoints; defaults to `OKF_WRITE_TOKEN`
- `--proposal-root <path>`: proposal JSON directory; defaults to `.okf-proposals` under the project root

## MCP Client Config

Example client configuration:

```json
{
  "mcpServers": {
    "okf": {
      "command": "npx",
      "args": [
        "-y",
        "@mfdaves/okf-mcp@0.3.2-rc.1",
        "--bundle",
        "app=/absolute/path/to/repo/okf/bundles/app",
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
        "@mfdaves/okf-mcp@0.3.2-rc.1",
        "--project",
        "/absolute/path/to/repo/okf.project.yaml",
        "mcp"
      ]
    }
  }
}
```

Add `--authoring` to enable proposal creation, acceptance, and rejection. Add `--allow-remote-tool` to let MCP clients load arbitrary supported public remote bundles at runtime. Configured remote bundles remain readable without that runtime-loading flag.

## Concept Format

The server exposes one resource per Markdown document:

```text
okf://<bundle-id>/<relative-path>
```

Resources use `text/markdown`. Reserved `index.md` and `log.md` files are resources, but they are not concept documents.

Concept files may use a path-derived URI or set a stable `id`:

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

`okf://` relation targets must resolve to a known concept. Non-OKF targets such as `repo://` are treated as external opaque references.

## Tools

- `list_bundles`
- `list_concepts`
- `get_concept`
- `search_concepts`
- `list_types`
- `list_tags`
- `list_relation_types`
- `load_remote_bundle`
- `list_remote_bundles`
- `okf_validate_concept`
- `okf_suggest_concept_path`
- `okf_propose_concept`
- `okf_propose_update`
- `okf_list_proposals`
- `okf_get_proposal`
- `okf_accept_proposal`
- `okf_reject_proposal`
- `get_graph`
- `get_neighbors`
- `get_subgraph`
- `find_paths`
- `graph_summary`
- `validate_bundle`
- `validate_project`
- `export_graph`

Most MCP tools are read-only over the current index. `load_remote_bundle` mutates only the server's in-memory index by fetching a public GitHub tree; it does not write files.

Every MCP tool includes a purpose-specific description, descriptions for its input parameters, and standard annotations covering read-only behavior, destructive behavior, idempotency, and external access.

Tool discovery and direct invocation use the same capability checks:

| Mode | Proposal mutations | Runtime remote load | Configured remote reads |
| --- | --- | --- | --- |
| default | disabled | disabled | enabled |
| `--authoring` | enabled | disabled | enabled |
| `--allow-remote-tool` | disabled | enabled | enabled |
| both flags | enabled | enabled | enabled |

Project mode may expose read-only concept validation, path suggestion, and proposal inspection helpers. The `okf_*` mutation tools are proposal-first and require both project mode and `--authoring`. Proposing a concept or update writes only a proposal record. Accepting a proposal writes the Markdown concept into the configured bundle root and rebuilds the complete index from configured local bundles, configured remote bundles, and runtime-loaded remote bundles.

## Authoring Concepts

Concept authoring is available through MCP tools started with `--authoring` and through the HTTP API. Clients never need direct local file access.

MCP proposal flow:

```json
{
  "name": "okf_propose_concept",
  "arguments": {
    "bundle": "app",
    "path": "tools/create-order.md",
    "frontmatter": {
      "type": "MCP Tool",
      "title": "Create Order",
      "relations": [
        {
          "type": "related_to",
          "target": "okf://app/workflows/order-creation"
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

- concept paths must be safe relative `.md` paths inside a writable bundle
- concept writes cannot traverse symbolic links under a writable bundle
- missing subdirectories are created only when a proposal is accepted
- `index.md` and `log.md` cannot be authored as concepts
- duplicate paths and duplicate `okf://` IDs are rejected
- updates cannot change concept identity and reject detected changes made after proposal creation
- invalid IDs, invalid relation types, and broken internal OKF relations fail validation
- external relation targets such as `repo://...` are allowed

## HTTP API

Start the HTTP server:

```bash
OKF_WRITE_TOKEN=change-me okf --project okf.project.yaml serve --host 127.0.0.1 --port 8765
```

Read/validation endpoints:

- `GET /health`
- `GET /v1/bundles`
- `POST /v1/concepts/validate`
- `POST /v1/concepts/suggest-path`
- `GET /v1/proposals`
- `GET /v1/proposals/:id`

Mutation endpoints require `Authorization: Bearer <OKF_WRITE_TOKEN>`:

- `POST /v1/proposals`
- `POST /v1/proposals/update`
- `POST /v1/proposals/:id/accept`
- `POST /v1/proposals/:id/reject`

The default file-backed proposal store writes proposal JSON under `.okf-proposals` in the project root. Accepted proposals write Markdown concepts into the configured bundle root.

`POST /v1/concepts/validate` and `POST /v1/concepts/suggest-path` do not persist anything. `POST /v1/proposals` persists only a proposal record. Only `POST /v1/proposals/:id/accept` writes a concept Markdown file.

## Remote Bundles

Remote bundles let one project consume concepts published by another repository without cloning or vendoring them locally.

Supported source:

- Public GitHub repository tree URLs: `https://github.com/<owner>/<repo>/tree/<ref>/<path>`

Remote loading:

- indexes only `.md` files
- ignores non-Markdown files
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
- `limit`
- `offset`

Tags and types are matched case-insensitively. Arbitrary frontmatter filters support exact scalar matching and array-contains matching.

Example:

```json
{
  "query": "catalog",
  "types": ["API Route"],
  "tagsAll": ["api", "orders"],
  "limit": 10
}
```

## Graph Behavior

Markdown links between OKF documents become `markdown_link` edges. Frontmatter `relations` become typed `relation` edges.

Graph tools return compact JSON:

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

Use `graph_summary` first for a compact overview, `get_neighbors` for local traversal, and `get_subgraph` for bounded expansion around seed concepts. `export_graph` supports `json`, `dot`, and `mermaid`. Pass `includeExternal: true` to graph tools when opaque external targets should appear as graph nodes.

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

OKF conformance covers:

- parseable YAML mapping frontmatter on non-reserved concept documents
- a non-empty `type`
- the reserved structure of `index.md` and `log.md`

Unknown frontmatter keys and unknown concept type values do not fail conformance. The YAML parser supports nested mappings, arrays, block scalars, and other structures accepted by its safe YAML core schema; duplicate keys and unsupported custom tags are rejected.

Project validity additionally reports:

- duplicate OKF URIs
- broken internal Markdown links
- invalid relation types
- missing relation targets
- broken `okf://` relation targets
- duplicate bundle IDs
- invalid or escaping project paths
- links that resolve outside the configured bundle root
- missing bundle roots

The server keeps serving valid concepts from partial bundles.

## Generator Plugins

Generator plugins are configured in `okf.project.yaml` and run with `generate`.

Built-in plugins:

- `filesystem`: creates one concept per matching source file. Defaults to Markdown files.
- `json-spec`: creates one concept per JSON file and can emit `persists_to` relations when a destination table is present.

Generated output is regular Markdown/YAML OKF and is validated by the same indexer as hand-authored concepts.

## Limitations

- The MCP server implements the stdio JSON-RPC methods needed for resources and tools directly instead of using an SDK, so advanced SDK conveniences are out of scope.
- MCP initialization accepts only the explicitly supported protocol versions and rejects unsupported versions.
- There is no file watcher. Restart the server after external file changes. Concepts accepted through MCP authoring refresh the MCP server index immediately.
- The HTTP API is a lightweight built-in server, not a full hosted multi-tenant service.
