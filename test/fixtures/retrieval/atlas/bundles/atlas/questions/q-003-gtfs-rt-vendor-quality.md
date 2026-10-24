---
type: "Open Question"
title: "Open question: GTFS and GTFS-RT quality per operator vendor"
description: "Three operators use the same scheduling vendor whose GTFS exports fail validation monthly."
tags: ["open-question", "architecture", "question"]
lang: "en"
owner: "human:marco.vitale"
due: "2027-01-31"
relations:
  - type: "related_to"
    target: "okf://atlas/services/gtfs-ingest"
  - type: "related_to"
    target: "okf://atlas/incidents/inc-2026-009-gtfs-import-failure"
generated:
  at: "2026-09-15T13:00:00Z"
  by: "human:lucia.bernardi"
status: "stable"
---

# Open question: GTFS and GTFS-RT quality per operator vendor

Three operators use the same scheduling vendor whose GTFS exports fail validation monthly.

## Question
Should we fix feeds on their behalf (overrides), require a validation report in the service contract, or build a self-service validator for operators?

## Options
1. Keep manual overrides (cost: about 2 days per month of the mobility team).
2. Contractual requirement: feeds must pass the MobilityData validator.
3. Self-service validator in the operator portal with blocking upload.

## Current leaning
Option 3, with option 2 as backing in the next contract round.

## Owner and due date
`human:marco.vitale` · 2027-01-31

## Related
- [gtfs-ingest](../services/gtfs-ingest.md)
- [inc-2026-009-gtfs-import-failure](../incidents/inc-2026-009-gtfs-import-failure.md)
