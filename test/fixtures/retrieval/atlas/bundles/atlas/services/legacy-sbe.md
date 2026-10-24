---
type: "Service"
title: "legacy-sbe (Sistema di Bigliettazione Elettronica)"
description: "Monolite storico di bigliettazione elettronica, in dismissione: resta solo per gli abbonamenti su tessera fisica fino a marzo 2027."
tags: ["service", "biglietti", "servizio"]
aliases: ["legacy-sbe"]
lang: "it"
runtime: "Java 8 monolite, Oracle 12c"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
generated:
  at: "2026-03-10T12:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:sara.greco"
  at: "2025-12-10T09:00:00Z"
status: "deprecated"
stale_after: "2026-03-31"
---

# legacy-sbe (Sistema di Bigliettazione Elettronica)

legacy-sbe è il sistema di bigliettazione elettronica in esercizio dal 2014: emissione su tessera contactless Mifare, validazione, rendicontazione. Dal 2025 le funzioni sono state migrate ai servizi del catalogo (ADR-017); restano attive solo le tessere fisiche degli abbonati annuali, che scadono entro marzo 2027. Non si sviluppano nuove funzionalità; le patch di sicurezza sono applicate dal fornitore.

## Proprietà e runtime
Team: [team-biglietti](../teams/team-biglietti.md) · Runtime: Java 8 monolite, Oracle 12c

## Interfacce
Nessuna interfaccia a eventi: solo accesso diretto al database.

## Dipendenze
Nessuna dipendenza censita nel catalogo (stack fornitore).

## Note operative
Il crash di novembre 2025 (tablespace Oracle pieno) è documentato nell'incidente storico. Il runbook di riavvio è deprecato insieme al servizio: in caso di problemi contattare il fornitore, non riavviare.

- Incidente: [inc-2025-041-legacy-sbe-crash](../incidents/inc-2025-041-legacy-sbe-crash.md)
