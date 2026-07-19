---
id: okf://okf-mcp/overview/okf-mcp
type: OKF Product
title: okf-mcp
description: Project-agnostic OKF CLI, graph index, MCP stdio server, and proposal-based authoring runtime.
tags: [okf, mcp, runtime, knowledge-graph]
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/mcp-server
  - type: depends_on
    target: okf://okf-mcp/runtime/indexer
  - type: related_to
    target: okf://okf-mcp/interfaces/http-authoring-api
  - type: produces
    target: okf://okf-mcp/distribution/reference-bundle
  - type: configured_by
    target: repo://package.json
---

# okf-mcp

`okf-mcp` turns directories of OKF Markdown concepts into a searchable in-memory knowledge graph. It provides a command-line interface, a JSON-RPC stdio MCP server, generator plugins, remote GitHub bundles, and an optional HTTP authoring API.

The core has no runtime dependencies, database, or embedding service. Local bundle mode performs no network calls. Project mode adds configuration, typed relations, proposal storage, and guarded writes to local bundle directories.

The primary runtime entry is the [MCP stdio server](../runtime/mcp-server.md). Concept interpretation and graph construction belong to the [indexer](../runtime/indexer.md). Durable knowledge changes follow the [concept authoring workflow](../workflows/concept-authoring.md) and [authoring safety policy](../policies/authoring-safety.md).

The HTTP server is an authoring API rather than a remotely hosted MCP transport. The canonical public architectural reference is this [published reference bundle](../distribution/reference-bundle.md).
