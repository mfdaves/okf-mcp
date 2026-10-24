---
type: "Incident"
title: "INC-2026-011: Consumer lag of 6 hours on validations after broker disk pressure"
description: "One Kafka broker hit disk pressure and throttled; the ledger consumer fell 6 hours behind, delaying inspections and caps."
tags: ["incident", "sev2", "validation-ledger", "reporting-warehouse"]
aliases: ["INC-2026-011"]
lang: "en"
severity: "SEV2"
occurred_on: "2026-04-02"
relations:
  - type: "affects"
    target: "okf://atlas/services/validation-ledger"
  - type: "affects"
    target: "okf://atlas/services/reporting-warehouse"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/replay-kafka-topic"
  - type: "documented_in"
    target: "okf://atlas/postmortems/pm-2026-011-kafka-lag"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-011"
    author: "process:incident-sync"
generated:
  at: "2026-02-19T15:00:00Z"
  by: "process:incident-sync"
status: "stable"
---

# INC-2026-011: Consumer lag of 6 hours on validations after broker disk pressure

**Severity:** SEV2 · **Date:** 2026-04-02 · **Services:** [validation-ledger](../services/validation-ledger.md), [reporting-warehouse](../services/reporting-warehouse.md)

## Impact
Inspectors saw 'not validated' for tickets validated up to 6 hours earlier (about 900 disputed checks); daily caps settled late; warehouse dashboards stale for the morning.

## Timeline
05:40 broker-2 disk at 92%, throttling · 07:10 ledger lag alert fires at 30 minutes · 07:30 incident opened · 08:15 old segments of the positions topic deleted, retention corrected · 11:50 lag recovered.

## Root cause
The mobility.positions.v1 topic had retention set to 30 days instead of 3 by a configuration drift; the broker ran out of disk headroom and throttled all partitions on that broker.

## Resolution
Retention fixed to 3 days and enforced from Git; inspector backend falls back to a 'validated recently, syncing' answer when lag is over 10 minutes.

## Follow-ups
Topic configuration in Git with drift detection (done); disk alert at 75% (done); lag SLO for the ledger consumer (done).

Post-mortem: [pm-2026-011-kafka-lag](../postmortems/pm-2026-011-kafka-lag.md)
