---
type: "Service"
title: "reporting-warehouse"
description: "Analytical warehouse for validations, sales, settlement between operators and regulatory reports."
tags: ["service", "dati"]
aliases: ["reporting-warehouse"]
lang: "en"
runtime: "ClickHouse 24, dbt, Airflow"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-dati"
  - type: "consumes"
    target: "okf://atlas/contracts/ticket-validated-v2"
  - type: "consumes"
    target: "okf://atlas/contracts/wallet-transaction-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/payment-authorized-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/vehicle-position-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/subscription-renewed-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/clickhouse"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/reporting-warehouse-freshness"
generated:
  at: "2026-07-20T17:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:sara.greco"
  at: "2026-08-22T16:00:00Z"
status: "stable"
---

# reporting-warehouse

reporting-warehouse ingests every Kafka topic through ClickHouse Kafka engines, models them with dbt into settlement, ridership and revenue marts, and serves the operator portal dashboards and the quarterly report to the Regione. Raw tables keep 24 months; marts keep 10 years. The disk-full incident of June 2026 came from an unbounded raw table of AVL positions that nobody had put a TTL on.

## Ownership and runtime
Team: [team-dati](../teams/team-dati.md) · Runtime: ClickHouse 24, dbt, Airflow

## Interfaces
- Consumes [ticket-validated-v2](../contracts/ticket-validated-v2.md)
- Consumes [wallet-transaction-v1](../contracts/wallet-transaction-v1.md)
- Consumes [payment-authorized-v1](../contracts/payment-authorized-v1.md)
- Consumes [vehicle-position-v1](../contracts/vehicle-position-v1.md)
- Consumes [subscription-renewed-v1](../contracts/subscription-renewed-v1.md)

## Dependencies
- [clickhouse](../dependencies/clickhouse.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
Freshness SLO is 15 minutes for the operator dashboards; the regulatory marts are rebuilt nightly.

- SLO: [reporting-warehouse-freshness](../slos/reporting-warehouse-freshness.md)
- Incident: [inc-2026-018-clickhouse-disk-full](../incidents/inc-2026-018-clickhouse-disk-full.md)
