---
type: "Service"
title: "fare-engine"
description: "Computes the price of a journey from the zone matrix, time bands and daily/weekly fare caps."
tags: ["service", "biglietti"]
aliases: ["fare-engine"]
lang: "en"
runtime: "Kotlin 2 / Spring Boot 3, PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
  - type: "produces"
    target: "okf://atlas/contracts/fare-computed-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/ticket-validated-v2"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/fare-engine-latency-p99"
generated:
  at: "2026-09-02T08:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:andrea.moretti"
  at: "2026-05-03T15:00:00Z"
status: "stable"
---

# fare-engine

fare-engine is the single place where a journey becomes a price. It loads the regional zone matrix and the time bands published by the operators, applies the daily and weekly caps per account, and returns a FareComputed event that ticket-issuer and validation-ledger consume. Fare tables are versioned and activated at a cut-over timestamp; a wrong table is rolled back by activating the previous version, never by editing rows in place.

## Ownership and runtime
Team: [team-biglietti](../teams/team-biglietti.md) · Runtime: Kotlin 2 / Spring Boot 3, PostgreSQL

## Interfaces
- Produces [fare-computed-v1](../contracts/fare-computed-v1.md)
- Consumes [ticket-validated-v2](../contracts/ticket-validated-v2.md)

## Dependencies
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
Fare table changes go through the fare-table hotfix runbook. The cap miscalculation incident of May 2026 came from a time-zone bug at the daily cap boundary (midnight Europe/Rome vs UTC).

- SLO: [fare-engine-latency-p99](../slos/fare-engine-latency-p99.md)
- Incident: [inc-2026-015-fare-cap-miscalculation](../incidents/inc-2026-015-fare-cap-miscalculation.md)
