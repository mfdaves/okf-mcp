---
type: "Service"
title: "payments-orchestrator"
description: "Orchestrates card payments through the PSP adapters: authorization, 3-D Secure, capture, refunds."
tags: ["service", "pagamenti"]
aliases: ["payments-orchestrator"]
lang: "en"
runtime: "Java 21 / Spring Boot 3, PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
  - type: "produces"
    target: "okf://atlas/contracts/payment-authorized-v1"
  - type: "produces"
    target: "okf://atlas/contracts/payment-refunded-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/wallet-topup-requested-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/nexi-xpay"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/payments-orchestrator-authorization-success"
generated:
  at: "2026-06-27T17:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:marco.vitale"
  at: "2026-05-14T10:00:00Z"
status: "stable"
---

# payments-orchestrator

payments-orchestrator exposes one internal payment API and routes to Nexi XPay as the primary PSP (ADR-018) with a fallback adapter kept warm for failover. It runs the 3-D Secure challenge flow, captures on ticket issue, and publishes PaymentAuthorized and PaymentRefunded events through the transactional outbox (ADR-012). PSP credentials are rotated quarterly with the rotate-psp-credentials runbook.

## Ownership and runtime
Team: [team-pagamenti](../teams/team-pagamenti.md) · Runtime: Java 21 / Spring Boot 3, PostgreSQL

## Interfaces
- Produces [payment-authorized-v1](../contracts/payment-authorized-v1.md)
- Produces [payment-refunded-v1](../contracts/payment-refunded-v1.md)
- Consumes [wallet-topup-requested-v1](../contracts/wallet-topup-requested-v1.md)

## Dependencies
- [nexi-xpay](../dependencies/nexi-xpay.md)
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
PCI DSS scope: card data never touches our network; the hosted payment page tokenises the PAN.

- SLO: [payments-orchestrator-authorization-success](../slos/payments-orchestrator-authorization-success.md)
