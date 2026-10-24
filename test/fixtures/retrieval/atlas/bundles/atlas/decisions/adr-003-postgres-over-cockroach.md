---
type: "Decision"
title: "ADR-003: PostgreSQL instead of CockroachDB for transactional data"
description: "Keep PostgreSQL 16 with managed failover; no distributed SQL for now."
tags: ["adr", "decision", "adr-003"]
aliases: ["ADR-003"]
lang: "en"
decided_on: "2025-08-02"
relations:
  - type: "related_to"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "related_to"
    target: "okf://atlas/questions/q-001-multi-region-active-active"
  - type: "related_to"
    target: "okf://atlas/runbooks/postgres-failover"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/003.md"
    author: "human:lucia.bernardi"
generated:
  at: "2025-08-16T11:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-10-08T08:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# ADR-003: PostgreSQL instead of CockroachDB for transactional data

**Status:** accepted · **Date:** 2025-08-02

## Context
A multi-region active-active deployment was considered for the ledger and the wallet. CockroachDB would give it at the cost of latency, licensing and a new operational skill set.

## Decision
Standardise on PostgreSQL 16 (managed, one primary per service, synchronous replica in a second availability zone). Revisit when a second region becomes a regulatory or business requirement.

## Consequences
Simple operations and skills already in house; a regional failover is a runbook, not automatic. The multi-region question stays open.

## Related
- [postgresql-16](../dependencies/postgresql-16.md)
- [q-001-multi-region-active-active](../questions/q-001-multi-region-active-active.md)
- [postgres-failover](../runbooks/postgres-failover.md)
