---
type: "Service"
title: "fraud-scoring"
description: "Scores validations and top-ups for fraud (cloned QR codes, stolen cards, inspection evasion patterns)."
tags: ["service", "dati"]
aliases: ["fraud-scoring"]
lang: "en"
runtime: "Python 3.12 / FastAPI, ONNX Runtime, Redis"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-dati"
  - type: "produces"
    target: "okf://atlas/contracts/fraud-score-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/ticket-validated-v2"
  - type: "consumes"
    target: "okf://atlas/contracts/wallet-topup-requested-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/inspection-result-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/onnx-runtime"
  - type: "depends_on"
    target: "okf://atlas/dependencies/redis"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/fraud-scoring-latency"
generated:
  at: "2026-09-20T14:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# fraud-scoring

fraud-scoring combines deterministic rules (same QR validated on two vehicles 40 km apart within 10 minutes) with an ONNX model trained on labelled inspection outcomes. It publishes FraudScore events; scores above 0.9 block the ticket and notify the inspector backend. The model is retrained monthly, which is too slow according to the open question on retraining cadence.

## Ownership and runtime
Team: [team-dati](../teams/team-dati.md) · Runtime: Python 3.12 / FastAPI, ONNX Runtime, Redis

## Interfaces
- Produces [fraud-score-v1](../contracts/fraud-score-v1.md)
- Consumes [ticket-validated-v2](../contracts/ticket-validated-v2.md)
- Consumes [wallet-topup-requested-v1](../contracts/wallet-topup-requested-v1.md)
- Consumes [inspection-result-v1](../contracts/inspection-result-v1.md)

## Dependencies
- [onnx-runtime](../dependencies/onnx-runtime.md)
- [redis](../dependencies/redis.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
False positives are reviewed weekly by team biglietti; the threshold is a feature flag.

- SLO: [fraud-scoring-latency](../slos/fraud-scoring-latency.md)
- Open question: [q-004-fraud-model-retraining](../questions/q-004-fraud-model-retraining.md)
