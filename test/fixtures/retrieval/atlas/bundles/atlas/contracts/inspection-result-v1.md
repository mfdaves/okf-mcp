---
type: "Data Contract"
title: "InspectionResult v1"
description: "Esito di una verifica a bordo da parte di un controllore."
tags: ["contract", "event", "biglietti", "contratto"]
aliases: ["ticketing.inspections.v1"]
lang: "it"
channel: "ticketing.inspections.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
generated:
  at: "2025-12-14T11:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:elena.marino"
  at: "2026-09-09T14:00:00Z"
status: "stable"
---

# InspectionResult v1

Esito di una verifica a bordo da parte di un controllore.

**Tipo:** evento · **Topic:** `ticketing.inspections.v1` · **Formato:** Avro · **Owner:** [team-biglietti](../teams/team-biglietti.md)

## Campi
- inspection_id
- device_id + sequence (chiave di idempotenza)
- ticket_id (opzionale)
- outcome (enum: VALID, NOT_VALIDATED, EXPIRED, BLOCKED, NO_TICKET)
- fine_issued (boolean)
- inspected_at
- synced_at

## Compatibilità
BACKWARD.

## Dati personali
Nessun dato personale: la sanzione con i dati anagrafici resta nel backend dei controllori.

## Conservazione
Kafka 90 giorni; warehouse 10 anni.

## Note
synced_at può distare ore da inspected_at quando l'app era offline.
