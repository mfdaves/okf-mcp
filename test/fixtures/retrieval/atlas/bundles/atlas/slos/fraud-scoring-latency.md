---
type: "SLO"
title: "SLO: fraud scoring latency"
description: "99% of validations scored within 500 ms so that blocks reach inspectors before the next stop."
tags: ["slo", "reliability", "fraud-scoring"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/fraud-scoring"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/fraud-scoring-latency"
    author: "human:davide.colombo"
generated:
  at: "2026-07-26T07:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-02T16:00:00Z"
status: "stable"
stale_after: "2026-07-31"
---

# SLO: fraud scoring latency

99% of validations scored within 500 ms so that blocks reach inspectors before the next stop.

Service: [fraud-scoring](../services/fraud-scoring.md)

## SLI
TicketValidated receipt to FraudScore publish.

## Objective
p99 under 500 ms over 28 days.

## Error budget
1% of scores may be late; late scores never block retroactively.

## Alerting
Ticket at p99 over 300 ms; page at 1 second for 10 minutes.
