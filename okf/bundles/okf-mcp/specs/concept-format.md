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

An OKF concept is a Markdown file with YAML frontmatter. A non-empty `type` is required. `title`, `description`, `tags`, `aliases`, and typed `relations` provide structured metadata, while the Markdown body carries the durable explanation.

The optional `id` field defines a stable `okf://` URI. Without it, the URI is derived from the bundle id and relative file path. A stable id is preferred for public concepts because it survives file moves. The path-derived URI remains an alias in the index.

Frontmatter is parsed as a YAML mapping with the safe core schema. Nested mappings, arrays, block scalars, and unknown extension keys are preserved. Duplicate mapping keys and unsupported custom tags are rejected. Unknown concept type values do not fail OKF conformance.

Files named `index.md` and `log.md` are reserved resources and are not concepts. Reserved indexes group local Markdown links under headings. Reserved logs use an H1 title followed by newest-first ISO-dated H2 sections containing list entries.

Internal `okf://` relation targets and Markdown links are checked as project rules rather than redefining minimum document conformance. Other schemes such as `repo://` are retained as opaque external references.

The [indexer](../runtime/indexer.md) validates this contract. Accepted proposals are rendered back into this format by the [file concept store](../runtime/file-concept-store.md).
