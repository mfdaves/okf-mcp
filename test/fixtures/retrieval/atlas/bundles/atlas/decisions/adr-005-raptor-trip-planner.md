---
type: "Decision"
title: "ADR-005: In-house RAPTOR trip planner instead of OpenTripPlanner"
description: "Build the planner in Rust on RAPTOR; do not run OpenTripPlanner."
tags: ["adr", "decision", "adr-005"]
aliases: ["ADR-005"]
lang: "en"
decided_on: "2025-09-05"
relations:
  - type: "related_to"
    target: "okf://atlas/services/trip-planner"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/005.md"
    author: "human:lucia.bernardi"
generated:
  at: "2025-11-11T14:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-04-14T13:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# ADR-005: In-house RAPTOR trip planner instead of OpenTripPlanner

**Status:** accepted · **Date:** 2025-09-05

## Context
OpenTripPlanner covers the need but its memory footprint with real-time updates and its JVM tuning were a recurring source of incidents at the previous vendor. The regional network is small enough for an in-memory router.

## Decision
Implement RAPTOR (round-based public transit routing) in Rust with walking legs precomputed from OpenStreetMap; rebuild the graph per GTFS release and swap atomically.

## Consequences
Predictable latency (p95 under 150 ms) and 6 GB per replica; the team owns an algorithmic codebase, which is a hiring constraint.

## Related
- [trip-planner](../services/trip-planner.md)
