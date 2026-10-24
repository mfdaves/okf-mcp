---
type: "Service"
title: "gtfs-ingest"
description: "Downloads, validates and merges GTFS and GTFS-RT feeds from the regional operators."
tags: ["service", "mobilita"]
aliases: ["gtfs-ingest"]
lang: "en"
runtime: "Python 3.12, Prefect, PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-mobilita"
  - type: "produces"
    target: "okf://atlas/contracts/gtfs-feed-manifest-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/gtfs-ingest-freshness"
generated:
  at: "2026-08-27T10:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# gtfs-ingest

gtfs-ingest pulls the static GTFS of each operator on their publication schedule, validates it with the MobilityData validator, merges the feeds into one regional dataset and publishes a GtfsFeedManifest when a new release is ready. GTFS-RT trip updates and alerts are proxied with a 30-second cache. A feed that fails validation is rejected and the operator is notified; the previous release stays active.

## Ownership and runtime
Team: [team-mobilita](../teams/team-mobilita.md) · Runtime: Python 3.12, Prefect, PostgreSQL

## Interfaces
- Produces [gtfs-feed-manifest-v1](../contracts/gtfs-feed-manifest-v1.md)

## Dependencies
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
The import failure of March 2026 came from an operator shipping a GTFS with duplicated trip ids; the manual import runbook covers the override. Feed quality by vendor is an open question.

- SLO: [gtfs-ingest-freshness](../slos/gtfs-ingest-freshness.md)
- Incident: [inc-2026-009-gtfs-import-failure](../incidents/inc-2026-009-gtfs-import-failure.md)
- Open question: [q-003-gtfs-rt-vendor-quality](../questions/q-003-gtfs-rt-vendor-quality.md)
