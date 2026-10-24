---
type: "Runbook"
title: "ClickHouse disk pressure: find and drop oversized parts"
description: "Free disk on a ClickHouse shard without losing data covered by Kafka retention."
tags: ["runbook", "operations", "reporting-warehouse"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/reporting-warehouse"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/clickhouse-disk-cleanup"
generated:
  at: "2025-10-04T13:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:davide.colombo"
  at: "2026-10-26T10:00:00Z"
status: "stable"
stale_after: "2026-01-31"
---

# ClickHouse disk pressure: find and drop oversized parts

Free disk on a ClickHouse shard without losing data covered by Kafka retention.

Services: [reporting-warehouse](../services/reporting-warehouse.md)

## When to use
Disk above 80% on any shard, or inserts failing with 'not enough space'.

## Prerequisites
ClickHouse admin access; the TTL policy from ADR-019; the list of raw tables and their Kafka retention.

## Steps
1. `SELECT table, formatReadableSize(sum(bytes)) FROM system.parts GROUP BY table ORDER BY sum(bytes) DESC`.
2. For raw tables with Kafka retention still covering the data, drop the oldest partitions beyond the TTL (`ALTER TABLE ... DROP PARTITION`).
3. For tables without a TTL, add one now (`ALTER TABLE ... MODIFY TTL ...`) and let the merge free space.
4. If still above 80%, detach the raw partitions of the last 24 hours and re-ingest later from Kafka.
5. Confirm the dbt CI check for TTLs covers the offending table.

## Rollback
Detached partitions can be re-attached; dropped partitions are rebuilt by replaying Kafka (see the replay runbook) if within retention.

## Escalation
Data on-call during business hours; platform on-call outside (the paging gap is an open question).
