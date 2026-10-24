---
type: "Decision"
title: "ADR-004: Keycloak come identity provider per SPID e CIE"
description: "Keycloak gestisce i realm cittadini e operatori; SPID e CIE sono identity provider federati."
tags: ["adr", "decision", "adr-004", "decisione"]
aliases: ["ADR-004"]
lang: "it"
decided_on: "2025-08-20"
relations:
  - type: "related_to"
    target: "okf://atlas/services/identity-service"
  - type: "related_to"
    target: "okf://atlas/dependencies/keycloak"
  - type: "related_to"
    target: "okf://atlas/incidents/inc-2026-013-spid-login-down"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/004.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-06-23T16:00:00Z"
  by: "human:andrea.moretti"
verified:
  by: "human:lucia.bernardi"
  at: "2026-08-24T14:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# ADR-004: Keycloak come identity provider per SPID e CIE

**Stato:** accettata · **Data:** 2025-08-20

## Contesto
L'accesso con SPID (livello 2) e CIE è obbligatorio per gli abbonamenti con agevolazioni fiscali; gli operatori accedono con SAML aziendale. Servono due popolazioni separate, sessioni, token e un registro degli accessi.

## Decisione
Adottare Keycloak 25 con due realm (cittadini, operatori). SPID e CIE sono configurati come identity provider SAML federati con i metadati aggiornati automaticamente; le estensioni custom restano minime (mappatura attributi, livello SPID nel token).

## Conseguenze
Tempi brevi e conformità alle regole tecniche AgID; dipendenza dalla rotazione dei metadati degli IdP (causa dell'incidente di aprile 2026). Il login CIE da mobile resta una questione aperta.

## Collegamenti
- [identity-service](../services/identity-service.md)
- [keycloak](../dependencies/keycloak.md)
- [inc-2026-013-spid-login-down](../incidents/inc-2026-013-spid-login-down.md)
