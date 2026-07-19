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
---

# MCP Stdio Server

The MCP server reads newline-delimited JSON-RPC messages from stdin and writes responses to stdout. It implements initialization, resource listing and reading, tool listing, and tool calls without an SDK dependency. Initialization accepts only an explicit supported protocol version and rejects unsupported client versions instead of echoing them.

Each indexed Markdown document is exposed as a `text/markdown` resource. The [MCP tool catalog](../interfaces/mcp-tools.md) exposes discovery, search, graph navigation, validation, remote loading, and proposal-based authoring.

Bundle mode is read oriented. Project mode loads `okf.project.yaml`, enables configured relation types, and supplies the store required by the [authoring workflow](../workflows/concept-authoring.md). Proposal mutation tools remain disabled unless the server starts with `--authoring`. Runtime remote loading remains disabled unless it starts with `--allow-remote-tool`.

Remote GitHub bundles are fetched as Markdown and added to the in-memory index. They remain read only and never execute remote code. After an accepted local proposal, one reconstruction path rebuilds the index from configured local bundles, configured remote bundles, and runtime-loaded remote bundles, preserving remote concepts and relationships.

This component is a stdio MCP transport. The separate [HTTP authoring API](../interfaces/http-authoring-api.md) does not implement MCP over HTTP.
