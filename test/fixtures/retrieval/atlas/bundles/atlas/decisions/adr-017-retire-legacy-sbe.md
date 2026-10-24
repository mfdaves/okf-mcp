---
type: "Decision"
title: "ADR-017: Dismissione del legacy SBE entro marzo 2027"
description: "Il monolite SBE viene spento a marzo 2027; nessuna nuova funzione, solo patch di sicurezza del fornitore."
tags: ["adr", "decision", "adr-017", "decisione"]
aliases: ["ADR-017"]
lang: "it"
decided_on: "2026-03-20"
relations:
  - type: "related_to"
    target: "okf://atlas/services/legacy-sbe"
  - type: "related_to"
    target: "okf://atlas/questions/q-010-legacy-sbe-data-archive"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/017.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-06-08T11:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:lucia.bernardi"
  at: "2026-09-15T15:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# ADR-017: Dismissione del legacy SBE entro marzo 2027

**Stato:** accettata · **Data:** 2026-03-20

## Contesto
Il monolite SBE (Java 8, Oracle 12c) costa 400 mila euro l'anno di manutenzione e licenze; tutte le funzioni tranne le tessere fisiche sono già migrate.

## Decisione
Congelare il SBE: nessuna nuova funzionalità, patch di sicurezza applicate dal fornitore, spegnimento alla scadenza dell'ultimo abbonamento su tessera fisica (marzo 2027). Il ponte eventi v1 viene rimosso nello stesso momento.

## Conseguenze
Risparmio dal 2027; i dati storici devono essere archiviati prima dello spegnimento (questione aperta).

## Collegamenti
- [legacy-sbe](../services/legacy-sbe.md)
- [q-010-legacy-sbe-data-archive](../questions/q-010-legacy-sbe-data-archive.md)
