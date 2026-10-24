---
type: "Open Question"
title: "Open question: do we need a second region (active-active)?"
description: "Whether ticketing must survive the loss of eu-south-1, and at what cost."
tags: ["open-question", "architecture", "question"]
lang: "en"
owner: "human:lucia.bernardi"
due: "2026-12-15"
relations:
  - type: "related_to"
    target: "okf://atlas/decisions/adr-003-postgres-over-cockroach"
  - type: "related_to"
    target: "okf://atlas/decisions/adr-010-offline-validation-window"
generated:
  at: "2026-10-06T13:00:00Z"
  by: "human:elena.marino"
status: "draft"
---

# Open question: do we need a second region (active-active)?

Whether ticketing must survive the loss of eu-south-1, and at what cost.

## Question
The Regione's new service contract (2027) may require a recovery time of 30 minutes for validations. Today a region loss means hours. Do we build active-active, active-passive, or negotiate the requirement down?

## Options
1. Active-passive with asynchronous PostgreSQL replicas in eu-central-1 (RPO minutes, RTO about 1 hour).
2. Active-active with CockroachDB for the ledger and the wallet (ADR-003 revisited).
3. Accept the risk and extend the validator offline window from 72 hours to 7 days.

## Current leaning
Option 1 for 2027; option 3 as the real mitigation for riders. Option 2 only if the contract demands RPO zero.

## Owner and due date
`human:lucia.bernardi` · 2026-12-15

## Related
- [adr-003-postgres-over-cockroach](../decisions/adr-003-postgres-over-cockroach.md)
- [adr-010-offline-validation-window](../decisions/adr-010-offline-validation-window.md)
