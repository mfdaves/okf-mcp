---
type: "Open Question"
title: "Open question: ledger partitioning beyond monthly"
description: "Monthly partitions reached 180 GB; vacuum and index builds take hours."
tags: ["open-question", "architecture", "question"]
lang: "en"
owner: "human:sara.greco"
due: "2026-11-30"
relations:
  - type: "related_to"
    target: "okf://atlas/services/validation-ledger"
  - type: "related_to"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "related_to"
    target: "okf://atlas/decisions/adr-019-data-retention-validations"
generated:
  at: "2026-05-06T10:00:00Z"
  by: "human:lucia.bernardi"
status: "draft"
---

# Open question: ledger partitioning beyond monthly

Monthly partitions reached 180 GB; vacuum and index builds take hours.

## Question
Weekly partitions, hash sub-partitioning by device, or move raw validations older than 3 months to ClickHouse and keep PostgreSQL for the hot window?

## Options
1. Weekly partitions (simple, more partitions to manage).
2. Monthly partitions sub-partitioned by hash(device_id) into 8.
3. Hot window of 3 months in PostgreSQL, the rest in ClickHouse, inspector queries routed by age.

## Current leaning
Option 3 is the long-term direction; option 1 as a stopgap before the PostgreSQL 17 upgrade.

## Owner and due date
`human:sara.greco` · 2026-11-30

## Related
- [validation-ledger](../services/validation-ledger.md)
- [postgresql-16](../dependencies/postgresql-16.md)
- [adr-019-data-retention-validations](../decisions/adr-019-data-retention-validations.md)
