---
type: "Service"
title: "trip-planner"
description: "Door-to-door journey planning over the regional GTFS network with real-time adjustments."
tags: ["service", "mobilita"]
aliases: ["trip-planner"]
lang: "en"
runtime: "Rust 1.80, in-memory transit graph"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-mobilita"
  - type: "consumes"
    target: "okf://atlas/contracts/gtfs-feed-manifest-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/arrival-prediction-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/redis"
  - type: "measured_by"
    target: "okf://atlas/slos/trip-planner-latency"
  - type: "implements"
    target: "okf://atlas/contracts/api-planner-v1"
generated:
  at: "2026-07-01T13:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# trip-planner

trip-planner implements a RAPTOR-based router (ADR-005) over the merged GTFS of all regional operators, with walking legs from OpenStreetMap and real-time delays from the predictions service. The graph is rebuilt in memory on every GTFS release and swapped atomically; a release that fails validation keeps the previous graph. It serves the planner API v1 to the BFF and the storefront.

## Ownership and runtime
Team: [team-mobilita](../teams/team-mobilita.md) · Runtime: Rust 1.80, in-memory transit graph

## Interfaces
- Exposes [api-planner-v1](../contracts/api-planner-v1.md)
- Consumes [gtfs-feed-manifest-v1](../contracts/gtfs-feed-manifest-v1.md)
- Consumes [arrival-prediction-v1](../contracts/arrival-prediction-v1.md)

## Dependencies
- [redis](../dependencies/redis.md)

## Operational notes
Memory per replica is 6 GB with the full regional network; the SSR cost question for the storefront is partly about planner calls.

- SLO: [trip-planner-latency](../slos/trip-planner-latency.md)
