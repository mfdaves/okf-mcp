---
id: okf://okf-mcp/runtime/mcp-server
type: OKF Runtime Component
title: MCP Server
description: SDK-backed MCP runtime exposing OKF resources and tools over stdio and Streamable HTTP, one call queue per process.
tags:
  - mcp
  - stdio
  - json-rpc
  - runtime
  - http
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/indexer
  - type: depends_on
    target: okf://okf-mcp/interfaces/mcp-tools
  - type: depends_on
    target: okf://okf-mcp/workflows/concept-authoring
  - type: depends_on
    target: okf://okf-mcp/runtime/producer-host
  - type: configured_by
    target: repo://src/mcp-server.js
  - type: checked_by
    target: repo://test/okf-mcp.test.js
  - type: checked_by
    target: repo://test/mcp-hardening.test.js
  - type: checked_by
    target: repo://test/mcp-sdk.test.js
  - type: checked_by
    target: repo://test/producer.test.js
generated:
  by: anthropic/claude-code
  at: 2026-11-14T17:33:39.682Z
---

# MCP Server

The MCP server exposes OKF resources and tools through the official `@modelcontextprotocol/server` v2 SDK, over stdio by default and over Streamable HTTP with `mcp --http` (the [MCP HTTP transport](../interfaces/mcp-http.md)). The application adapter registers the existing schemas and handlers; the SDK owns framing, negotiation, validation, and dispatch.

On both transports the SDK serves the modern `2026-07-28` revision and its compatibility path for 2025-era clients, including `2025-11-25`, stateless over HTTP. All paths expose the same OKF resources, schemas, and application behavior.

The SDK validates protocol messages and tool arguments before application dispatch. Expected application failures return tool results with `isError: true`; unexpected implementation failures are masked. Stdout remains reserved for protocol messages.

Each indexed Markdown document is exposed as a `text/markdown` resource. The [MCP tool catalog](../interfaces/mcp-tools.md) exposes discovery, search, graph navigation, validation, remote loading, configured producer preview/run, proposal-based authoring, and explicitly gated live batch validation/apply.

Root mode is the normal single-catalog interface and can supply the local store used by the [authoring workflow](../workflows/concept-authoring.md). Project mode remains an optional federation/configuration extension and is required for producer instances. Configured projects expose static producer discovery and read-only preview; producer run and live batch tools remain disabled unless the server starts with `--write --actor <actor>`. Proposal mutation tools remain disabled unless it starts with `--authoring`; runtime remote loading remains disabled unless it starts with `--allow-remote-tool`. Every call runs for a principal whose scopes decide the available tools: over stdio it comes from the flags (`--actor`, and `okf.write` only with `--write`). One server state, and one call queue, backs every server instance in the process.

Remote GitHub bundles are fetched as Markdown and added to the in-memory index. They remain read only and never execute remote code. After an accepted local proposal, one reconstruction path rebuilds the index from configured local bundles, configured remote bundles, and runtime-loaded remote bundles, preserving remote concepts and relationships. The lexical search index is cached against that reconstructed OKF index, so the next query builds a fresh per-server BM25+ view without global or persisted state.

The separate [HTTP authoring API](../interfaces/http-authoring-api.md) is a REST interface for proposals, not MCP.
