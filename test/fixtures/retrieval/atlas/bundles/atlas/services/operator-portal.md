---
type: "Service"
title: "operator-portal"
description: "Portale di back-office per gli operatori regionali: cruscotti, rendicontazione, gestione flotta e tariffe."
tags: ["service", "dati", "servizio"]
aliases: ["operator-portal"]
lang: "it"
runtime: "React 19 / Vite, Node.js 22 BFF"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-dati"
  - type: "consumes"
    target: "okf://atlas/contracts/vehicle-position-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/keycloak"
  - type: "depends_on"
    target: "okf://atlas/dependencies/clickhouse"
generated:
  at: "2026-02-15T12:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:davide.colombo"
  at: "2026-06-12T12:00:00Z"
status: "stable"
---

# operator-portal

operator-portal è l'applicazione web usata dagli operatori regionali (TPL) per consultare validazioni e incassi, scaricare la rendicontazione mensile per la compensazione tra operatori, pubblicare le tabelle tariffarie e vedere lo stato della flotta (posizioni AVL, veicoli senza segnale). L'accesso avviene con SAML aziendale sul realm operatori. Non ha accesso ai dati personali dei viaggiatori: vede solo aggregati.

## Proprietà e runtime
Team: [team-dati](../teams/team-dati.md) · Runtime: React 19 / Vite, Node.js 22 BFF

## Interfacce
- Consuma [vehicle-position-v1](../contracts/vehicle-position-v1.md)

## Dipendenze
- [keycloak](../dependencies/keycloak.md)
- [clickhouse](../dependencies/clickhouse.md)

## Note operative
Le tabelle tariffarie pubblicate dal portale diventano attive nel fare-engine solo dopo l'approvazione del team biglietti.
