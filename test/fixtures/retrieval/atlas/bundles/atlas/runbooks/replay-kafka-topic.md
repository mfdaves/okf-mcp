---
type: "Runbook"
title: "Replay a Kafka topic into a consumer"
description: "Reset a consumer group to an offset or timestamp and replay events safely."
tags: ["runbook", "operations", "validation-ledger", "reporting-warehouse"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/validation-ledger"
  - type: "runbook_for"
    target: "okf://atlas/services/reporting-warehouse"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/replay-kafka-topic"
generated:
  at: "2026-07-10T12:00:00Z"
  by: "human:andrea.moretti"
status: "stable"
stale_after: "2026-01-31"
---

# Replay a Kafka topic into a consumer

Reset a consumer group to an offset or timestamp and replay events safely.

Services: [validation-ledger](../services/validation-ledger.md), [reporting-warehouse](../services/reporting-warehouse.md)

## When to use
A consumer lost or corrupted its state (ledger partition rebuilt, warehouse table dropped) or a bug skipped events. Not for lag: lag recovers alone.

## Prerequisites
Consumer is idempotent on its key (ledger: device_id + sequence; warehouse: ReplacingMergeTree). Change window approved by the owning team. kafka-consumer-groups access from the ops bastion.

## Steps
1. Stop every instance of the consumer (scale the deployment to 0).
2. `kafka-consumer-groups --group <group> --topic <topic> --reset-offsets --to-datetime <ISO> --execute`.
3. Scale the consumer back to 1 replica, watch lag and error rate for 10 minutes.
4. Scale to the normal replica count.
5. Record the replay window in the incident or change ticket.

## Rollback
Reset offsets back to the saved values printed by `--dry-run` in step 2; if duplicates were produced downstream, run the consumer's reconciliation job.

## Escalation
Platform on-call for broker issues; owning team for data correctness. Replays over 24 hours need the data lead's approval.
