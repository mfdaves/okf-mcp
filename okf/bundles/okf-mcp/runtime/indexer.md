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
---

# OKF Indexer

The indexer loads configured bundle directories, applies include and exclude filters, parses Markdown documents, and builds a bounded in-memory graph. It keeps separate collections for all documents, valid concepts, reserved resources, edges, warnings, and errors.

Both canonical ids and path-derived URIs resolve through the URI map. Graph operations normalize path aliases to canonical ids before traversal.

Markdown links become `markdown_link` edges. Frontmatter relations become typed `relation` edges. Internal targets are validated, while non-OKF schemes are recorded as external references.

Validation is deliberately partial: valid concepts continue to be served even when other files produce warnings or errors. Project validation reports missing roots, invalid paths, duplicate bundle ids, duplicate concept URIs, unsupported relation types, and broken internal targets.

The [concept format](../specs/concept-format.md) is the input contract. Indexed results power the discovery and graph families in the [MCP tool catalog](../interfaces/mcp-tools.md).
