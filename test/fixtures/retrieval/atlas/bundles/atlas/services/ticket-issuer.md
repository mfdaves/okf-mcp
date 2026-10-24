---
type: "Service"
title: "ticket-issuer"
description: "Issues single tickets, carnets and QR / EMV tokens after a successful payment or wallet debit."
tags: ["service", "biglietti"]
aliases: ["ticket-issuer"]
lang: "en"
runtime: "Kotlin 2 / Spring Boot 3, PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
  - type: "consumes"
    target: "okf://atlas/contracts/payment-authorized-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/wallet-transaction-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/fare-computed-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "implements"
    target: "okf://atlas/contracts/api-tickets-v3"
generated:
  at: "2026-04-12T12:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# ticket-issuer

ticket-issuer creates the ticket record, signs the QR payload (Ed25519, 90-second rotating key id) or registers the EMV contactless token, and publishes the ticket to the validator fleet through the validator-gateway. It owns the REST tickets API v3 used by the mobile BFF and the web storefront. Idempotency is keyed on the payment id, so a retried purchase never issues two tickets.

## Ownership and runtime
Team: [team-biglietti](../teams/team-biglietti.md) · Runtime: Kotlin 2 / Spring Boot 3, PostgreSQL

## Interfaces
- Exposes [api-tickets-v3](../contracts/api-tickets-v3.md)
- Consumes [payment-authorized-v1](../contracts/payment-authorized-v1.md)
- Consumes [wallet-transaction-v1](../contracts/wallet-transaction-v1.md)
- Consumes [fare-computed-v1](../contracts/fare-computed-v1.md)

## Dependencies
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
Replaces the ticket module of the legacy SBE monolith; the migration of carnets finished in June 2026.
