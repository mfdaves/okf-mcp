---
type: "Data Contract"
title: "FraudScore v1"
description: "Fraud score for a validation or top-up, with the rule or model that produced it."
tags: ["contract", "event", "dati"]
aliases: ["risk.scores.v1"]
lang: "en"
channel: "risk.scores.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-dati"
generated:
  at: "2026-10-03T07:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:andrea.moretti"
  at: "2026-08-08T12:00:00Z"
status: "stable"
---

# FraudScore v1

Fraud score for a validation or top-up, with the rule or model that produced it.

**Kind:** event · **Topic:** `risk.scores.v1` · **Format:** Avro · **Owner:** [team-dati](../teams/team-dati.md)

## Fields
- subject_kind (enum: VALIDATION, TOPUP)
- subject_id
- score (0-1)
- reasons (list of rule ids)
- model_version
- scored_at

## Compatibility
BACKWARD.

## Personal data
None.

## Retention
Kafka 30 days.

## Notes
Scores above 0.9 block; between 0.6 and 0.9 flag for inspection.
