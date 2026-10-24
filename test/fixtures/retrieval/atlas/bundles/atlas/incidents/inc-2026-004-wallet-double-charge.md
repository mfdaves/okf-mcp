---
type: "Incident"
title: "INC-2026-004: Duplicate wallet debits after a Kafka rebalance"
description: "2,340 wallets were debited twice for the same journey after a consumer-group rebalance replayed commands."
tags: ["incident", "sev2", "wallet-service"]
aliases: ["INC-2026-004"]
lang: "en"
severity: "SEV2"
occurred_on: "2026-02-19"
relations:
  - type: "affects"
    target: "okf://atlas/services/wallet-service"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/wallet-balance-reconciliation"
  - type: "documented_in"
    target: "okf://atlas/postmortems/pm-2026-004-wallet-double-charge"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-004"
    author: "process:incident-sync"
generated:
  at: "2026-07-20T10:00:00Z"
  by: "process:incident-sync"
verified:
  by: "human:giorgio.leone"
  at: "2026-09-10T15:00:00Z"
status: "stable"
---

# INC-2026-004: Duplicate wallet debits after a Kafka rebalance

**Severity:** SEV2 · **Date:** 2026-02-19 · **Services:** [wallet-service](../services/wallet-service.md)

## Impact
2,340 customers saw two debits for one journey (average 1.50 euro); 410 balances went negative and blocked further travel until the reversal. No card payments were affected.

## Timeline
14:02 deployment of wallet-service triggers a consumer rebalance · 14:03-14:09 commands from the uncommitted offset window are reprocessed · 14:25 customer support reports double debits · 14:40 incident opened · 15:30 automatic reversal script prepared · 16:10 all duplicates reversed.

## Root cause
The debit command handler was not idempotent: a replayed WalletTopUp/Debit command with the same payment id produced a second event. At-least-once delivery plus a non-idempotent handler.

## Resolution
Reversal events issued for every duplicate; command handler made idempotent on the payment id; consumer offsets committed after the event store write.

## Follow-ups
Idempotency keys mandatory on every command handler (done); chaos test that kills a consumer mid-batch (done); reconciliation report compares debits with FareComputed daily.

Post-mortem: [pm-2026-004-wallet-double-charge](../postmortems/pm-2026-004-wallet-double-charge.md)
