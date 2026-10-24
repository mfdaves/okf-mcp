---
type: "Data Contract"
title: "Tickets API v3 (REST)"
description: "Purchase, list and show tickets and carnets; batch endpoints restricted to the mobile BFF."
tags: ["contract", "api", "biglietti"]
aliases: ["/v3/tickets"]
lang: "en"
channel: "/v3/tickets"
format: "OpenAPI 3.1"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
generated:
  at: "2026-09-08T16:00:00Z"
  by: "process:schema-registry-sync"
status: "stable"
---

# Tickets API v3 (REST)

Purchase, list and show tickets and carnets; batch endpoints restricted to the mobile BFF.

**Kind:** REST API · **Path:** `/v3/tickets` · **Format:** OpenAPI 3.1 · **Owner:** [team-biglietti](../teams/team-biglietti.md)

## Endpoints
- POST /v3/tickets (idempotency-key header required)
- GET /v3/tickets/{id}
- GET /v3/accounts/{id}/tickets?status=
- POST /v3/tickets:batch (BFF only)
- GET /v3/tickets/{id}/qr (rotating payload)

## Compatibility
URL-path versioning (ADR-008); v2 is sunset on 2027-01-31.

## Personal data
Account-scoped; JWT validated by the gateway.

## Retention
Not applicable.

## Notes
Error model follows RFC 9457 problem details.
