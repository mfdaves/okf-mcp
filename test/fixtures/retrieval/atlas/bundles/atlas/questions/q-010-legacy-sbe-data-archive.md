---
type: "Open Question"
title: "Questione aperta: archiviazione dei dati storici del legacy SBE"
description: "Prima dello spegnimento di marzo 2027 vanno conservati 12 anni di dati Oracle con obblighi fiscali."
tags: ["open-question", "architecture", "questione-aperta"]
lang: "it"
owner: "human:elena.marino"
due: "2026-12-31"
relations:
  - type: "related_to"
    target: "okf://atlas/services/legacy-sbe"
  - type: "related_to"
    target: "okf://atlas/decisions/adr-017-retire-legacy-sbe"
generated:
  at: "2026-08-08T10:00:00Z"
  by: "human:lucia.bernardi"
status: "stable"
---

# Questione aperta: archiviazione dei dati storici del legacy SBE

Prima dello spegnimento di marzo 2027 vanno conservati 12 anni di dati Oracle con obblighi fiscali.

## Domanda
Esportare in Parquet nel warehouse (ClickHouse) con conservazione 10 anni, mantenere un'istanza Oracle in sola lettura, o affidare l'archivio al fornitore?

## Opzioni
1. Export in Parquet verso l'object storage e tabelle esterne in ClickHouse.
2. Oracle in sola lettura per 10 anni (licenza ridotta).
3. Archivio presso il fornitore con accesso su richiesta.

## Orientamento attuale
Opzione 1; verifica legale sul formato per le ispezioni fiscali in corso.

## Owner e scadenza
`human:elena.marino` · 2026-12-31

## Collegamenti
- [legacy-sbe](../services/legacy-sbe.md)
- [adr-017-retire-legacy-sbe](../decisions/adr-017-retire-legacy-sbe.md)
