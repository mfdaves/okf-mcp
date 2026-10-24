---
type: "Data Contract"
title: "TicketValidated v2"
description: "Event emitted by validator-gateway for every validation; v2 adds the delayed flag and the EMV token hash."
tags: ["contract", "event", "biglietti"]
aliases: ["ticketing.validations.v2"]
lang: "en"
channel: "ticketing.validations.v2"
format: "Avro (schema registry subject ticketing.validations.v2-value)"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
  - type: "supersedes"
    target: "okf://atlas/contracts/ticket-validated-v1"
generated:
  at: "2026-03-27T13:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:sara.greco"
  at: "2026-07-08T16:00:00Z"
status: "stable"
---

# TicketValidated v2

Event emitted by validator-gateway for every validation; v2 adds the delayed flag and the EMV token hash.

**Kind:** event · **Topic:** `ticketing.validations.v2` · **Format:** Avro (schema registry subject ticketing.validations.v2-value) · **Owner:** [team-biglietti](../teams/team-biglietti.md)

## Fields
- ticket_id (uuid)
- device_id (string, validator serial)
- sequence (long, per device, idempotency key with device_id)
- validated_at (timestamp-millis, device clock)
- received_at (timestamp-millis, gateway clock)
- vehicle_id / stop_id (optional)
- zone (string)
- medium (enum: QR, EMV, CARD)
- token_hash (bytes, EMV only)
- delayed (boolean: true when drained from the offline queue)

## Compatibility
BACKWARD; consumers must tolerate new optional fields. Producers: validator-gateway only.

## Personal data
ticket_id links to an account through ticket-issuer; the event itself carries no direct identifier.

## Retention
Kafka 30 days; ledger 24 months; warehouse raw 24 months.

## Notes
v1 is deprecated since 2026-05-01 and its topic is read only by the legacy SBE bridge. The sequence field is what the ledger and the inspector backend use to de-duplicate.
