---
type: "SLO"
title: "SLO: login availability (SPID, CIE, password)"
description: "99.9% of login attempts complete without a technical error, per method, 28 days."
tags: ["slo", "reliability", "identity-service"]
lang: "en"
relations:
  - type: "measures"
    target: "okf://atlas/services/identity-service"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/identity-service-login-availability"
    author: "human:davide.colombo"
generated:
  at: "2026-06-26T13:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-09-03T07:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# SLO: login availability (SPID, CIE, password)

99.9% of login attempts complete without a technical error, per method, 28 days.

Service: [identity-service](../services/identity-service.md)

## SLI
Synthetic login every 5 minutes per method plus real-user success rate excluding wrong credentials and user abandonment.

## Objective
99.9% per method; SPID measured separately because its providers fail independently.

## Error budget
43 minutes per 28 days per method.

## Alerting
Page on 3 consecutive synthetic failures for any method; SAML signature failures page immediately.
