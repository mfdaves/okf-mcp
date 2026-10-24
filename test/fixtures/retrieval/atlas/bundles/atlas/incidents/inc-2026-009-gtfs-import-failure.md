---
type: "Incident"
title: "INC-2026-009: GTFS release rejected for 9 days, planner on stale timetable"
description: "An operator shipped a GTFS with duplicated trip ids; the merge was rejected daily and the planner served the previous timetable for 9 days, missing a schedule change."
tags: ["incident", "sev3", "gtfs-ingest", "trip-planner"]
aliases: ["INC-2026-009"]
lang: "en"
severity: "SEV3"
occurred_on: "2026-03-24"
relations:
  - type: "affects"
    target: "okf://atlas/services/gtfs-ingest"
  - type: "affects"
    target: "okf://atlas/services/trip-planner"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/gtfs-manual-import"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-009"
    author: "process:incident-sync"
generated:
  at: "2026-03-01T13:00:00Z"
  by: "process:incident-sync"
verified:
  by: "human:giorgio.leone"
  at: "2026-05-02T11:00:00Z"
status: "stable"
---

# INC-2026-009: GTFS release rejected for 9 days, planner on stale timetable

**Severity:** SEV3 · **Date:** 2026-03-24 · **Services:** [gtfs-ingest](../services/gtfs-ingest.md), [trip-planner](../services/trip-planner.md)

## Impact
Journey plans on 14 suburban lines showed the old schedule for 9 days after the operator changed it; about 2% of planner searches gave wrong departure times.

## Timeline
Day 1 nightly merge rejected, notification to the operator · Day 4 operator reports they had fixed it (they had not) · Day 8 customer complaints correlated · Day 9 manual import with the duplicate trips renamed.

## Root cause
The validator correctly rejected the feed, but rejection notifications went to a mailbox nobody read, and the planner had no signal that its timetable was older than the operator's published change.

## Resolution
Manual import with a per-operator override (now the manual import runbook); rejection alerts routed to the mobility on-call channel; planner shows a staleness banner when the active release is older than 7 days.

## Follow-ups
Staleness SLO on GTFS ingest (done); operator-facing validation report (done); feed quality by vendor tracked in an open question.
