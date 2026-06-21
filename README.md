# okf-mcp

`okf-mcp` is a project-agnostic Open Knowledge Format CLI, graph index, generator runner, and read-only MCP stdio server.

It consumes one or more directories of Markdown files with YAML frontmatter, treats non-reserved Markdown files as OKF concepts, and exposes those concepts through CLI commands plus MCP resources and tools for structured search, validation, and graph navigation.

The core intentionally has no runtime dependencies, no database, and no embeddings. Local bundle mode makes no network calls. Optional remote bundles can fetch public Markdown concepts from GitHub when configured. Generator plugins are the only write path, and they write only to configured output directories.

## Install And Run

From this repository:

```bash
git clone https://github.com/mfdaves/okf-mcp.git
cd okf-mcp
npm test
node bin/okf-mcp.js --bundle ./okf/bundles/app --inspect
node bin/okf-mcp.js --bundle app=./okf/bundles/app
```

`--bundle` accepts either a path or `id=path`. Multiple `--bundle` flags are allowed.

`--remote-bundle` accepts `id=https://github.com/<owner>/<repo>/tree/<ref>/<path>`. It fetches public Markdown files from that GitHub tree and indexes them as a read-only bundle.

`--inspect` prints a compact graph summary and exits. Without `--inspect`, the process starts a stdio MCP server.

The package also exposes an `okf` binary when installed.

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
node bin/okf-mcp.js --project okf.project.yaml validate
node bin/okf-mcp.js --project okf.project.yaml search "orders"
node bin/okf-mcp.js --project okf.project.yaml graph mermaid
node bin/okf-mcp.js --project okf.project.yaml generate
node bin/okf-mcp.js --project okf.project.yaml mcp
node bin/okf-mcp.js --remote-bundle shared=https://github.com/example/okf-atlas/tree/main/bundles/shared --inspect
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

## MCP Client Config

Example client configuration:

```json
{
  "mcpServers": {
    "okf": {
      "command": "node",
      "args": [
        "/absolute/path/to/okf-mcp/bin/okf-mcp.js",
        "--bundle",
        "app=/absolute/path/to/repo/okf/bundles/app"
      ]
    }
  }
}
```

Project config mode:

```json
{
  "mcpServers": {
    "okf": {
      "command": "node",
      "args": [
        "/absolute/path/to/okf-mcp/bin/okf-mcp.js",
        "--project",
        "/absolute/path/to/repo/okf.project.yaml",
        "mcp"
      ]
    }
  }
}
```

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
- `get_graph`
- `get_neighbors`
- `get_subgraph`
- `find_paths`
- `graph_summary`
- `validate_bundle`
- `validate_project`
- `export_graph`

Most MCP tools are read-only over the current index. `load_remote_bundle` mutates only the server's in-memory index by fetching a public GitHub tree; it does not write files.

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
node bin/okf-mcp.js --remote-bundle shared=https://github.com/example/okf-atlas/tree/main/bundles/shared --inspect
node bin/okf-mcp.js --project okf.project.yaml --remote-bundle vendor=https://github.com/example/vendor-okf/tree/main/bundles/catalog validate
```

MCP runtime loading:

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

`validate_bundle` and `validate_project` report:

- invalid or unsupported YAML frontmatter
- missing frontmatter on concept files
- missing non-empty `type` on concept files
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

- The YAML parser intentionally supports the simple frontmatter shape used by OKF concept metadata: scalar keys, inline arrays, block arrays, and arrays of objects.
- The MCP server implements the stdio JSON-RPC methods needed for resources and tools directly instead of using an SDK, so advanced SDK conveniences are out of scope.
- There is no file watcher. Restart the server after changing OKF files.
