---
type: "Data Contract"
title: "VehiclePosition v1"
description: "Vehicle position every 10 seconds from the on-board unit."
tags: ["contract", "event", "mobilita"]
aliases: ["mobility.positions.v1"]
lang: "en"
channel: "mobility.positions.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-mobilita"
generated:
  at: "2026-10-05T08:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:sara.greco"
  at: "2026-06-25T16:00:00Z"
status: "stable"
---

# VehiclePosition v1

Vehicle position every 10 seconds from the on-board unit.

**Kind:** event · **Topic:** `mobility.positions.v1` · **Format:** Avro · **Owner:** [team-mobilita](../teams/team-mobilita.md)

## Fields
- vehicle_id
- operator_id
- lat / lon (WGS84)
- bearing
- speed_kmh
- trip_id (optional, when matched)
- recorded_at
- received_at

## Compatibility
BACKWARD.

## Personal data
None.

## Retention
Kafka 3 days; TimescaleDB 90 days; warehouse raw with a 24-month TTL (added after the disk-full incident).

## Notes
About 9 million events per day.
