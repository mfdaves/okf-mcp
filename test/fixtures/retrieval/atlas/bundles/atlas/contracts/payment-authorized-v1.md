---
type: "Data Contract"
title: "PaymentAuthorized v1"
description: "Successful authorization or capture at the PSP or a paid pagoPA notice."
tags: ["contract", "event", "pagamenti"]
aliases: ["payments.authorizations.v1"]
lang: "en"
channel: "payments.authorizations.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
generated:
  at: "2026-10-22T16:00:00Z"
  by: "process:schema-registry-sync"
status: "stable"
---

# PaymentAuthorized v1

Successful authorization or capture at the PSP or a paid pagoPA notice.

**Kind:** event · **Topic:** `payments.authorizations.v1` · **Format:** Avro · **Owner:** [team-pagamenti](../teams/team-pagamenti.md)

## Fields
- payment_id
- order_id
- amount_cents
- psp (enum: NEXI, FALLBACK, PAGOPA)
- card_brand (optional)
- authorized_at
- captured (boolean)

## Compatibility
BACKWARD.

## Personal data
No PAN; card_brand only.

## Retention
Kafka 90 days; warehouse 10 years.

## Notes
Published through the transactional outbox of payments-orchestrator (ADR-012), never directly from the request thread.
