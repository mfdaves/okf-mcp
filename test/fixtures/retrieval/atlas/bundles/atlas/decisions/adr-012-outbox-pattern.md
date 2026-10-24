---
type: "Decision"
title: "ADR-012: Transactional outbox for events emitted from database transactions"
description: "Services write events to an outbox table in the same transaction and a relay publishes them."
tags: ["adr", "decision", "adr-012"]
aliases: ["ADR-012"]
lang: "en"
decided_on: "2025-11-24"
relations:
  - type: "related_to"
    target: "okf://atlas/services/payments-orchestrator"
  - type: "related_to"
    target: "okf://atlas/contracts/payment-authorized-v1"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/012.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-06-16T15:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:lucia.bernardi"
  at: "2026-09-17T13:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# ADR-012: Transactional outbox for events emitted from database transactions

**Status:** accepted · **Date:** 2025-11-24

## Context
payments-orchestrator lost PaymentAuthorized events when the process died between the commit and the Kafka produce.

## Decision
Every service that emits events as a consequence of a database write uses an outbox table and Debezium (or a polling relay) to publish; direct produce from the request path is forbidden for those events.

## Consequences
At-least-once delivery with ordering per aggregate; consumers must be idempotent. Slight publication latency (under 500 ms).

## Related
- [payments-orchestrator](../services/payments-orchestrator.md)
- [payment-authorized-v1](../contracts/payment-authorized-v1.md)
