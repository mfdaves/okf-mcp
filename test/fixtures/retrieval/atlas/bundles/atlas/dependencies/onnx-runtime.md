---
type: "Dependency"
title: "ONNX Runtime"
description: "Inference runtime for the fraud model and the arrival prediction model."
tags: ["dependency", "library", "dati"]
lang: "en"
version: "1.19"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-dati"
sources:
  - id: "vendor"
    resource: "https://onnxruntime.ai/"
generated:
  at: "2026-08-09T17:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2026-05-31"
---

# ONNX Runtime

Inference runtime for the fraud model and the arrival prediction model.

**Version:** 1.19 · **Kind:** library · **Owner:** [team-dati](../teams/team-dati.md)

## Where it is used
fraud-scoring and realtime-predictions; models exported from the training pipeline in the warehouse.

## Support end
Project release line; pin per service.

## Upgrade notes
Model and runtime versions are recorded in every FraudScore and ArrivalPrediction event (model_version).
