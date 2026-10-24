---
type: "SLO"
title: "SLO: trip planner latency"
description: "95% of plans answered within 150 ms; 99.9% availability."
tags: ["slo", "reliability", "trip-planner"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/trip-planner"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/trip-planner-latency"
    author: "human:davide.colombo"
generated:
  at: "2026-03-27T08:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-10-26T08:00:00Z"
status: "stable"
stale_after: "2026-05-31"
---

# SLO: trip planner latency

95% of plans answered within 150 ms; 99.9% availability.

Service: [trip-planner](../services/trip-planner.md)

## SLI
Server-side latency of GET /v1/planner/plan; availability as non-5xx share.

## Objective
p95 under 150 ms; availability 99.9% over 28 days.

## Error budget
5% of plans may exceed 150 ms; 43 minutes of unavailability.

## Alerting
Page at p95 over 400 ms for 10 minutes or availability under 99% for 5 minutes (the DDoS tripped both).
