---
type: "SLO"
title: "SLO: notification delivery"
description: "99% of transactional notifications delivered to the provider within 60 seconds."
tags: ["slo", "reliability", "notification-hub"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/notification-hub"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/notification-hub-delivery"
    author: "human:davide.colombo"
generated:
  at: "2026-04-03T12:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:davide.colombo"
  at: "2026-06-18T11:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# SLO: notification delivery

99% of transactional notifications delivered to the provider within 60 seconds.

Service: [notification-hub](../services/notification-hub.md)

## SLI
requested_at to provider acceptance for category TRANSACTIONAL.

## Objective
99% within 60 seconds over 28 days; marketing is best effort.

## Error budget
1% of transactional notifications may be late.

## Alerting
Page at 95% for 10 minutes; delivery rate above 5x baseline pages too (storm detection).
