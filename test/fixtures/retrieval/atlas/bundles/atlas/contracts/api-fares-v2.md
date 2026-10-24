---
type: "Data Contract"
title: "Fares API v2 (REST)"
description: "Quote a journey price and list zones and time bands."
tags: ["contract", "api", "biglietti"]
aliases: ["/v2/fares"]
lang: "en"
channel: "/v2/fares"
format: "OpenAPI 3.1"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
generated:
  at: "2026-02-03T08:00:00Z"
  by: "process:schema-registry-sync"
status: "stable"
---

# Fares API v2 (REST)

Quote a journey price and list zones and time bands.

**Kind:** REST API · **Path:** `/v2/fares` · **Format:** OpenAPI 3.1 · **Owner:** [team-biglietti](../teams/team-biglietti.md)

## Endpoints
- GET /v2/fares/quote?from=&to=&at=
- GET /v2/zones
- GET /v2/fare-tables/{version}

## Compatibility
URL-path versioning; quotes are cacheable for 60 seconds.

## Personal data
None.

## Retention
Not applicable.

## Notes
Served by fare-engine; the quote endpoint is the one measured by the latency SLO.
