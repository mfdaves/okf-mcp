---
type: "Dependency"
title: "Nexi XPay (PSP primario)"
description: "Gateway di pagamento primario per carte e Bancomat Pay (ADR-018)."
tags: ["dependency", "vendor", "pagamenti", "dipendenza"]
lang: "it"
version: "API v2 (2026)"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
sources:
  - id: "vendor"
    resource: "https://developer.nexi.it/"
generated:
  at: "2026-10-24T17:00:00Z"
  by: "agent/arch-atlas"
verified:
  by: "human:davide.colombo"
  at: "2026-09-25T11:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# Nexi XPay (PSP primario)

Gateway di pagamento primario per carte e Bancomat Pay (ADR-018).

**Versione:** API v2 (2026) · **Tipo:** vendor · **Owner:** [team-pagamenti](../teams/team-pagamenti.md)

## Dove si usa
payments-orchestrator: autorizzazione, 3-D Secure, incasso, rimborsi; pagina di pagamento ospitata per la tokenizzazione del PAN.

## Fine supporto
Contratto fino al 2028-06; rotazione credenziali trimestrale.

## Note di aggiornamento
Il canale di assistenza è il portale merchant; per i degradi di produzione usare il numero di reperibilità nel contratto. Il PSP di fallback viene provato ogni mese con l'1% del traffico.
