---
type: "Data Contract"
title: "PaymentRefunded v1"
description: "Refund executed at the PSP or credited to a wallet."
tags: ["contract", "event", "pagamenti"]
aliases: ["payments.refunds.v1"]
lang: "en"
channel: "payments.refunds.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
generated:
  at: "2026-01-27T10:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:sara.greco"
  at: "2026-08-21T13:00:00Z"
status: "stable"
---

# PaymentRefunded v1

Refund executed at the PSP or credited to a wallet.

**Kind:** event · **Topic:** `payments.refunds.v1` · **Format:** Avro · **Owner:** [team-pagamenti](../teams/team-pagamenti.md)

## Fields
- refund_id
- payment_id
- amount_cents
- channel (enum: PSP, WALLET)
- executed_at

## Compatibility
BACKWARD.

## Personal data
None.

## Retention
Kafka 90 days.

## Notes
refund-service consumes it to close the workflow.
