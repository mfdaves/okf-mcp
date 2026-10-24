---
type: "SLO"
title: "SLO: riconciliazione delle ricevute pagoPA"
description: "Il 99% degli avvisi pagati risulta riconciliato entro 4 ore, su 28 giorni."
tags: ["slo", "reliability", "pagopa-adapter", "affidabilità"]
lang: "it"
relations:
  - type: "measures"
    target: "okf://atlas/services/pagopa-adapter"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/pagopa-adapter-rt-delivery"
    author: "human:davide.colombo"
generated:
  at: "2026-05-06T10:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-09-04T13:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# SLO: riconciliazione delle ricevute pagoPA

Il 99% degli avvisi pagati risulta riconciliato entro 4 ore, su 28 giorni.

Servizio: [pagopa-adapter](../services/pagopa-adapter.md)

## SLI
Tempo tra il pagamento (data della RT) e la riconciliazione interna, per gli avvisi pagati.

## Obiettivo
99% entro 4 ore; 99,9% entro 24 ore.

## Error budget
L'1% degli avvisi può superare le 4 ore; un degrado del nodo come INC-2026-007 consuma il budget di due mesi.

## Alerting
Allarme quando più di 50 avvisi sono in attesa da oltre 4 ore; il job di polling è la prima mitigazione.
