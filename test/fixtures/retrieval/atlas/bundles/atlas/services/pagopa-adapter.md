---
type: "Service"
title: "pagopa-adapter"
description: "Integrazione con la piattaforma pagoPA per abbonamenti e sanzioni: creazione avvisi, ricezione delle ricevute telematiche (RT), riconciliazione."
tags: ["service", "pagamenti", "servizio"]
aliases: ["pagopa-adapter"]
lang: "it"
runtime: "Java 21 / Spring Boot 3, PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-pagamenti"
  - type: "produces"
    target: "okf://atlas/contracts/payment-authorized-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/pagopa-platform"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "measured_by"
    target: "okf://atlas/slos/pagopa-adapter-rt-delivery"
generated:
  at: "2026-08-15T15:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# pagopa-adapter

pagopa-adapter genera gli avvisi di pagamento pagoPA per gli abbonamenti annuali e per le sanzioni elevate dai controllori, riceve le ricevute telematiche (RT) dal nodo e le riconcilia con gli ordini interni. L'integrazione è diretta con il nodo dei pagamenti (ADR-009), senza intermediario tecnologico. Gli avvisi non pagati scadono dopo 30 giorni e vengono annullati in batch notturno.

## Proprietà e runtime
Team: [team-pagamenti](../teams/team-pagamenti.md) · Runtime: Java 21 / Spring Boot 3, PostgreSQL

## Interfacce
- Produce [payment-authorized-v1](../contracts/payment-authorized-v1.md)

## Dipendenze
- [pagopa-platform](../dependencies/pagopa-platform.md)
- [postgresql-16](../dependencies/postgresql-16.md)

## Note operative
L'incidente di marzo 2026 (timeout del nodo) ha lasciato 1.900 RT non riconciliate per 14 ore: la procedura di riconciliazione manuale è nel runbook dedicato. Le RT arrivano anche a distanza di giorni: non trattare mai un avviso come non pagato prima della scadenza.

- SLO: [pagopa-adapter-rt-delivery](../slos/pagopa-adapter-rt-delivery.md)
- Incidente: [inc-2026-007-pagopa-timeout](../incidents/inc-2026-007-pagopa-timeout.md)
