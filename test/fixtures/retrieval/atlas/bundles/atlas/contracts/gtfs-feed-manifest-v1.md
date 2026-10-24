---
type: "Data Contract"
title: "GtfsFeedManifest v1"
description: "Announces a validated merged GTFS release with its download location and validity window."
tags: ["contract", "event", "mobilita"]
aliases: ["mobility.gtfs.releases.v1"]
lang: "en"
channel: "mobility.gtfs.releases.v1"
format: "JSON Schema"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-mobilita"
generated:
  at: "2026-09-27T16:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:elena.marino"
  at: "2026-09-03T07:00:00Z"
status: "stable"
---

# GtfsFeedManifest v1

Announces a validated merged GTFS release with its download location and validity window.

**Kind:** event · **Topic:** `mobility.gtfs.releases.v1` · **Format:** JSON Schema · **Owner:** [team-mobilita](../teams/team-mobilita.md)

## Fields
- release_id
- operators (list)
- valid_from / valid_to
- object_store_url
- validator_report_url
- published_at

## Compatibility
Additive JSON; consumers ignore unknown keys.

## Personal data
None.

## Retention
Kafka 90 days; releases kept 2 years in object storage.

## Notes
trip-planner and realtime-predictions rebuild on this event; a manual import publishes the same manifest.
