---
type: "SLO"
title: "SLO: fare-engine quote latency"
description: "99% of fare quotes answered within 80 ms over 28 days."
tags: ["slo", "reliability", "fare-engine"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/fare-engine"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/fare-engine-latency-p99"
    author: "human:davide.colombo"
generated:
  at: "2026-09-25T17:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-05-11T15:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# SLO: fare-engine quote latency

99% of fare quotes answered within 80 ms over 28 days.

Service: [fare-engine](../services/fare-engine.md)

## SLI
Server-side latency of GET /v2/fares/quote measured at the gateway, excluding client time.

## Objective
p99 under 80 ms; p50 under 15 ms. Window 28 days.

## Error budget
0.25% of quotes may exceed 80 ms (about 36,000 per 28 days).

## Alerting
Burn-rate alerts: 14.4x over 1 hour pages; 6x over 6 hours tickets. Dashboard fare-engine/latency.
