---
id: okf://okf-mcp/interfaces/http-authoring-api
type: OKF Interface
title: HTTP Authoring API
description: Optional local HTTP interface for validation and proposal-based concept authoring.
tags: [http, api, authoring, interface]
relations:
  - type: depends_on
    target: okf://okf-mcp/workflows/concept-authoring
  - type: checked_by
    target: okf://okf-mcp/policies/authoring-safety
  - type: configured_by
    target: repo://src/http-server.js
  - type: checked_by
    target: repo://test/okf-mcp.test.js
---

# HTTP Authoring API

The optional HTTP server exposes health, bundle discovery, candidate validation, path suggestion, proposal inspection, proposal creation, proposal update, acceptance, and rejection.

Mutation endpoints require an exact bearer token supplied through `OKF_WRITE_TOKEN` or the CLI option. Validation and read endpoints do not mutate concept files.

The API delegates all authoring behavior to the same service and file store used by MCP project mode. Proposal acceptance therefore uses the same validation, identity, revision, and path safeguards described by the [authoring safety policy](../policies/authoring-safety.md).

The default listener is local. This API is not an MCP Streamable HTTP transport, authentication service, hosted multi-tenant control plane, or distributed storage layer. Public deployment requires additional transport, identity, TLS, persistence, and concurrency design.
