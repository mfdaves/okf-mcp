---
id: okf://okf-mcp/specs/concept-format
type: OKF Data Contract
title: OKF Concept Format
description: Markdown and frontmatter contract consumed and produced by okf-mcp.
tags: [okf, contract, markdown, yaml]
relations:
  - type: configured_by
    target: repo://src/parser.js
  - type: related_to
    target: okf://okf-mcp/runtime/indexer
  - type: related_to
    target: okf://okf-mcp/runtime/file-concept-store
  - type: checked_by
    target: repo://test/okf-mcp.test.js
  - type: checked_by
    target: repo://test/conformance.test.js
---

# OKF Concept Format

An OKF concept is a UTF-8 Markdown file with YAML frontmatter. A non-empty string `type` is required. Standard v0.2 metadata families include `resource`, `sources`, `usage_window`, `generated`, `verified`, `status`, `stale_after`, and the Attested Computation contract. The Markdown body carries the durable explanation.

The standard Concept ID is the bundle-relative path with `.md` removed. okf-mcp also creates the workspace-scoped locator `okf://<bundle>/<concept-id>` for MCP resources and federated lookup; it is not the portable OKF identity. The former `.md` URI remains a compatibility alias. A URI-shaped portable path is accepted only when its apparent authority is not a loaded bundle and the complete portable ID is globally unique; canonical identity always takes precedence. The optional `id`, `aliases`, and typed `relations` fields are `okf-mcp` extensions; a valid custom `id` is an additional alias rather than a replacement for the standard identity.

Frontmatter is parsed as a YAML mapping with the safe core schema. Nested mappings, arrays, block scalars, and unknown extension keys are preserved. Duplicate mapping keys and unsupported custom tags are rejected. Unknown concept type values do not fail OKF conformance.

Files named `index.md` and `log.md` are reserved resources and are not concepts. Reserved indexes group local Markdown links under headings. A link to a bundle directory resolves to that directory's nested `index.md` when no exact document target exists. Reserved logs use an H1 title followed by newest-first ISO-dated H2 sections containing list entries.

Consumers normalize bare `verified` mappings into one event and derive exactly `unverified`, `machine-confirmed`, or `human-reviewed`. Missing status defaults to `stable`; freshness is evaluated deterministically against `stale_after`. Malformed optional families produce advisories and fail trust closed without invalidating minimum conformance.

Internal paths, compatibility `okf://` targets, and Markdown links are checked as project rules rather than redefining minimum document conformance. Broken Markdown links are advisory unless `strictLinks` is enabled. CommonMark parsing excludes images and code fences from relationship extraction.

The [indexer](../runtime/indexer.md) validates this contract. Accepted proposals are rendered back into this format by the [file concept store](../runtime/file-concept-store.md).
