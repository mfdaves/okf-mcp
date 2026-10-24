---
type: "Decision"
title: "ADR-019: Conservazione dei dati di validazione"
description: "Validazioni grezze 24 mesi, aggregati 10 anni, posizioni veicoli 90 giorni."
tags: ["adr", "decision", "adr-019", "decisione"]
aliases: ["ADR-019"]
lang: "it"
decided_on: "2026-04-22"
relations:
  - type: "related_to"
    target: "okf://atlas/services/validation-ledger"
  - type: "related_to"
    target: "okf://atlas/services/reporting-warehouse"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/019.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-09-24T13:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:lucia.bernardi"
  at: "2026-09-01T09:00:00Z"
status: "stable"
stale_after: "2026-05-31"
---

# ADR-019: Conservazione dei dati di validazione

**Stato:** accettata · **Data:** 2026-04-22

## Contesto
Il GDPR impone minimizzazione; la normativa fiscale e i contratti di servizio con la Regione richiedono aggregati per 10 anni; le contestazioni delle sanzioni arrivano fino a 18 mesi dopo.

## Decisione
Validazioni grezze (con ticket_id) conservate 24 mesi nel ledger e nel warehouse, poi anonimizzate; aggregati per linea, zona e giorno conservati 10 anni; posizioni AVL 90 giorni in TimescaleDB e 24 mesi nel warehouse con TTL.

## Conseguenze
Le cancellazioni account non toccano gli aggregati; le partizioni mensili del ledger si eliminano con un job, non a mano.

## Collegamenti
- [validation-ledger](../services/validation-ledger.md)
- [reporting-warehouse](../services/reporting-warehouse.md)
