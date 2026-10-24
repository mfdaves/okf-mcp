---
type: "SLO"
title: "SLO: wallet balance consistency"
description: "99.99% of wallets reconcile with zero mismatch in the nightly job; projection lag under 1 second p99."
tags: ["slo", "reliability", "wallet-service"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/wallet-service"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/wallet-service-consistency"
    author: "human:davide.colombo"
generated:
  at: "2026-06-02T13:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-07-16T09:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# SLO: wallet balance consistency

99.99% of wallets reconcile with zero mismatch in the nightly job; projection lag under 1 second p99.

Service: [wallet-service](../services/wallet-service.md)

## SLI
Nightly reconciliation mismatches over total active wallets; projection lag from event store append to read model update.

## Objective
99.99% wallets with zero mismatch; lag p99 under 1 second.

## Error budget
About 120 wallets per night may mismatch before the SLO is at risk.

## Alerting
Any duplicate-debit mismatch pages payments on-call regardless of count.
