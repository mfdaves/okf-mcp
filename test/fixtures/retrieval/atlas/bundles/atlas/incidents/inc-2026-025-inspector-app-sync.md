---
type: "Incident"
title: "INC-2026-025: Esiti di verifica duplicati dopo la sincronizzazione offline"
description: "300 esiti di verifica sono stati registrati due volte quando le app dei controllori hanno sincronizzato dopo una giornata offline."
tags: ["incident", "sev3", "inspector-app-backend", "incidente"]
aliases: ["INC-2026-025"]
lang: "it"
severity: "SEV3"
occurred_on: "2026-09-16"
relations:
  - type: "affects"
    target: "okf://atlas/services/inspector-app-backend"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-025"
    author: "process:incident-sync"
generated:
  at: "2026-10-05T14:00:00Z"
  by: "process:incident-sync"
verified:
  by: "human:giorgio.leone"
  at: "2026-08-13T12:00:00Z"
status: "stable"
---

# INC-2026-025: Esiti di verifica duplicati dopo la sincronizzazione offline

**Gravità:** SEV3 · **Data:** 2026-09-16 · **Servizi:** [inspector-app-backend](../services/inspector-app-backend.md)

## Impatto
300 esiti duplicati, 41 sanzioni duplicate inviate a pagoPA e annullate il giorno dopo; nessun impatto sui viaggiatori oltre alla notifica doppia.

## Timeline
08:00 sciopero della rete mobile in Appennino, app offline · 17:30 rientro in copertura, sincronizzazione · 18:10 pagopa-adapter segnala avvisi duplicati · 19:00 duplicati identificati e annullati.

## Causa radice
La sincronizzazione ritentava il batch intero al primo errore di rete; la chiave di idempotenza era l'id generato dal server, non quello del dispositivo.

## Risoluzione
Chiave di idempotenza (dispositivo, sequenza) come per i validatori; annullamento degli avvisi duplicati.

## Azioni successive
Test di sincronizzazione con rete instabile (fatto); allarme su sanzioni duplicate in pagopa-adapter (fatto).
