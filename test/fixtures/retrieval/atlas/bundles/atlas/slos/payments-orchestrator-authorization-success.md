---
type: "SLO"
title: "SLO: card authorization success"
description: "Technical authorization success rate above 99.5% (excluding issuer declines), 7 days."
tags: ["slo", "reliability", "payments-orchestrator"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/payments-orchestrator"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/payments-orchestrator-authorization-success"
    author: "human:davide.colombo"
generated:
  at: "2026-02-05T10:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-08-15T09:00:00Z"
status: "stable"
stale_after: "2027-10-31"
---

# SLO: card authorization success

Technical authorization success rate above 99.5% (excluding issuer declines), 7 days.

Service: [payments-orchestrator](../services/payments-orchestrator.md)

## SLI
Authorizations completed at the PSP without a technical error, over attempts, excluding declines by the issuer and 3-D Secure abandonment.

## Objective
99.5% over 7 days.

## Error budget
0.5% technical failures; a PSP incident longer than 50 minutes at peak burns the week.

## Alerting
Page at 98% over 10 minutes; consider the PSP failover flag (ADR-018).
