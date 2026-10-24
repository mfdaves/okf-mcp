---
type: "Incident"
title: "INC-2026-027: 620 subscriptions renewed and charged twice"
description: "After a PostgreSQL failover two scheduler replicas both believed they held the renewal lock; 620 passes were renewed and charged twice."
tags: ["incident", "sev2", "subscription-manager"]
aliases: ["INC-2026-027"]
lang: "en"
severity: "SEV2"
occurred_on: "2026-09-28"
relations:
  - type: "affects"
    target: "okf://atlas/services/subscription-manager"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/postgres-failover"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-027"
    author: "process:incident-sync"
generated:
  at: "2026-05-19T13:00:00Z"
  by: "process:incident-sync"
status: "stable"
---

# INC-2026-027: 620 subscriptions renewed and charged twice

**Severity:** SEV2 · **Date:** 2026-09-28 · **Services:** [subscription-manager](../services/subscription-manager.md)

## Impact
620 customers charged twice for their monthly pass (29 to 45 euro); refunds within 3 days; 90 complaints.

## Timeline
03:00 managed failover of the subscription database · 03:01 advisory lock lost, both replicas acquire it on reconnect · 03:05-03:20 renewal batch runs twice · 08:30 finance notices doubled revenue · 09:00 incident opened · 14:00 refunds queued.

## Root cause
The leader election used a PostgreSQL advisory lock without a fencing token; after failover both replicas reconnected and each obtained the lock on different connections before the batch finished.

## Resolution
Refunds through refund-service; scheduler switched to a lease with a fencing token stored with each renewal; downstream consumers de-duplicate on (subscription_id, period_start).

## Follow-ups
Fencing tokens for every scheduler (done); failover game day for team biglietti (planned).
