---
type: "Post-mortem"
title: "Post-mortem INC-2026-007: dipendenza dalle sole ricevute push di pagoPA"
description: "Perché un degrado del nodo pagoPA è diventato 14 ore di avvisi 'non pagati'."
tags: ["post-mortem", "postmortem", "incident-review", "analisi"]
lang: "it"
relations:
  - type: "documents"
    target: "okf://atlas/incidents/inc-2026-007-pagopa-timeout"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-007"
    author: "process:incident-sync"
  - id: "wiki"
    resource: "https://wiki.tessera.internal/postmortems/pm-2026-007-pagopa-timeout"
generated:
  at: "2026-03-03T12:00:00Z"
  by: "human:giorgio.leone"
verified:
  by: "human:lucia.bernardi"
  at: "2026-10-18T14:00:00Z"
status: "stable"
---

# Post-mortem INC-2026-007: dipendenza dalle sole ricevute push di pagoPA

Incidente: [inc-2026-007-pagopa-timeout](../incidents/inc-2026-007-pagopa-timeout.md)

## Sintesi
Il nodo pagoPA ha risposto in timeout per 14 ore. La riconciliazione dipendeva solo dalle ricevute telematiche inviate dal nodo: senza polling dello stato degli avvisi, il ritardo del nodo è diventato il nostro.

## Fattori concorrenti
- Nessun job di polling dello stato degli avvisi in attesa.
- I solleciti per le sanzioni partivano in automatico dopo 48 ore senza verificare lo stato al nodo.
- La procedura manuale di riconciliazione esisteva solo nella memoria di una persona.

## Cosa ha funzionato
L'assistenza pagoPA ha confermato il degrado in 3 ore; il team ha sospeso i solleciti prima che partissero in massa.

## Azioni
1. Job di polling ogni 30 minuti per gli avvisi in attesa da più di 2 ore (fatto).
2. Runbook di riconciliazione manuale scritto e provato (fatto).
3. Solleciti bloccati finché lo stato non è confermato dal nodo (fatto).

## Lezione
Ogni integrazione push ha bisogno di un percorso pull per la riconciliazione.
