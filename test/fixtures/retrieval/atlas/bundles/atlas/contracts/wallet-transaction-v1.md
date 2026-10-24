---
type: "Data Contract"
title: "WalletTransaction v1"
description: "Every settled wallet movement: top-up, debit, hold, release, reversal."
tags: ["contract", "event", "pagamenti"]
aliases: ["payments.wallet.transactions.v1"]
lang: "en"
channel: "payments.wallet.transactions.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
generated:
  at: "2025-12-19T15:00:00Z"
  by: "process:schema-registry-sync"
status: "stable"
---

# WalletTransaction v1

Every settled wallet movement: top-up, debit, hold, release, reversal.

**Kind:** event · **Topic:** `payments.wallet.transactions.v1` · **Format:** Avro · **Owner:** [team-pagamenti](../teams/team-pagamenti.md)

## Fields
- wallet_id
- transaction_id (idempotency key)
- kind (enum)
- amount_cents (signed)
- balance_after_cents
- reference (payment id or journey id)
- occurred_at

## Compatibility
BACKWARD.

## Personal data
wallet_id maps to an account.

## Retention
Kafka 90 days; event store indefinitely (fiscal retention 10 years).

## Notes
balance_after_cents is authoritative for the read model; the nightly reconciliation compares it with the PSP settlement.
