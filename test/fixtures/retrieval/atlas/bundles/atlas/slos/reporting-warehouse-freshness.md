---
type: "SLO"
title: "SLO: operator dashboard freshness"
description: "Operator dashboards show data at most 15 minutes old during service hours (05:00-01:00)."
tags: ["slo", "reliability", "reporting-warehouse"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/reporting-warehouse"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/reporting-warehouse-freshness"
    author: "human:davide.colombo"
generated:
  at: "2026-02-17T07:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-07-06T10:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# SLO: operator dashboard freshness

Operator dashboards show data at most 15 minutes old during service hours (05:00-01:00).

Service: [reporting-warehouse](../services/reporting-warehouse.md)

## SLI
Difference between now and the newest validated_at in the ridership mart.

## Objective
99% of 5-minute checks under 15 minutes over 28 days.

## Error budget
About 2 hours of staleness per 28 days.

## Alerting
Ticket at 30 minutes; page at 60 minutes (INC-2026-018 would have paged at 03:10 instead of 06:00).
