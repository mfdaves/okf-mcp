---
type: "Open Question"
title: "Open question: TicketValidated v3 with cap and fare context"
description: "Consumers re-join validations with fares and caps; a v3 event could carry them."
tags: ["open-question", "architecture", "question"]
lang: "en"
owner: "human:sara.greco"
due: "2027-02-28"
relations:
  - type: "related_to"
    target: "okf://atlas/contracts/ticket-validated-v2"
  - type: "related_to"
    target: "okf://atlas/contracts/fare-computed-v1"
generated:
  at: "2026-05-27T13:00:00Z"
  by: "human:davide.colombo"
status: "stable"
---

# Open question: TicketValidated v3 with cap and fare context

Consumers re-join validations with fares and caps; a v3 event could carry them.

## Question
Should TicketValidated v3 embed the fare decision and cap state, or should consumers keep joining FareComputed? Embedding couples the gateway to fare-engine timing.

## Options
1. Keep v2; publish a derived 'ValidationPriced' event from the ledger.
2. v3 with embedded fare context produced by the ledger, not the gateway.
3. Do nothing; consumers join in the warehouse.

## Current leaning
Option 1 (derived event keeps the gateway dumb and fast).

## Owner and due date
`human:sara.greco` · 2027-02-28

## Related
- [ticket-validated-v2](../contracts/ticket-validated-v2.md)
- [fare-computed-v1](../contracts/fare-computed-v1.md)
