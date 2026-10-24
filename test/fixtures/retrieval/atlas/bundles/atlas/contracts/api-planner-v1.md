---
type: "Data Contract"
title: "Planner API v1 (REST)"
description: "Journey planning between coordinates or stops with departure or arrival time."
tags: ["contract", "api", "mobilita"]
aliases: ["/v1/planner"]
lang: "en"
channel: "/v1/planner"
format: "OpenAPI 3.1"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-mobilita"
generated:
  at: "2026-07-07T12:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:sara.greco"
  at: "2026-06-22T08:00:00Z"
status: "stable"
---

# Planner API v1 (REST)

Journey planning between coordinates or stops with departure or arrival time.

**Kind:** REST API · **Path:** `/v1/planner` · **Format:** OpenAPI 3.1 · **Owner:** [team-mobilita](../teams/team-mobilita.md)

## Endpoints
- GET /v1/planner/plan?from=&to=&depart_at=|arrive_by=
- GET /v1/planner/stops/nearby?lat=&lon=

## Compatibility
URL-path versioning.

## Personal data
Coordinates are not stored.

## Retention
Not applicable.

## Notes
Public, rate limited to 60 requests per minute per IP; the storefront DDoS hit this endpoint.
