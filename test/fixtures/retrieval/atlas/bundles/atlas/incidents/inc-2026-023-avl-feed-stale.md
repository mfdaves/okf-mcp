---
type: "Incident"
title: "INC-2026-023: Vehicle positions frozen for 50 minutes"
description: "The AVL consumer group got stuck after a broker restart; positions in the apps and the operator portal froze for 50 minutes."
tags: ["incident", "sev3", "avl-collector", "realtime-predictions"]
aliases: ["INC-2026-023"]
lang: "en"
severity: "SEV3"
occurred_on: "2026-08-12"
relations:
  - type: "affects"
    target: "okf://atlas/services/avl-collector"
  - type: "affects"
    target: "okf://atlas/services/realtime-predictions"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/avl-feed-restart"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-023"
    author: "process:incident-sync"
generated:
  at: "2026-08-14T11:00:00Z"
  by: "process:incident-sync"
status: "stable"
---

# INC-2026-023: Vehicle positions frozen for 50 minutes

**Severity:** SEV3 · **Date:** 2026-08-12 · **Services:** [avl-collector](../services/avl-collector.md), [realtime-predictions](../services/realtime-predictions.md)

## Impact
Live map and arrival predictions frozen for 50 minutes across the region; predictions fell back to schedule.

## Timeline
15:20 broker rolling restart · 15:22 avl-collector consumer stops committing · 15:35 stale position alert · 15:50 on-call restarts the consumer group · 16:10 positions current again.

## Root cause
A known client library bug left the consumer in a zombie state after the group coordinator moved; the collector reported healthy because its HTTP probe did not check consumption progress.

## Resolution
Consumer restarted; readiness probe now fails when no message is consumed for 60 seconds while partitions are assigned; client library upgraded.

## Follow-ups
Restart runbook written; library upgrade across services tracked by Renovate.
