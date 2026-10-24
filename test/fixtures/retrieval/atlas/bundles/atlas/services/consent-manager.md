---
type: "Service"
title: "consent-manager"
description: "Gestione dei consensi GDPR (marketing, profilazione, geolocalizzazione) e delle richieste di cancellazione."
tags: ["service", "identita", "servizio"]
aliases: ["consent-manager"]
lang: "it"
runtime: "Node.js 22 / Fastify, PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-identita"
  - type: "produces"
    target: "okf://atlas/contracts/consent-changed-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/account-created-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
generated:
  at: "2026-08-15T10:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:davide.colombo"
  at: "2026-05-26T16:00:00Z"
status: "stable"
---

# consent-manager

consent-manager registra i consensi espressi dagli utenti nelle app e nello storefront, con versione dell'informativa e timestamp, e pubblica ConsentChanged per i servizi che devono adeguarsi (notification-hub smette di inviare marketing entro 5 minuti). Gestisce anche le richieste di cancellazione dell'account: orchestra l'anonimizzazione nel ledger delle validazioni e nel warehouse entro 30 giorni.

## Proprietà e runtime
Team: [team-identita](../teams/team-identita.md) · Runtime: Node.js 22 / Fastify, PostgreSQL

## Interfacce
- Produce [consent-changed-v1](../contracts/consent-changed-v1.md)
- Consuma [account-created-v1](../contracts/account-created-v1.md)

## Dipendenze
- [postgresql-16](../dependencies/postgresql-16.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Note operative
Il registro dei trattamenti è nel wiki legale; questo servizio ne è l'implementazione tecnica. Le cancellazioni non toccano gli aggregati fiscali (10 anni).
