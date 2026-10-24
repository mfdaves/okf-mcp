---
type: "Service"
title: "realtime-predictions"
description: "Predicts arrival times at stops from vehicle positions, schedule and historical delays."
tags: ["service", "mobilita"]
aliases: ["realtime-predictions"]
lang: "en"
runtime: "Python 3.12, ONNX Runtime, Redis"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-mobilita"
  - type: "produces"
    target: "okf://atlas/contracts/arrival-prediction-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/vehicle-position-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/gtfs-feed-manifest-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/onnx-runtime"
  - type: "depends_on"
    target: "okf://atlas/dependencies/redis"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/realtime-predictions-accuracy"
generated:
  at: "2026-02-27T12:00:00Z"
  by: "process:catalog-sync"
status: "draft"
---

# realtime-predictions

realtime-predictions joins VehiclePosition events with the active GTFS schedule and a gradient-boosted model of historical delays per route segment, and publishes ArrivalPrediction events consumed by the trip planner and the mobile BFF. The model is retrained weekly from the warehouse. The service is new (September 2026) and still in draft status in this catalog: prediction accuracy has an SLO but no alert yet.

## Ownership and runtime
Team: [team-mobilita](../teams/team-mobilita.md) · Runtime: Python 3.12, ONNX Runtime, Redis

## Interfaces
- Produces [arrival-prediction-v1](../contracts/arrival-prediction-v1.md)
- Consumes [vehicle-position-v1](../contracts/vehicle-position-v1.md)
- Consumes [gtfs-feed-manifest-v1](../contracts/gtfs-feed-manifest-v1.md)

## Dependencies
- [onnx-runtime](../dependencies/onnx-runtime.md)
- [redis](../dependencies/redis.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
Replaces the vendor predictions bought with the AVL hardware, whose contract ends in 2027.

- SLO: [realtime-predictions-accuracy](../slos/realtime-predictions-accuracy.md)
