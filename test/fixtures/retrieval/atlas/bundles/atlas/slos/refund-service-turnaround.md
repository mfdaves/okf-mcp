---
type: "SLO"
title: "SLO: refund turnaround"
description: "95% of refunds completed within 5 working days of the request."
tags: ["slo", "reliability", "refund-service"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/refund-service"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/refund-service-turnaround"
    author: "human:davide.colombo"
generated:
  at: "2026-04-12T09:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-08-21T12:00:00Z"
status: "stable"
stale_after: "2026-09-30"
---

# SLO: refund turnaround

95% of refunds completed within 5 working days of the request.

Service: [refund-service](../services/refund-service.md)

## SLI
Request creation to PaymentRefunded or wallet credit, in working days; approval queue age tracked separately.

## Objective
95% within 5 working days per calendar month.

## Error budget
5% of refunds may exceed 5 days; September 2026 breached because of the stuck queue.

## Alerting
Ticket when approval queue age exceeds 1 hour; page at 24 hours.
