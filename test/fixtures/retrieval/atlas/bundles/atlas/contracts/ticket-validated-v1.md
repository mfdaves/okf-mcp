---
type: "Data Contract"
title: "TicketValidated v1 (deprecated)"
description: "Deprecated validation event without the delayed flag; kept for the legacy SBE bridge until March 2027."
tags: ["contract", "event", "biglietti"]
aliases: ["ticketing.validations.v1"]
lang: "en"
channel: "ticketing.validations.v1"
format: "JSON"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
generated:
  at: "2026-05-27T16:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:sara.greco"
  at: "2026-08-26T13:00:00Z"
status: "deprecated"
stale_after: "2026-05-01"
---

# TicketValidated v1 (deprecated)

Deprecated validation event without the delayed flag; kept for the legacy SBE bridge until March 2027.

**Kind:** event · **Topic:** `ticketing.validations.v1` · **Format:** JSON · **Owner:** [team-biglietti](../teams/team-biglietti.md)

## Fields
- ticket_id
- device_id
- validated_at
- zone

## Compatibility
None (JSON without registry).

## Personal data
Same as v2.

## Retention
Kafka 7 days.

## Notes
Do not add consumers. The bridge that mirrors v2 into v1 is removed when the legacy SBE is retired.
