---
type: "SLO"
title: "SLO: validator-gateway ingest latency"
description: "95% of validations published to Kafka within 2 seconds of receipt (online devices)."
tags: ["slo", "reliability", "validator-gateway"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/validator-gateway"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/validator-gateway-ingest-latency"
    author: "human:davide.colombo"
generated:
  at: "2026-08-19T15:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:davide.colombo"
  at: "2026-07-23T16:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# SLO: validator-gateway ingest latency

95% of validations published to Kafka within 2 seconds of receipt (online devices).

Service: [validator-gateway](../services/validator-gateway.md)

## SLI
received_at to Kafka append time for events with delayed=false.

## Objective
p95 under 2 seconds, 28 days; baseline 400 ms.

## Error budget
5% of online validations may exceed 2 seconds.

## Alerting
Ticket at p95 over 1 second for 30 minutes; page at 2 seconds for 10 minutes (scale with the runbook).
