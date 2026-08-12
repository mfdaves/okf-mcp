---
id: okf://okf-mcp/runtime/mcp-server
type: OKF Runtime Component
title: MCP Stdio Server
description: JSON-RPC stdio MCP runtime exposing OKF resources and tools.
tags: [mcp, stdio, json-rpc, runtime]
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/indexer
  - type: depends_on
    target: okf://okf-mcp/interfaces/mcp-tools
  - type: depends_on
    target: okf://okf-mcp/workflows/concept-authoring
  - type: configured_by
    target: repo://src/mcp-server.js
  - type: checked_by
    target: repo://test/okf-mcp.test.js
  - type: checked_by
    target: repo://test/mcp-hardening.test.js
  - type: checked_by
    target: repo://test/mcp-sdk.test.js
---

# MCP Stdio Server

The MCP server exposes OKF resources and tools over stdio through the official `@modelcontextprotocol/server` v2 SDK. The application adapter registers the existing schemas and handlers; the SDK owns framing, negotiation, validation, and dispatch.

The SDK serves the modern `2026-07-28` revision and its compatibility path for 2025-era clients, including `2025-11-25`. Both paths expose the same OKF resources, enabled tools, schemas, and application behavior.

The SDK validates protocol messages and tool arguments before application dispatch. Expected application failures return tool results with `isError: true`; unexpected implementation failures are masked. Stdout remains reserved for protocol messages.

Each indexed Markdown document is exposed as a `text/markdown` resource. The [MCP tool catalog](../interfaces/mcp-tools.md) exposes discovery, search, graph navigation, validation, remote loading, and proposal-based authoring.

Root mode is the normal single-catalog interface and can supply the local store used by the [authoring workflow](../workflows/concept-authoring.md). Project mode remains an optional federation/configuration extension. Proposal mutation tools remain disabled unless the server starts with `--authoring`; runtime remote loading remains disabled unless it starts with `--allow-remote-tool`.

Remote GitHub bundles are fetched as Markdown and added to the in-memory index. They remain read only and never execute remote code. After an accepted local proposal, one reconstruction path rebuilds the index from configured local bundles, configured remote bundles, and runtime-loaded remote bundles, preserving remote concepts and relationships.

This component is a stdio MCP transport. The separate [HTTP authoring API](../interfaces/http-authoring-api.md) does not implement MCP over HTTP.
