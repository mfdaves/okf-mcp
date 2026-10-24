---
type: "Service"
title: "refund-service"
description: "Refund workflow for tickets, subscriptions and wallet balances, with approval steps and PSP execution."
tags: ["service", "pagamenti"]
aliases: ["refund-service"]
lang: "en"
runtime: "Java 21 / Spring Boot 3, PostgreSQL, Temporal"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
  - type: "consumes"
    target: "okf://atlas/contracts/payment-refunded-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/refund-service-turnaround"
generated:
  at: "2026-01-07T16:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# refund-service

refund-service runs a Temporal workflow per refund request: eligibility (unused ticket, strike days, subscription suspension), approval when above 50 euro, execution through payments-orchestrator or as wallet credit, and customer notification. Requests stuck in the approval queue were the September 2026 incident: the approval task queue had no worker after a deployment removed the worker deployment by mistake.

## Ownership and runtime
Team: [team-pagamenti](../teams/team-pagamenti.md) · Runtime: Java 21 / Spring Boot 3, PostgreSQL, Temporal

## Interfaces
- Consumes [payment-refunded-v1](../contracts/payment-refunded-v1.md)

## Dependencies
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
Target turnaround is 5 working days; the SLO measures it end to end.

- SLO: [refund-service-turnaround](../slos/refund-service-turnaround.md)
- Incident: [inc-2026-022-refund-queue-stuck](../incidents/inc-2026-022-refund-queue-stuck.md)
