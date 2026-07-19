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
---

# MCP Stdio Server

The MCP server reads newline-delimited JSON-RPC messages from stdin and writes responses to stdout. It implements initialization, resource listing and reading, tool listing, and tool calls without an SDK dependency.

Each indexed Markdown document is exposed as a `text/markdown` resource. The [MCP tool catalog](../interfaces/mcp-tools.md) exposes discovery, search, graph navigation, validation, remote loading, and proposal-based authoring.

Bundle mode is read oriented. Project mode loads `okf.project.yaml`, enables configured relation types, and supplies the writable store required by the [authoring workflow](../workflows/concept-authoring.md). Accepted proposals refresh the in-memory index immediately.

Remote GitHub bundles are fetched as Markdown and added to the in-memory index. They remain read only and never execute remote code.

This component is a stdio MCP transport. The separate [HTTP authoring API](../interfaces/http-authoring-api.md) does not implement MCP over HTTP.
