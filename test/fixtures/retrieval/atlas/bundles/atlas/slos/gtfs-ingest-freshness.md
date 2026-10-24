---
type: "SLO"
title: "SLO: GTFS timetable freshness"
description: "The active timetable is never older than 7 days behind an operator's published change."
tags: ["slo", "reliability", "gtfs-ingest"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/gtfs-ingest"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/gtfs-ingest-freshness"
    author: "human:davide.colombo"
generated:
  at: "2026-07-15T13:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:davide.colombo"
  at: "2026-08-18T15:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# SLO: GTFS timetable freshness

The active timetable is never older than 7 days behind an operator's published change.

Service: [gtfs-ingest](../services/gtfs-ingest.md)

## SLI
Age of the active merged release relative to the newest operator release that passed or would pass validation.

## Objective
100% of days with age under 7 days over 90 days (hard limit).

## Error budget
Zero budget: one breach is an incident (INC-2026-009).

## Alerting
Ticket at 2 days of rejected merges; page at 5 days.
