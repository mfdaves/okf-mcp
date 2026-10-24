---
type: "Runbook"
title: "Scale the validator gateway for events and queue drains"
description: "Raise replicas and broker limits before fairs, derby days and queue drains; return to baseline after."
tags: ["runbook", "operations", "validator-gateway"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/validator-gateway"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/scale-validator-gateway"
generated:
  at: "2025-10-03T07:00:00Z"
  by: "human:andrea.moretti"
verified:
  by: "human:davide.colombo"
  at: "2026-05-18T13:00:00Z"
status: "stable"
stale_after: "2026-05-31"
---

# Scale the validator gateway for events and queue drains

Raise replicas and broker limits before fairs, derby days and queue drains; return to baseline after.

Services: [validator-gateway](../services/validator-gateway.md)

## When to use
Expected validation peak above 2x baseline (events published by the operators) or before a queue drain.

## Prerequisites
Platform on-call; the event calendar from the operators; broker connection limits.

## Steps
1. Raise the gateway deployment from 3 to 6 replicas and the Mosquitto max connections per node by 50%.
2. Confirm Redis de-duplication memory headroom (keys expire after 72 hours).
3. Watch ingest latency p95; baseline is 400 ms, alert at 2 seconds.
4. After the event, scale back to 3 replicas once the connection count is at baseline for 1 hour.

## Rollback
Scale back immediately if Redis memory exceeds 80%; the broker buffers for the duration.

## Escalation
Platform on-call; team biglietti for fare and cap effects of delayed events.
