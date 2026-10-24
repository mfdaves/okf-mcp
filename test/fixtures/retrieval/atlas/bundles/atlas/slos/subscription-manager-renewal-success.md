---
type: "SLO"
title: "SLO: subscription renewal correctness"
description: "100% of due renewals executed exactly once within the renewal day."
tags: ["slo", "reliability", "subscription-manager"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/subscription-manager"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/subscription-manager-renewal-success"
    author: "human:davide.colombo"
generated:
  at: "2026-03-21T09:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-20T13:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# SLO: subscription renewal correctness

100% of due renewals executed exactly once within the renewal day.

Service: [subscription-manager](../services/subscription-manager.md)

## SLI
Renewals executed per subscription per period compared with renewals due.

## Objective
Exactly one renewal per due subscription per period; 99.9% executed within the day.

## Error budget
Zero budget for duplicates (INC-2026-027); 0.1% may slip a day.

## Alerting
Any duplicate renewal pages team biglietti; missing renewals ticket at 08:00.
