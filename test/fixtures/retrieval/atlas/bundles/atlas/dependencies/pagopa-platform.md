---
type: "Dependency"
title: "Piattaforma pagoPA (nodo dei pagamenti)"
description: "Nodo nazionale dei pagamenti verso la pubblica amministrazione; integrazione diretta (ADR-009)."
tags: ["dependency", "vendor", "pagamenti", "dipendenza"]
lang: "it"
version: "SANP 3.x"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
sources:
  - id: "vendor"
    resource: "https://www.pagopa.gov.it/"
generated:
  at: "2026-05-17T10:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2026-12-31"
---

# Piattaforma pagoPA (nodo dei pagamenti)

Nodo nazionale dei pagamenti verso la pubblica amministrazione; integrazione diretta (ADR-009).

**Versione:** SANP 3.x · **Tipo:** vendor · **Owner:** [team-pagamenti](../teams/team-pagamenti.md)

## Dove si usa
pagopa-adapter: avvisi, RPT/RT, verifica stato (GPD), riconciliazione per abbonamenti aziendali e sanzioni.

## Fine supporto
Specifiche SANP aggiornate dal gestore; certificati client con scadenza annuale.

## Note di aggiornamento
I degradi del nodo sono comunicati sul portale di assistenza; la nostra riconciliazione non deve dipendere solo dalle RT push (INC-2026-007).
