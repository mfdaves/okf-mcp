---
type: "Runbook"
title: "Riconciliazione manuale degli avvisi pagoPA"
description: "Allineare lo stato degli avvisi con il nodo quando le ricevute telematiche non sono arrivate o sono arrivate in ritardo."
tags: ["runbook", "operations", "pagopa-adapter", "procedura"]
lang: "it"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/pagopa-adapter"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/pagopa-reconciliation"
generated:
  at: "2026-01-07T13:00:00Z"
  by: "human:andrea.moretti"
status: "stable"
stale_after: "2026-12-31"
---

# Riconciliazione manuale degli avvisi pagoPA

Allineare lo stato degli avvisi con il nodo quando le ricevute telematiche non sono arrivate o sono arrivate in ritardo.

Servizi: [pagopa-adapter](../services/pagopa-adapter.md)

## Quando usarlo
Avvisi in stato 'in attesa' da più di 4 ore con pagamento confermato dall'utente, oppure dopo un degrado del nodo segnalato da pagoPA.

## Prerequisiti
Accesso al portale del nodo e alla console di pagopa-adapter; elenco degli IUV interessati; solleciti sospesi.

## Passi
1. Esportare dalla console gli IUV in attesa da più di 4 ore.
2. Per ogni IUV interrogare lo stato al nodo (`verificaRPT` / API GPD).
3. Per gli avvisi risultati pagati, importare la RT con l'azione 'riconcilia' della console: attiva abbonamenti e chiude sanzioni.
4. Per gli avvisi scaduti non pagati, annullarli e riattivare i solleciti.
5. Registrare il numero di avvisi riconciliati nel ticket e avvisare l'amministrazione.

## Rollback
L'azione 'riconcilia' è idempotente: ripeterla non duplica attivazioni. Un'attivazione errata si annulla dalla console con motivazione.

## Escalation
Reperibile pagamenti; assistenza pagoPA per stati incoerenti; amministrazione per le sanzioni annullate.
