---
type: "Post-mortem"
title: "Post-mortem INC-2026-011: topic retention drift filled a broker"
description: "A retention setting changed by hand caused disk pressure and 6 hours of consumer lag."
tags: ["post-mortem", "postmortem", "incident-review"]
lang: "en"
relations:
  - type: "documents"
    target: "okf://atlas/incidents/inc-2026-011-kafka-partition-lag"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-011"
    author: "process:incident-sync"
  - id: "wiki"
    resource: "https://wiki.tessera.internal/postmortems/pm-2026-011-kafka-lag"
generated:
  at: "2026-06-10T07:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-08-17T16:00:00Z"
status: "stable"
---

# Post-mortem INC-2026-011: topic retention drift filled a broker

Incident: [inc-2026-011-kafka-partition-lag](../incidents/inc-2026-011-kafka-partition-lag.md)

## Summary
The positions topic retention had been raised to 30 days during a debugging session in February and never reverted. By April the broker holding its largest partitions ran out of headroom, throttled, and the ledger consumer fell 6 hours behind.

## Contributing factors
- Topic configuration was not under version control.
- Disk alerts fired at 90%, too late for a broker that fills 1% per hour.
- The inspector backend treated 'not found in ledger' as 'not validated'.

## What went well
The ledger consumer recovered on its own once segments were deleted; no data was lost; the replay runbook was not needed but was ready.

## Action items
1. Topic configuration declared in Git with drift detection every 15 minutes (done).
2. Disk alert at 75% with paging (done).
3. Inspector backend answers 'validated recently, syncing' when consumer lag exceeds 10 minutes (done).
4. Consumer lag SLO for the ledger (done).

## Lessons
Configuration that is not in Git does not exist; it only hurts.
