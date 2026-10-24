---
type: "SLO"
title: "SLO: API gateway availability"
description: "99.95% of requests not failed by the gateway itself (5xx from Kong, TLS errors), 28 days."
tags: ["slo", "reliability", "api-gateway"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/api-gateway"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/api-gateway-availability"
    author: "human:davide.colombo"
generated:
  at: "2026-02-01T08:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-10-10T16:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# SLO: API gateway availability

99.95% of requests not failed by the gateway itself (5xx from Kong, TLS errors), 28 days.

Service: [api-gateway](../services/api-gateway.md)

## SLI
Gateway-originated errors over total requests, per hostname.

## Objective
99.95% per public hostname.

## Error budget
21 minutes per hostname per 28 days; the partner hostname expiry consumed 4 hours.

## Alerting
Synthetic TLS check per hostname every minute; page on 3 failures.
