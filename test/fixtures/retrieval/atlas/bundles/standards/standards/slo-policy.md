---
type: "Standard"
title: "SLO policy"
description: "Every customer-facing service has at least one SLO with an SLI, an objective, an error budget and burn-rate alerts."
tags: ["standard", "engineering", "slo-policy"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/standards/slo-policy"
generated:
  at: "2025-11-26T12:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-08-11T15:00:00Z"
status: "stable"
---

# SLO policy

Each service owner defines SLOs on user-visible behaviour (latency, availability, correctness, freshness), measured over 28 days unless the business cycle says otherwise. Alerts are multi-window burn-rate alerts: 14.4x over 1 hour pages, 6x over 6 hours opens a ticket. When the error budget is exhausted, the team freezes feature work on that service until the budget recovers or the CTO grants an exception. SLOs are reviewed quarterly and after every SEV1 or SEV2 incident.
