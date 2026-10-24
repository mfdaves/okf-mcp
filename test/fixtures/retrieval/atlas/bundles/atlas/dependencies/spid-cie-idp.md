---
type: "Dependency"
title: "Identity provider SPID e CIE"
description: "Federazione con gli identity provider SPID accreditati e con CIE id per l'accesso dei cittadini."
tags: ["dependency", "vendor", "identita", "dipendenza"]
lang: "it"
version: "Regole tecniche AgID 2026"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-identita"
sources:
  - id: "vendor"
    resource: "https://www.spid.gov.it/"
generated:
  at: "2026-06-02T11:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2027-10-31"
---

# Identity provider SPID e CIE

Federazione con gli identity provider SPID accreditati e con CIE id per l'accesso dei cittadini.

**Versione:** Regole tecniche AgID 2026 · **Tipo:** vendor · **Owner:** [team-identita](../teams/team-identita.md)

## Dove si usa
identity-service tramite Keycloak: metadati SAML aggiornati ogni ora, livello SPID nel token.

## Fine supporto
Gli IdP ruotano i certificati senza preavviso: i metadati vanno ricaricati di frequente (INC-2026-013).

## Note di aggiornamento
Il login CIE da mobile con app CieID è in valutazione (questione aperta).
