---
type: "Service"
title: "inspector-app-backend"
description: "Backend dell'app dei controllori: verifica dei titoli di viaggio a bordo, sanzioni, sincronizzazione offline."
tags: ["service", "biglietti", "servizio"]
aliases: ["inspector-app-backend"]
lang: "it"
runtime: "Kotlin 2 / Ktor, PostgreSQL, Redis"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
  - type: "produces"
    target: "okf://atlas/contracts/inspection-result-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/fraud-score-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/redis"
  - type: "measured_by"
    target: "okf://atlas/slos/inspector-backend-sync-latency"
generated:
  at: "2026-04-10T15:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# inspector-app-backend

inspector-app-backend risponde alle verifiche dei controllori: dato un QR o un token EMV letto a bordo, interroga il ledger delle validazioni e restituisce l'esito (valido, non validato, scaduto, bloccato per frode). Le sanzioni vengono registrate e inviate a pagopa-adapter per l'avviso. L'app funziona anche offline con una lista di revoca scaricata ogni 15 minuti; gli esiti vengono sincronizzati al rientro in copertura.

## Proprietà e runtime
Team: [team-biglietti](../teams/team-biglietti.md) · Runtime: Kotlin 2 / Ktor, PostgreSQL, Redis

## Interfacce
- Produce [inspection-result-v1](../contracts/inspection-result-v1.md)
- Consuma [fraud-score-v1](../contracts/fraud-score-v1.md)

## Dipendenze
- [postgresql-16](../dependencies/postgresql-16.md)
- [redis](../dependencies/redis.md)

## Note operative
L'incidente di settembre 2026 (sincronizzazione) ha prodotto 300 esiti duplicati: la chiave di idempotenza è ora (dispositivo, sequenza) come per i validatori.

- SLO: [inspector-backend-sync-latency](../slos/inspector-backend-sync-latency.md)
- Incidente: [inc-2026-025-inspector-app-sync](../incidents/inc-2026-025-inspector-app-sync.md)
