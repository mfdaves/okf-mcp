---
type: "Data Contract"
title: "SubscriptionRenewed v1"
description: "A season pass was renewed and charged."
tags: ["contract", "event", "biglietti"]
aliases: ["ticketing.subscriptions.renewals.v1"]
lang: "en"
channel: "ticketing.subscriptions.renewals.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
generated:
  at: "2026-09-08T13:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:andrea.moretti"
  at: "2026-09-02T11:00:00Z"
status: "stable"
---

# SubscriptionRenewed v1

A season pass was renewed and charged.

**Kind:** event · **Topic:** `ticketing.subscriptions.renewals.v1` · **Format:** Avro · **Owner:** [team-biglietti](../teams/team-biglietti.md)

## Fields
- subscription_id
- account_id
- period_start / period_end
- amount_cents
- payment_id
- renewed_at

## Compatibility
BACKWARD.

## Personal data
account_id.

## Retention
Kafka 90 days; warehouse 10 years.

## Notes
Exactly-once is not guaranteed by Kafka: consumers de-duplicate on (subscription_id, period_start), which is how the duplicate renewal incident was contained downstream.
