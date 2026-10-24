---
type: "Incident"
title: "INC-2026-015: Daily cap applied across the wrong day boundary"
description: "For 11 days journeys between 00:00 and 02:00 local time were capped with the previous day; 18,000 customers were undercharged or overcharged by up to 3 euro."
tags: ["incident", "sev2", "fare-engine"]
aliases: ["INC-2026-015"]
lang: "en"
severity: "SEV2"
occurred_on: "2026-05-06"
relations:
  - type: "affects"
    target: "okf://atlas/services/fare-engine"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/fare-table-hotfix"
  - type: "documented_in"
    target: "okf://atlas/postmortems/pm-2026-015-fare-cap"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-015"
    author: "process:incident-sync"
generated:
  at: "2026-10-15T17:00:00Z"
  by: "process:incident-sync"
status: "stable"
---

# INC-2026-015: Daily cap applied across the wrong day boundary

**Severity:** SEV2 · **Date:** 2026-05-06 · **Services:** [fare-engine](../services/fare-engine.md)

## Impact
18,000 affected accounts over 11 days; net effect 9,400 euro undercharged and 2,100 euro overcharged (refunded as wallet credit).

## Timeline
Day 1 fare table v41 activated with the new night fares · Day 6 operator notices lower night revenue · Day 10 analysis in the warehouse finds the midnight pattern · Day 11 hotfix activated as fare table v42.

## Root cause
The cap window was computed in UTC after a library upgrade changed the default time zone handling; Europe/Rome midnight fell at 22:00 or 23:00 UTC, so night journeys joined the previous day's cap.

## Resolution
Fare table v42 with explicit Europe/Rome zone in the cap computation; recomputation of 11 days of caps from FareComputed events; wallet credits for overcharges.

## Follow-ups
Time-zone regression test around DST changes (done); fare table activation requires a shadow run on the previous day's validations (done).

Post-mortem: [pm-2026-015-fare-cap](../postmortems/pm-2026-015-fare-cap.md)
