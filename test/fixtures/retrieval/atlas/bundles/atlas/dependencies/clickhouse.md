---
type: "Dependency"
title: "ClickHouse 24"
description: "Analytical warehouse (ADR-006): 3 shards, 2 replicas, Kafka engine ingestion."
tags: ["dependency", "database", "dati"]
lang: "en"
version: "24.8 LTS"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-dati"
sources:
  - id: "vendor"
    resource: "https://clickhouse.com/"
generated:
  at: "2026-10-21T14:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2027-10-31"
---

# ClickHouse 24

Analytical warehouse (ADR-006): 3 shards, 2 replicas, Kafka engine ingestion.

**Version:** 24.8 LTS · **Kind:** database · **Owner:** [team-dati](../teams/team-dati.md)

## Where it is used
reporting-warehouse raw tables and dbt marts; operator portal dashboards.

## Support end
LTS supported 12 months from release.

## Upgrade notes
Every raw table must declare a TTL (dbt CI check) since INC-2026-018.
