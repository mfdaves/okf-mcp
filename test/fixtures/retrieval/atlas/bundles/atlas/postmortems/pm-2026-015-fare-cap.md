---
type: "Post-mortem"
title: "Post-mortem INC-2026-015: cap window computed in UTC"
description: "A library upgrade changed time-zone defaults; 11 days of night journeys joined the wrong daily cap."
tags: ["post-mortem", "postmortem", "incident-review"]
lang: "en"
relations:
  - type: "documents"
    target: "okf://atlas/incidents/inc-2026-015-fare-cap-miscalculation"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-015"
    author: "process:incident-sync"
  - id: "wiki"
    resource: "https://wiki.tessera.internal/postmortems/pm-2026-015-fare-cap"
generated:
  at: "2026-08-26T11:00:00Z"
  by: "human:giorgio.leone"
verified:
  by: "human:lucia.bernardi"
  at: "2026-10-13T07:00:00Z"
status: "stable"
---

# Post-mortem INC-2026-015: cap window computed in UTC

Incident: [inc-2026-015-fare-cap-miscalculation](../incidents/inc-2026-015-fare-cap-miscalculation.md)

## Summary
The fare cap window was computed from timestamps truncated to the day in UTC after an upgrade of the date-time library. Europe/Rome midnight is 22:00 or 23:00 UTC, so journeys between 00:00 and 02:00 local time were capped with the previous day.

## Contributing factors
- No regression test around midnight or DST changes.
- Fare table activation had no shadow run against real validations.
- Revenue anomalies were visible in the warehouse from day 2 but nobody looked at night revenue specifically.

## What went well
FareComputed events carried the fare table version, so recomputing 11 days of caps was a batch job, not a forensic exercise.

## Action items
1. Time-zone regression suite around midnight and DST (done).
2. Shadow run of a new fare table on the previous day before activation (done, part of the hotfix runbook).
3. Night revenue anomaly alert in the warehouse (done).

## Lessons
Explicit time zones everywhere money is computed; defaults are a dependency you do not control.
