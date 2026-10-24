---
type: "Incident"
title: "INC-2026-018: ClickHouse shard disk full, operator dashboards down"
description: "The raw AVL positions table had no TTL and filled one shard; ingestion stopped and the operator dashboards were down for 5 hours."
tags: ["incident", "sev3", "reporting-warehouse"]
aliases: ["INC-2026-018"]
lang: "en"
severity: "SEV3"
occurred_on: "2026-06-09"
relations:
  - type: "affects"
    target: "okf://atlas/services/reporting-warehouse"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/clickhouse-disk-cleanup"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-018"
    author: "process:incident-sync"
generated:
  at: "2026-10-20T10:00:00Z"
  by: "process:incident-sync"
status: "stable"
---

# INC-2026-018: ClickHouse shard disk full, operator dashboards down

**Severity:** SEV3 · **Date:** 2026-06-09 · **Services:** [reporting-warehouse](../services/reporting-warehouse.md)

## Impact
Operator dashboards and the daily settlement export unavailable for 5 hours; no data loss (Kafka retention covered the gap).

## Timeline
02:10 shard-1 disk 100%, inserts fail · 06:00 data on-call starts (business hours rota) · 07:30 raw positions table identified · 08:00 TTL 24 months applied and old parts dropped · 09:15 ingestion caught up.

## Root cause
The raw table for VehiclePosition events was created without a TTL clause; 9 million rows a day for 8 months filled the shard. Disk alerts went to a channel without paging.

## Resolution
TTL applied; parts older than 24 months dropped; disk alert routed to paging at 80%.

## Follow-ups
dbt macro that fails CI when a raw model has no TTL (done); data team paging rota for SEV2+ outside business hours (open question on on-call).
