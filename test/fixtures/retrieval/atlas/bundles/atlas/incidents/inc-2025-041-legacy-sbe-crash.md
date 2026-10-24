---
type: "Incident"
title: "INC-2025-041 (storico): Crash del legacy SBE per tablespace Oracle pieno"
description: "Incidente storico: il monolite SBE si è fermato per 5 ore perché il tablespace Oracle delle validazioni era pieno."
tags: ["incident", "sev2", "legacy-sbe", "incidente"]
aliases: ["INC-2025-041"]
lang: "it"
severity: "SEV2"
occurred_on: "2025-11-18"
relations:
  - type: "affects"
    target: "okf://atlas/services/legacy-sbe"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/legacy-sbe-restart"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2025-041"
    author: "process:incident-sync"
generated:
  at: "2026-04-22T09:00:00Z"
  by: "process:incident-sync"
verified:
  by: "human:giorgio.leone"
  at: "2026-07-17T08:00:00Z"
status: "stable"
stale_after: "2026-05-31"
---

# INC-2025-041 (storico): Crash del legacy SBE per tablespace Oracle pieno

**Gravità:** SEV2 · **Data:** 2025-11-18 · **Servizi:** [legacy-sbe](../services/legacy-sbe.md)

## Impatto
Emissione su tessera fisica e rendicontazione del SBE ferme per 5 ore; nessun impatto sui nuovi servizi.

## Timeline
11:00 errori ORA-01653 · 11:30 fornitore contattato · 14:00 tablespace esteso dal fornitore · 16:00 riavvio e verifica.

## Causa radice
Crescita del tablespace non monitorata; il fornitore non aveva allarmi configurati.

## Risoluzione
Tablespace esteso dal fornitore; monitoraggio aggiunto dal fornitore.

## Azioni successive
Nessuna azione lato nostro: il sistema è in dismissione (ADR-017). Questo incidente è conservato come storico.
