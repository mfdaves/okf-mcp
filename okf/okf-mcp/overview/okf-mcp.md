---
id: okf://okf-mcp/overview/okf-mcp
type: OKF Product
title: okf-mcp
description: Project-agnostic OKF CLI, graph index, MCP stdio server, validated producer host, and authoring runtime.
tags: [okf, mcp, runtime, knowledge-graph]
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/mcp-server
  - type: depends_on
    target: okf://okf-mcp/runtime/indexer
  - type: depends_on
    target: okf://okf-mcp/runtime/producer-host
  - type: related_to
    target: okf://okf-mcp/interfaces/http-authoring-api
  - type: produces
    target: okf://okf-mcp/distribution/reference-bundle
  - type: configured_by
    target: repo://package.json
---

# okf-mcp

`okf-mcp` turns one OKF v0.2 root and its explicitly referenced inert assets into a searchable in-memory knowledge graph. It provides a CLI, SDK-backed stdio MCP server, pinned Git-source reads, optional workspace federation, built-in generator plugins, configured external producers, remote GitHub bundles, and an HTTP authoring API.

The runtime uses `js-yaml`, CommonMark, and a process-local MiniSearch BM25+ text index. It has no database, embedding service, computation executor, attester runtime, or build step. `--root` is the normal single-catalog interface and performs no network calls. The optional project manifest federates multiple roots and generator configuration; it is an okf-mcp extension rather than part of OKF v0.2.

The primary runtime entry is the [MCP stdio server](../runtime/mcp-server.md). Concept interpretation and graph construction belong to the [indexer](../runtime/indexer.md). Configured metadata sources run through the [producer host](../runtime/producer-host.md) and its [publication workflow](../workflows/producer-publication.md). Durable knowledge changes follow the [concept authoring workflow](../workflows/concept-authoring.md) and [authoring safety policy](../policies/authoring-safety.md).

The HTTP server is an authoring API rather than a remotely hosted MCP transport. The canonical public architectural reference is this [published reference bundle](../distribution/reference-bundle.md), shipped with the npm package and described for discovery by the MCP Registry metadata.
