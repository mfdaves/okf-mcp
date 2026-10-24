---
type: "Data Contract"
title: "FareComputed v1"
description: "Price decision for a journey or a cap settlement, emitted by fare-engine."
tags: ["contract", "event", "biglietti"]
aliases: ["ticketing.fares.v1"]
lang: "en"
channel: "ticketing.fares.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
generated:
  at: "2026-06-05T14:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:sara.greco"
  at: "2026-09-11T10:00:00Z"
status: "stable"
---

# FareComputed v1

Price decision for a journey or a cap settlement, emitted by fare-engine.

**Kind:** event · **Topic:** `ticketing.fares.v1` · **Format:** Avro · **Owner:** [team-biglietti](../teams/team-biglietti.md)

## Fields
- journey_id
- account_id (optional for anonymous QR)
- amount_cents
- currency (EUR)
- fare_table_version
- cap_applied (enum: NONE, DAILY, WEEKLY)
- computed_at

## Compatibility
BACKWARD.

## Personal data
account_id is a pseudonymous id.

## Retention
Kafka 30 days; warehouse 10 years (aggregates).

## Notes
fare_table_version makes every price reproducible: the hotfix runbook relies on it.
