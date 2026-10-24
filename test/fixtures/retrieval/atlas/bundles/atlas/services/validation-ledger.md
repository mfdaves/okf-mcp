---
type: "Service"
title: "validation-ledger"
description: "Append-only ledger of every validation; source of truth for inspections, caps and operator settlement."
tags: ["service", "biglietti"]
aliases: ["validation-ledger"]
lang: "en"
runtime: "Java 21 / Spring Boot 3, PostgreSQL (partitioned by month)"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
  - type: "consumes"
    target: "okf://atlas/contracts/ticket-validated-v2"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
generated:
  at: "2026-02-18T10:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:chiara.fontana"
  at: "2026-10-15T16:00:00Z"
status: "stable"
---

# validation-ledger

validation-ledger consumes TicketValidated events and appends them to a monthly-partitioned PostgreSQL table with an idempotency key (device id, sequence number). It answers 'was this ticket validated on this vehicle' for the inspector backend and feeds the warehouse. Retention is 24 months for raw validations and 10 years for aggregates (ADR-019).

## Ownership and runtime
Team: [team-biglietti](../teams/team-biglietti.md) · Runtime: Java 21 / Spring Boot 3, PostgreSQL (partitioned by month)

## Interfaces
- Consumes [ticket-validated-v2](../contracts/ticket-validated-v2.md)

## Dependencies
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
Partitioning strategy is an open question: monthly partitions reached 180 GB in September 2026.

- Open question: [q-006-postgres-partitioning-validations](../questions/q-006-postgres-partitioning-validations.md)
