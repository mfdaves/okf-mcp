---
type: "Data Contract"
title: "ConsentChanged v1"
description: "Cambio di stato di un consenso GDPR (marketing, profilazione, geolocalizzazione)."
tags: ["contract", "event", "identita", "contratto"]
aliases: ["identity.consents.v1"]
lang: "it"
channel: "identity.consents.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-identita"
generated:
  at: "2026-04-16T13:00:00Z"
  by: "process:schema-registry-sync"
status: "stable"
---

# ConsentChanged v1

Cambio di stato di un consenso GDPR (marketing, profilazione, geolocalizzazione).

**Tipo:** evento · **Topic:** `identity.consents.v1` · **Formato:** Avro · **Owner:** [team-identita](../teams/team-identita.md)

## Campi
- account_id
- purpose (enum: MARKETING, PROFILING, GEOLOCATION)
- granted (boolean)
- policy_version
- changed_at

## Compatibilità
BACKWARD.

## Dati personali
Solo account_id.

## Conservazione
Kafka 30 giorni; registro consensi 10 anni.

## Note
notification-hub deve applicare la revoca del marketing entro 5 minuti dalla ricezione.
