---
type: "Service"
title: "subscription-manager"
description: "Season passes: purchase, renewal, tax-benefit eligibility, suspension and refunds of subscriptions."
tags: ["service", "biglietti"]
aliases: ["subscription-manager"]
lang: "en"
runtime: "Java 21 / Spring Boot 3, PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
  - type: "produces"
    target: "okf://atlas/contracts/subscription-renewed-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/payment-authorized-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/account-created-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/subscription-manager-renewal-success"
generated:
  at: "2026-09-15T15:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:andrea.moretti"
  at: "2026-06-15T15:00:00Z"
status: "stable"
---

# subscription-manager

subscription-manager manages monthly and annual passes, their renewal schedule and the eligibility checks for tax benefits (ISEE band, student status) that require SPID level 2. Renewals are driven by a scheduler that publishes SubscriptionRenewed events; the duplicate renewal incident of September 2026 came from two scheduler replicas both holding the lock after a Postgres failover.

## Ownership and runtime
Team: [team-biglietti](../teams/team-biglietti.md) · Runtime: Java 21 / Spring Boot 3, PostgreSQL

## Interfaces
- Produces [subscription-renewed-v1](../contracts/subscription-renewed-v1.md)
- Consumes [payment-authorized-v1](../contracts/payment-authorized-v1.md)
- Consumes [account-created-v1](../contracts/account-created-v1.md)

## Dependencies
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
Annual passes are paid through pagoPA when bought by companies for their employees.

- SLO: [subscription-manager-renewal-success](../slos/subscription-manager-renewal-success.md)
- Incident: [inc-2026-027-subscription-renewal-duplicate](../incidents/inc-2026-027-subscription-renewal-duplicate.md)
