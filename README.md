# okf-mcp

`okf-mcp` publishes [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) from the systems that already hold the knowledge, and serves the result to agents. It is a local-first consumer, validator, graph index, CLI, and MCP server.

The part that is hard is writing to a catalog safely. A configured producer reads an external source and returns a candidate bundle; okf-mcp validates it, then publishes it under an ownership manifest that records exactly which files it owns. Hand-authored content is never adopted, a source that did not change rewrites nothing, and no producer output escapes its bundle. [`@mfdaves/okf-postgres`](https://github.com/mfdaves/okf-postgres) reads PostgreSQL catalogs this way without reading a single table row.

Reading is the ordinary half. It consumes an OKF bundle directory of Markdown files with YAML frontmatter. An optional workspace mode can federate several bundles. Concepts are exposed through CLI commands and MCP resources and tools for validation, structured search, graph navigation, provenance inspection, and proposal-based authoring.

The core intentionally has no database, embeddings, build step, or hosted-service dependency. It uses `js-yaml` for safe YAML, CommonMark for Markdown structure, MiniSearch for in-memory BM25+ text retrieval, and the official Model Context Protocol TypeScript SDK v2 for stdio MCP. Local root mode makes no network calls. Optional remote loading fetches public Markdown concepts and only their explicitly referenced inert assets from GitHub. Nothing in the v0.2 computation support executes code or attests a receipt.

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
git clone --branch v0.9.0 https://github.com/mfdaves/okf-mcp.git
cd okf-mcp
npm ci
node bin/okf-mcp.js --root ./path/to/okf validate
```

Pin the published version for reproducible use:

```bash
npx -y @mfdaves/okf-mcp@0.9.0 --version
npx -y @mfdaves/okf-mcp@0.9.0 --root ./path/to/okf validate
```

For a persistent installation:

```bash
npm install --global @mfdaves/okf-mcp@0.9.0

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

`producer preview` exits `1` when the candidate is invalid; `producer run` exits `1` when nothing was published. Both print the same receipt the MCP tools return.

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
        "@mfdaves/okf-mcp@0.9.0",
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
        "@mfdaves/okf-mcp@0.9.0",
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

## MCP Registry Metadata

`server.json` describes the npm package as the stdio server
`io.github.mfdaves/okf-mcp`. Registry-aware clients should prompt for an
absolute OKF root path, pass it through `--root`, and append the fixed `mcp`
command.

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

`list_concepts` also accepts a text `query` and applies it together with its
listing filters. Text search tokenizes case-insensitively and requires every
query term, regardless of order. BM25+ ranks title, type, tags, aliases,
description, path, and body matches; frontmatter remains available through
exact structured filters but is not copied into the text index. Scores are
relative within a result set and are not a stable cross-version scale. Compact results contain only `uri`, `title`, `type`, and `description`; title, type, and description are bounded, while full results remain lossless.

Queries are bounded to 512 characters and 16 terms. Prefix expansion, fuzzy
matching, stemming, and stop-word removal are intentionally disabled so code
identifiers and domain terminology remain literal. Punctuation-only queries
return no matches. Tags and types are matched case-insensitively. Arbitrary
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

- MCP transport is stdio only. The separate HTTP authoring API is not MCP over HTTP.
- MCP protocol compatibility follows the pinned official SDK v2 dependency.
- There is no file watcher. Restart the server after external file changes. Concepts accepted through MCP authoring refresh the MCP server index immediately.
- The HTTP API is a lightweight built-in server, not a full hosted multi-tenant service.
- OKF v0.2 computation support is static inspection and preflight only; no computation or attester is executed.
