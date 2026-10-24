---
type: "Post-mortem"
title: "Post-mortem INC-2026-004: non-idempotent wallet command handler"
description: "Why a consumer rebalance produced 2,340 duplicate debits and what changed."
tags: ["post-mortem", "postmortem", "incident-review"]
lang: "en"
relations:
  - type: "documents"
    target: "okf://atlas/incidents/inc-2026-004-wallet-double-charge"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-004"
    author: "process:incident-sync"
  - id: "wiki"
    resource: "https://wiki.tessera.internal/postmortems/pm-2026-004-wallet-double-charge"
generated:
  at: "2026-08-01T09:00:00Z"
  by: "human:giorgio.leone"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-09T11:00:00Z"
status: "stable"
---

# Post-mortem INC-2026-004: non-idempotent wallet command handler

Incident: [inc-2026-004-wallet-double-charge](../incidents/inc-2026-004-wallet-double-charge.md)

## Summary
A deployment caused a Kafka consumer-group rebalance; commands between the last committed offset and the rebalance were reprocessed and the debit handler, which keyed nothing on the payment id, emitted a second debit event per command.

## Contributing factors
- Idempotency was assumed from exactly-once semantics that Kafka does not provide across a database write.
- Offsets were committed before the event store write.
- The reconciliation that would have caught it ran weekly.

## What went well
The event-sourced model made the reversal exact: every duplicate event could be identified and reversed with its original amount within two hours.

## Action items
1. Idempotency key on every command handler, enforced by a shared library (done).
2. Commit offsets after the event store write (done).
3. Daily reconciliation of debits against FareComputed (done).
4. Chaos test killing a consumer mid-batch in CI (done).

## Lessons
At-least-once delivery is the contract; idempotency is the consumer's job, every time.
