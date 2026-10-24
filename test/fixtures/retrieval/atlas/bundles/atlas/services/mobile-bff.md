---
type: "Service"
title: "mobile-bff"
description: "Backend-for-frontend of the iOS and Android apps: aggregates tickets, wallet, planner and predictions."
tags: ["service", "piattaforma"]
aliases: ["mobile-bff"]
lang: "en"
runtime: "Node.js 22 / NestJS, Redis"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
  - type: "consumes"
    target: "okf://atlas/contracts/arrival-prediction-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/redis"
  - type: "depends_on"
    target: "okf://atlas/dependencies/kong-gateway"
  - type: "measured_by"
    target: "okf://atlas/slos/mobile-bff-latency"
generated:
  at: "2026-02-01T08:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:davide.colombo"
  at: "2026-10-27T07:00:00Z"
status: "stable"
---

# mobile-bff

mobile-bff composes the screens of the apps from the tickets API, the wallet read model, the planner and the predictions cache, and adapts them per app version. It is the only caller allowed to use the batch endpoints of the tickets API. Responses are cached in Redis for 5 seconds per user to absorb pull-to-refresh storms.

## Ownership and runtime
Team: [team-piattaforma](../teams/team-piattaforma.md) · Runtime: Node.js 22 / NestJS, Redis

## Interfaces
- Consumes [arrival-prediction-v1](../contracts/arrival-prediction-v1.md)

## Dependencies
- [redis](../dependencies/redis.md)
- [kong-gateway](../dependencies/kong-gateway.md)

## Operational notes
App versions older than 12 months are refused with a forced-update response.

- SLO: [mobile-bff-latency](../slos/mobile-bff-latency.md)
