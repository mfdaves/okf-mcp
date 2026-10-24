---
type: "Decision"
title: "ADR-006: ClickHouse as the analytical warehouse"
description: "ClickHouse with Kafka engines and dbt replaces the Oracle reporting schema of the legacy SBE."
tags: ["adr", "decision", "adr-006"]
aliases: ["ADR-006"]
lang: "en"
decided_on: "2025-09-20"
relations:
  - type: "related_to"
    target: "okf://atlas/services/reporting-warehouse"
  - type: "related_to"
    target: "okf://atlas/dependencies/clickhouse"
  - type: "related_to"
    target: "okf://atlas/incidents/inc-2026-018-clickhouse-disk-full"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/006.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-05-07T15:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-11T15:00:00Z"
status: "stable"
stale_after: "2026-05-31"
---

# ADR-006: ClickHouse as the analytical warehouse

**Status:** accepted · **Date:** 2025-09-20

## Context
Operator settlement and the regional reports need joins over billions of validations; the Oracle reporting schema took 9 hours nightly.

## Decision
Run ClickHouse 24 (3 shards, 2 replicas) ingesting Kafka topics directly; model with dbt; keep raw 24 months and marts 10 years.

## Consequences
Reports in minutes; TTLs must be declared on every raw table (lesson from the disk-full incident).

## Related
- [reporting-warehouse](../services/reporting-warehouse.md)
- [clickhouse](../dependencies/clickhouse.md)
- [inc-2026-018-clickhouse-disk-full](../incidents/inc-2026-018-clickhouse-disk-full.md)
