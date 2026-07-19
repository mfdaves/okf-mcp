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
  - type: checked_by
    target: repo://test/mcp-hardening.test.js
---

# MCP Tool Catalog

The MCP interface groups tools by intent.

Discovery tools list bundles, concepts, types, tags, relation types, and loaded remote bundles. `get_concept` returns the complete frontmatter and Markdown body for one concept. `search_concepts` combines text ranking with structured filters.

Graph tools return bounded graphs, neighbors, subgraphs, paths, summaries, and rendered exports. Canonical and path-derived concept URIs are accepted for direct graph traversal.

Validation tools inspect bundles, projects, and candidate concepts without writing. They report OKF conformance separately from project validity. Remote loading fetches a public GitHub tree into the in-memory index.

Project mode exposes read-only candidate validation, path suggestion, and proposal inspection helpers. Proposal creation, acceptance, and rejection additionally require `--authoring`. Runtime calls to `load_remote_bundle` require `--allow-remote-tool`; configured remote bundles remain readable without that flag.

Every tool supplies a purpose-specific description, descriptions for all input parameters, and MCP annotations for read behavior, destructive behavior, idempotency, and external access. Tool discovery and direct invocation use the same capability checks, so a hidden tool also fails when called by name. Annotations remain hints to clients; server-side validation is authoritative.

Tool arguments are validated against the advertised schema without coercion. Unknown or disabled tools and malformed call envelopes are protocol errors. Once a known enabled tool receives a structurally valid call, expected validation, storage, network, read-only, and proposal-conflict failures are returned as tool results with `isError: true`. A validation operation that successfully reports invalid OKF remains a successful tool result.

`list_concepts` applies its optional text query together with its structured filters. Relation-type filtering selects concepts with an outgoing relation of the requested type.
