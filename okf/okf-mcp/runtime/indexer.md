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
  - type: checked_by
    target: repo://test/directory-links.test.js
---

# OKF Indexer

The indexer normally loads one OKF root, validates UTF-8, parses YAML with the safe core schema, parses body structure with CommonMark, and builds an in-memory graph. Its optional workspace mode can load several roots with include and exclude filters. It keeps separate collections for documents, concepts, reserved resources, explicitly referenced assets, edges, warnings, and errors.

Portable identities are extensionless path-derived Concept IDs. `.md`, custom-id, and workspace-scoped `okf://` locators resolve through compatibility maps; ambiguous bare IDs require a scoped locator.

Markdown links and extension relations remain `markdown_link` and `relation` edges. Standard v0.2 fields add `resource`, `source`, `computation`, `executor`, and `attester` edges. Safe bundle-local artifacts are registered only when explicitly referenced, with byte limits, symlink rejection, MIME classification, and SHA256; content is never executed.

Markdown targets resolve to an exact document first. When no exact document exists, a directory link resolves to that directory's reserved `index.md`. This rule is shared by local indexing, remote indexing, and authoring candidate validation, so the resulting edge uses the nested index document's canonical URI.

Validation is layered. OKF conformance checks UTF-8, parseable mapping frontmatter, a non-empty string `type`, and reserved structures. Optional v0.2 family problems are advisories. Project validity covers path and identity integrity, relation vocabulary, and internal targets; broken Markdown links invalidate only under `strictLinks`.

Remote loading is two-pass: selected Markdown is parsed first, then only referenced local assets are fetched. Revision and blob metadata, digests, counts, and unresolved references remain attached to the read-only bundle.

Results expose `conformant`, `validForProject`, and structured diagnostics. `valid` is a compatibility alias for `validForProject`. Valid concepts continue to be served even when other files produce diagnostics.

The [concept format](../specs/concept-format.md) is the input contract. Indexed results power the discovery and graph families in the [MCP tool catalog](../interfaces/mcp-tools.md).
