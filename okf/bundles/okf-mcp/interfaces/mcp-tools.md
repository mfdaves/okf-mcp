---
id: okf://okf-mcp/interfaces/mcp-tools
type: OKF Interface
title: MCP Tool Catalog
description: Agent-facing tool contract for discovery, graph navigation, validation, remote loading, and authoring.
tags: [mcp, tools, interface, agents]
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/mcp-server
  - type: consumes
    target: okf://okf-mcp/runtime/indexer
  - type: related_to
    target: okf://okf-mcp/workflows/concept-authoring
  - type: configured_by
    target: repo://src/mcp-server.js
  - type: checked_by
    target: repo://test/okf-mcp.test.js
---

# MCP Tool Catalog

The MCP interface groups tools by intent.

Discovery tools list bundles, concepts, types, tags, relation types, and loaded remote bundles. `get_concept` returns the complete frontmatter and Markdown body for one concept. `search_concepts` combines text ranking with structured filters.

Graph tools return bounded graphs, neighbors, subgraphs, paths, summaries, and rendered exports. Canonical and path-derived concept URIs are accepted for direct graph traversal.

Validation tools inspect bundles, projects, and candidate concepts without writing. Remote loading fetches a public GitHub tree into the in-memory index.

Authoring tools validate, suggest paths, propose concepts or updates, inspect proposals, and accept or reject reviewed changes. They require project mode because only a project identifies writable bundles.

Every tool supplies a purpose-specific description, descriptions for all input parameters, and MCP annotations for read behavior, destructive behavior, idempotency, and external access. These annotations are hints to clients; server-side validation remains authoritative.
