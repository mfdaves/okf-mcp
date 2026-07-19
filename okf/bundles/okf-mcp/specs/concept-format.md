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
---

# OKF Concept Format

An OKF concept is a Markdown file with YAML frontmatter. A non-empty `type` is required. `title`, `description`, `tags`, `aliases`, and typed `relations` provide structured metadata, while the Markdown body carries the durable explanation.

The optional `id` field defines a stable `okf://` URI. Without it, the URI is derived from the bundle id and relative file path. A stable id is preferred for public concepts because it survives file moves. The path-derived URI remains an alias in the index.

Frontmatter intentionally supports a constrained YAML shape: scalar values, inline arrays, block arrays, and arrays of flat objects. Internal `okf://` relation targets must resolve. Other schemes such as `repo://` are retained as opaque external references.

Files named `index.md` and `log.md` are reserved resources and are not concepts. Markdown links inside a bundle become graph edges and are validated against the bundle boundary.

The [indexer](../runtime/indexer.md) validates this contract. Accepted proposals are rendered back into this format by the [file concept store](../runtime/file-concept-store.md).
