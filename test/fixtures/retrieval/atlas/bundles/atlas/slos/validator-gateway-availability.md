---
type: "SLO"
title: "SLO: validator-gateway availability"
description: "99.95% of validator MQTT sessions accepted and events acknowledged, 28 days."
tags: ["slo", "reliability", "validator-gateway"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/validator-gateway"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/validator-gateway-availability"
    author: "human:davide.colombo"
generated:
  at: "2026-01-22T10:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:davide.colombo"
  at: "2026-08-04T16:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# SLO: validator-gateway availability

99.95% of validator MQTT sessions accepted and events acknowledged, 28 days.

Service: [validator-gateway](../services/validator-gateway.md)

## SLI
Share of 1-minute windows in which at least 99% of connected validators received an acknowledgement for their publishes.

## Objective
99.95% of minutes per 28 days (21 minutes of budget).

## Error budget
21 minutes per 28 days; INC-2026-001 consumed 10 months of budget in one morning.

## Alerting
Page when 5 consecutive minutes fail; the offline queue hides the impact from riders, not from caps and inspections.
