---
type: "SLO"
title: "SLO: mobile BFF latency"
description: "95% of home-screen aggregations within 300 ms."
tags: ["slo", "reliability", "mobile-bff"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/mobile-bff"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/mobile-bff-latency"
    author: "human:davide.colombo"
generated:
  at: "2026-03-18T07:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:davide.colombo"
  at: "2026-08-08T09:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# SLO: mobile BFF latency

95% of home-screen aggregations within 300 ms.

Service: [mobile-bff](../services/mobile-bff.md)

## SLI
Server-side latency of GET /bff/home (tickets, wallet, nearby predictions).

## Objective
p95 under 300 ms; p99 under 800 ms over 28 days.

## Error budget
5% may exceed 300 ms.

## Alerting
Page at p95 over 600 ms for 10 minutes; check Redis cache hit ratio first.
