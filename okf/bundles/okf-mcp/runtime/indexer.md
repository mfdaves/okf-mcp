---
id: okf://okf-mcp/runtime/indexer
type: OKF Runtime Component
title: OKF Indexer
description: Builds the validated in-memory document, concept, relation, and reference graph.
tags: [indexer, graph, validation, runtime]
relations:
  - type: consumes
    target: okf://okf-mcp/specs/concept-format
  - type: produces
    target: okf://okf-mcp/interfaces/mcp-tools
  - type: configured_by
    target: repo://src/indexer.js
  - type: configured_by
    target: repo://src/project.js
  - type: checked_by
    target: repo://test/okf-mcp.test.js
  - type: checked_by
    target: repo://test/conformance.test.js
---

# OKF Indexer

The indexer loads configured bundle directories, applies include and exclude filters, parses Markdown documents with the safe YAML core schema, and builds a bounded in-memory graph. It keeps separate collections for all documents, valid concepts, reserved resources, edges, warnings, and errors.

Both canonical ids and path-derived URIs resolve through the URI map. Graph operations normalize path aliases to canonical ids before traversal.

Markdown links become `markdown_link` edges. Frontmatter relations become typed `relation` edges. Internal targets are validated, while non-OKF schemes are recorded as external references.

Validation is layered. OKF conformance checks parseable mapping frontmatter, a non-empty concept `type`, and the reserved structures of `index.md` and `log.md`. Unknown fields and unknown type values remain conformant. Project validity additionally covers missing roots, invalid paths, duplicate bundle ids, duplicate concept URIs, unsupported relation types, broken Markdown links, and broken internal targets.

Results expose `conformant`, `validForProject`, and structured diagnostics. `valid` is a compatibility alias for `validForProject`. Valid concepts continue to be served even when other files produce diagnostics.

The [concept format](../specs/concept-format.md) is the input contract. Indexed results power the discovery and graph families in the [MCP tool catalog](../interfaces/mcp-tools.md).
