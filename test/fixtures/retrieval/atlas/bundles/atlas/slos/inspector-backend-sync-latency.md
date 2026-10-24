---
type: "SLO"
title: "SLO: latenza di verifica e sincronizzazione dei controllori"
description: "Il 99% delle verifiche online risponde entro 300 ms; gli esiti offline sono sincronizzati entro 30 minuti dal rientro in copertura."
tags: ["slo", "reliability", "inspector-app-backend", "affidabilità"]
lang: "it"
relations:
  - type: "measures"
    target: "okf://atlas/services/inspector-app-backend"
sources:
  - id: "grafana"
    resource: "https://grafana.tessera.internal/d/inspector-backend-sync-latency"
    author: "human:davide.colombo"
generated:
  at: "2026-07-09T13:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-08T08:00:00Z"
status: "stable"
stale_after: "2027-10-31"
---

# SLO: latenza di verifica e sincronizzazione dei controllori

Il 99% delle verifiche online risponde entro 300 ms; gli esiti offline sono sincronizzati entro 30 minuti dal rientro in copertura.

Servizio: [inspector-app-backend](../services/inspector-app-backend.md)

## SLI
Latenza della verifica online misurata nell'app; tempo tra rientro in copertura e sincronizzazione completa.

## Obiettivo
p99 online sotto 300 ms; 99% delle sincronizzazioni entro 30 minuti, su 28 giorni.

## Error budget
L'1% delle verifiche può superare i 300 ms; l'1% delle sincronizzazioni può superare i 30 minuti.

## Alerting
Allarme se la risposta 'non trovato' supera il 5% delle verifiche per 10 minuti (segno di lag del ledger); pagina a 10 minuti di lag.
