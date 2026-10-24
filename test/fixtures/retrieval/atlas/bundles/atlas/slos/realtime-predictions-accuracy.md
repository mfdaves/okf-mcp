---
type: "SLO"
title: "SLO: arrival prediction accuracy (draft)"
description: "80% of predictions with confidence above 0.3 within 60 seconds of the actual arrival."
tags: ["slo", "reliability", "realtime-predictions"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/realtime-predictions"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/realtime-predictions-accuracy"
    author: "human:davide.colombo"
generated:
  at: "2026-05-12T10:00:00Z"
  by: "human:davide.colombo"
status: "draft"
stale_after: "2027-02-28"
---

# SLO: arrival prediction accuracy (draft)

80% of predictions with confidence above 0.3 within 60 seconds of the actual arrival.

Service: [realtime-predictions](../services/realtime-predictions.md)

## SLI
Absolute error between predicted and observed arrival (from AVL) for predictions made 5 minutes ahead.

## Objective
80% within 60 seconds; 95% within 180 seconds. Draft: no alerting yet.

## Error budget
Not enforced while the service is in draft.

## Alerting
None yet; dashboard predictions/accuracy. Alerting to be defined when the service leaves draft.
