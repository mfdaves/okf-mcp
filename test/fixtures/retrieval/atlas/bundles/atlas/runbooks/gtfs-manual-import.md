---
type: "Runbook"
title: "Manual GTFS import with per-operator override"
description: "Import an operator feed that the nightly validation rejects, after fixing or accepting known defects."
tags: ["runbook", "operations", "gtfs-ingest", "trip-planner"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/gtfs-ingest"
  - type: "runbook_for"
    target: "okf://atlas/services/trip-planner"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/gtfs-manual-import"
generated:
  at: "2026-08-26T15:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:davide.colombo"
  at: "2026-04-14T07:00:00Z"
status: "stable"
stale_after: "2026-09-30"
---

# Manual GTFS import with per-operator override

Import an operator feed that the nightly validation rejects, after fixing or accepting known defects.

Services: [gtfs-ingest](../services/gtfs-ingest.md), [trip-planner](../services/trip-planner.md)

## When to use
Nightly merge rejected for more than 2 days and the operator cannot fix the feed before a schedule change takes effect.

## Prerequisites
Validator report of the rejected feed; agreement of the mobility lead; the override reason.

## Steps
1. Download the rejected feed and run the validator locally to list errors.
2. Apply the override script for the accepted defects (rename duplicated trip ids, drop shapes with invalid coordinates).
3. Run the merge with `--override <operator> --reason '<text>'`; the manifest records the override.
4. Check the planner rebuild log and spot-check 5 journeys on the affected lines.
5. Notify the operator with the list of defects they must fix in the next release.

## Rollback
Republish the previous manifest; the planner swaps back to the previous graph within 2 minutes.

## Escalation
Mobility on-call; the mobility lead approves any override that drops trips.
