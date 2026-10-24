---
type: "Decision"
title: "ADR-009: Integrazione diretta con il nodo pagoPA"
description: "Integrazione diretta con il nodo dei pagamenti, senza partner tecnologico."
tags: ["adr", "decision", "adr-009", "decisione"]
aliases: ["ADR-009"]
lang: "it"
decided_on: "2025-10-15"
relations:
  - type: "related_to"
    target: "okf://atlas/services/pagopa-adapter"
  - type: "related_to"
    target: "okf://atlas/dependencies/pagopa-platform"
  - type: "related_to"
    target: "okf://atlas/runbooks/pagopa-reconciliation"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/009.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-09-15T17:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-05T07:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# ADR-009: Integrazione diretta con il nodo pagoPA

**Stato:** accettata · **Data:** 2025-10-15

## Contesto
Gli abbonamenti aziendali e le sanzioni devono essere incassati tramite pagoPA. Un partner tecnologico costa lo 0,8% per transazione e introduce un terzo sistema da riconciliare.

## Decisione
Integrarsi direttamente con il nodo pagoPA (ente creditore con intermediario proprio), gestendo avvisi, RPT/RT e riconciliazione in pagopa-adapter.

## Conseguenze
Risparmio sulle commissioni e un solo punto di riconciliazione; il team pagamenti deve seguire le specifiche SANP e i certificati del nodo. Il timeout del nodo di marzo 2026 ha mostrato che la riconciliazione manuale deve essere un runbook pronto.

## Collegamenti
- [pagopa-adapter](../services/pagopa-adapter.md)
- [pagopa-platform](../dependencies/pagopa-platform.md)
- [pagopa-reconciliation](../runbooks/pagopa-reconciliation.md)
