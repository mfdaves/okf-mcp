---
type: "Runbook"
title: "Riavvio del legacy SBE (deprecato)"
description: "Procedura storica di riavvio del monolite SBE: non usare, contattare il fornitore."
tags: ["runbook", "operations", "legacy-sbe", "procedura"]
lang: "it"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/legacy-sbe"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/legacy-sbe-restart"
generated:
  at: "2026-02-19T11:00:00Z"
  by: "human:davide.colombo"
status: "deprecated"
stale_after: "2026-03-31"
---

# Riavvio del legacy SBE (deprecato)

Procedura storica di riavvio del monolite SBE: non usare, contattare il fornitore.

Servizi: [legacy-sbe](../services/legacy-sbe.md)

## Quando usarlo
Non usare. Il sistema è in dismissione (ADR-017): qualsiasi anomalia va segnalata al fornitore.

## Prerequisiti
Nessuno.

## Passi
1. Contattare il fornitore con il numero di contratto.
2. Non riavviare i servizi applicativi né il database Oracle.

## Rollback
Non applicabile.

## Escalation
Fornitore; reperibile biglietti solo per informare gli operatori.
