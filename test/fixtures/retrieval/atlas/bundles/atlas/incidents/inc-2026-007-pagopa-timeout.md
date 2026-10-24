---
type: "Incident"
title: "INC-2026-007: Timeout del nodo pagoPA e ricevute non riconciliate"
description: "Per 14 ore il nodo pagoPA ha risposto in timeout alle richieste di stato; 1.900 ricevute telematiche sono rimaste non riconciliate."
tags: ["incident", "sev2", "pagopa-adapter", "incidente"]
aliases: ["INC-2026-007"]
lang: "it"
severity: "SEV2"
occurred_on: "2026-03-11"
relations:
  - type: "affects"
    target: "okf://atlas/services/pagopa-adapter"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/pagopa-reconciliation"
  - type: "documented_in"
    target: "okf://atlas/postmortems/pm-2026-007-pagopa-timeout"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-007"
    author: "process:incident-sync"
generated:
  at: "2026-01-16T13:00:00Z"
  by: "process:incident-sync"
verified:
  by: "human:giorgio.leone"
  at: "2026-07-18T16:00:00Z"
status: "stable"
---

# INC-2026-007: Timeout del nodo pagoPA e ricevute non riconciliate

**Gravità:** SEV2 · **Data:** 2026-03-11 · **Servizi:** [pagopa-adapter](../services/pagopa-adapter.md)

## Impatto
1.900 avvisi pagati risultavano non pagati nel portale e nelle app; 60 abbonamenti aziendali non attivati fino al giorno dopo; 12 sanzioni sollecitate per errore.

## Timeline
09:30 aumento dei timeout verso il nodo · 10:15 ticket aperto con l'assistenza pagoPA · 13:00 confermato degrado lato nodo · 23:40 nodo ripristinato · 03:30 (giorno dopo) riconciliazione manuale completata.

## Causa radice
Degrado del nodo dei pagamenti (lato pagoPA). Lato nostro, la riconciliazione dipendeva solo dalle RT push: senza un job di polling dello stato degli avvisi, il ritardo del nodo è diventato un ritardo nostro.

## Risoluzione
Riconciliazione manuale con il runbook; aggiunto il job di polling dello stato degli avvisi ogni 30 minuti per quelli in attesa da più di 2 ore; solleciti sospesi fino alla riconciliazione.

## Azioni successive
Job di polling (fatto); allarme sulle RT in attesa da più di 4 ore (fatto); testo chiaro nelle app 'pagamento in verifica' (in corso).

Post-mortem: [pm-2026-007-pagopa-timeout](../postmortems/pm-2026-007-pagopa-timeout.md)
