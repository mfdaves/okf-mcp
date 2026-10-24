---
type: "Runbook"
title: "PostgreSQL failover and post-failover checks"
description: "Promote the synchronous replica of a managed PostgreSQL instance and verify the services that hold leases or locks."
tags: ["runbook", "operations", "wallet-service", "subscription-manager", "validation-ledger"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/wallet-service"
  - type: "runbook_for"
    target: "okf://atlas/services/subscription-manager"
  - type: "runbook_for"
    target: "okf://atlas/services/validation-ledger"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/postgres-failover"
generated:
  at: "2026-01-03T12:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:davide.colombo"
  at: "2026-05-15T09:00:00Z"
status: "stable"
stale_after: "2027-10-31"
---

# PostgreSQL failover and post-failover checks

Promote the synchronous replica of a managed PostgreSQL instance and verify the services that hold leases or locks.

Services: [wallet-service](../services/wallet-service.md), [subscription-manager](../services/subscription-manager.md), [validation-ledger](../services/validation-ledger.md)

## When to use
Primary unresponsive for more than 2 minutes, planned maintenance of the primary, or availability-zone loss.

## Prerequisites
Managed database console access; the service owner informed; replica lag 0 (synchronous).

## Steps
1. Trigger the managed failover (console or `aws rds reboot-db-instance --force-failover`).
2. Wait for the DNS endpoint to point to the new primary (under 60 seconds).
3. Restart services that hold advisory locks or leases (subscription-manager scheduler) so that fencing tokens are renewed.
4. Check connection pool errors drop to zero and replication resumes to the new replica.
5. For event-sourced services, verify the projection catches up (wallet read model lag under 1 second).

## Rollback
Managed failover is not reversible as such; fail back with the same procedure once the old primary is healthy and in sync.

## Escalation
Platform on-call; owning team for step 3 and 5. A duplicate-processing symptom after failover is a SEV2 (see INC-2026-027).
