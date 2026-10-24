---
type: "Data Contract"
title: "ArrivalPrediction v1"
description: "Predicted arrival at a stop for a trip, refreshed every 30 seconds."
tags: ["contract", "event", "mobilita"]
aliases: ["mobility.predictions.v1"]
lang: "en"
channel: "mobility.predictions.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-mobilita"
generated:
  at: "2026-05-25T10:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:andrea.moretti"
  at: "2026-08-22T10:00:00Z"
status: "stable"
---

# ArrivalPrediction v1

Predicted arrival at a stop for a trip, refreshed every 30 seconds.

**Kind:** event · **Topic:** `mobility.predictions.v1` · **Format:** Avro · **Owner:** [team-mobilita](../teams/team-mobilita.md)

## Fields
- trip_id
- stop_id
- predicted_at
- arrival_at
- confidence (0-1)
- model_version

## Compatibility
BACKWARD.

## Personal data
None.

## Retention
Kafka 1 day; Redis latest value only.

## Notes
confidence below 0.3 is shown as 'scheduled' in the apps, not as a prediction.
