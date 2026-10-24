---
type: "Open Question"
title: "Open question: fraud model retraining cadence and feature store"
description: "Monthly retraining misses new QR cloning patterns for weeks."
tags: ["open-question", "architecture", "question"]
lang: "en"
owner: "human:elena.marino"
due: "2026-12-31"
relations:
  - type: "related_to"
    target: "okf://atlas/services/fraud-scoring"
  - type: "related_to"
    target: "okf://atlas/contracts/inspection-result-v1"
generated:
  at: "2026-09-26T15:00:00Z"
  by: "human:elena.marino"
status: "draft"
---

# Open question: fraud model retraining cadence and feature store

Monthly retraining misses new QR cloning patterns for weeks.

## Question
Move to weekly or event-driven retraining? That needs a feature store and a labelled feedback loop from inspections faster than the current monthly export.

## Options
1. Weekly retraining from the warehouse marts (cheap, still batch).
2. Online features in Redis plus weekly model refresh.
3. Buy a managed fraud service (rejected for data residency so far).

## Current leaning
Option 2; needs the inspection result labels within 24 hours.

## Owner and due date
`human:elena.marino` · 2026-12-31

## Related
- [fraud-scoring](../services/fraud-scoring.md)
- [inspection-result-v1](../contracts/inspection-result-v1.md)
