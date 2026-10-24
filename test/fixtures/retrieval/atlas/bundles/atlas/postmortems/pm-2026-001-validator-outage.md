---
type: "Post-mortem"
title: "Post-mortem INC-2026-001: certificato intermedio scaduto sul broker MQTT"
description: "Analisi dell'interruzione dei validatori di Bologna: catena di certificati non monitorata."
tags: ["post-mortem", "postmortem", "incident-review", "analisi"]
lang: "it"
relations:
  - type: "documents"
    target: "okf://atlas/incidents/inc-2026-001-validator-outage-bologna"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-001"
    author: "process:incident-sync"
  - id: "wiki"
    resource: "https://wiki.tessera.internal/postmortems/pm-2026-001-validator-outage"
generated:
  at: "2026-10-02T13:00:00Z"
  by: "human:giorgio.leone"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-22T17:00:00Z"
status: "stable"
---

# Post-mortem INC-2026-001: certificato intermedio scaduto sul broker MQTT

Incidente: [inc-2026-001-validator-outage-bologna](../incidents/inc-2026-001-validator-outage-bologna.md)

## Sintesi
Un certificato intermedio della CA di flotta è scaduto a mezzanotte; i validatori hanno rifiutato il broker per 3 ore e 40 minuti. Il monitoraggio controllava solo il certificato foglia del broker.

## Fattori concorrenti
- La CA di flotta era stata creata nel 2023 con un intermedio a 3 anni e nessun promemoria.
- Il controllo di scadenza usava `openssl s_client` sul solo certificato foglia.
- Il runbook di rinnovo descriveva solo i certificati pubblici gestiti da cert-manager.

## Cosa ha funzionato
La coda offline dei validatori (ADR-010) ha evitato rifiuti di salita; il drenaggio ordinato ha funzionato al primo tentativo.

## Azioni
1. Monitorare la scadenza dell'intera catena per ogni endpoint TLS (fatto, team piattaforma).
2. Inventario di tutti i certificati con scadenza entro 60 giorni nel runbook di rinnovo (fatto).
3. Esercitazione semestrale di rotazione della CA di flotta (prima: 2026-07).

## Lezione
Tutto ciò che scade va inventariato, non solo ciò che è automatizzato.
