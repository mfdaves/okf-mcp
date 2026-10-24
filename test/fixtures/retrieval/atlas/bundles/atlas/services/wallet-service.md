---
type: "Service"
title: "wallet-service"
description: "Prepaid wallet per account: top-ups, debits, holds and reversals, event-sourced."
tags: ["service", "pagamenti"]
aliases: ["wallet-service"]
lang: "en"
runtime: "Java 21 / Axon Framework, PostgreSQL event store"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
  - type: "produces"
    target: "okf://atlas/contracts/wallet-transaction-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/wallet-topup-requested-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/payment-authorized-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/fare-computed-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/wallet-service-consistency"
generated:
  at: "2026-07-25T08:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:chiara.fontana"
  at: "2026-10-26T16:00:00Z"
status: "stable"
---

# wallet-service

wallet-service keeps one event-sourced aggregate per wallet (ADR-001). Every debit is a command that fails if the balance would go negative; holds reserve funds for pay-as-you-go journeys until the daily cap is settled by fare-engine. Balances are projected to a read model used by the BFF; the projection lags the event store by under a second in normal operation.

## Ownership and runtime
Team: [team-pagamenti](../teams/team-pagamenti.md) · Runtime: Java 21 / Axon Framework, PostgreSQL event store

## Interfaces
- Produces [wallet-transaction-v1](../contracts/wallet-transaction-v1.md)
- Consumes [wallet-topup-requested-v1](../contracts/wallet-topup-requested-v1.md)
- Consumes [payment-authorized-v1](../contracts/payment-authorized-v1.md)
- Consumes [fare-computed-v1](../contracts/fare-computed-v1.md)

## Dependencies
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
The double-charge incident of February 2026 was a duplicate command replay after a Kafka rebalance; fixed by making the command handler idempotent on the payment id. Balances are reconciled nightly against the PSP settlement file with the wallet balance reconciliation runbook.

- SLO: [wallet-service-consistency](../slos/wallet-service-consistency.md)
- Incident: [inc-2026-004-wallet-double-charge](../incidents/inc-2026-004-wallet-double-charge.md)
