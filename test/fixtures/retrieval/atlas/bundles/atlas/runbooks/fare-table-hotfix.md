---
type: "Runbook"
title: "Hotfix di una tabella tariffaria"
description: "Pubblicare una nuova versione della tabella tariffaria in emergenza con prova in ombra e attivazione a orario."
tags: ["runbook", "operations", "fare-engine", "procedura"]
lang: "it"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/fare-engine"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/fare-table-hotfix"
generated:
  at: "2026-07-04T08:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:davide.colombo"
  at: "2026-09-01T12:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# Hotfix di una tabella tariffaria

Pubblicare una nuova versione della tabella tariffaria in emergenza con prova in ombra e attivazione a orario.

Servizi: [fare-engine](../services/fare-engine.md)

## Quando usarlo
Prezzi o soglie errati in produzione (reclami, anomalie di incasso, errore in una tabella pubblicata dal portale operatori).

## Prerequisiti
La tabella corretta approvata dal team biglietti; accesso alla console del fare-engine; le validazioni del giorno precedente nel warehouse.

## Passi
1. Caricare la nuova tabella come versione successiva (mai modificare la versione attiva).
2. Eseguire la prova in ombra sulle validazioni del giorno precedente: la console mostra le differenze di prezzo per fascia oraria e per soglia.
3. Verificare in particolare la finestra 23:00-02:00 (lezione dell'INC-2026-015) e i cambi di ora legale.
4. Attivare la nuova versione all'orario concordato (di norma 03:00) e controllare i primi FareComputed.
5. Avviare il ricalcolo delle soglie per il periodo errato e i rimborsi a credito wallet.

## Rollback
Riattivare la versione precedente dalla console: l'attivazione è un puntatore, non una migrazione.

## Escalation
Reperibile biglietti; amministrazione per il ricalcolo degli incassi degli operatori.
