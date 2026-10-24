---
type: "Data Contract"
title: "WalletTopUpRequested v1"
description: "Command from the BFF or storefront asking for a top-up through the PSP."
tags: ["contract", "command", "pagamenti"]
aliases: ["payments.wallet.topups.v1"]
lang: "en"
channel: "payments.wallet.topups.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
generated:
  at: "2026-02-08T07:00:00Z"
  by: "process:schema-registry-sync"
status: "stable"
---

# WalletTopUpRequested v1

Command from the BFF or storefront asking for a top-up through the PSP.

**Kind:** command · **Topic:** `payments.wallet.topups.v1` · **Format:** Avro · **Owner:** [team-pagamenti](../teams/team-pagamenti.md)

## Fields
- wallet_id
- request_id (idempotency key)
- amount_cents
- payment_method (enum: CARD, PAGOPA)
- requested_at

## Compatibility
FULL.

## Personal data
None beyond wallet_id.

## Retention
Kafka 7 days.

## Notes
Fraud scoring consumes it to spot card-testing patterns (many small top-ups).
