---
type: "Service"
title: "identity-service"
description: "Accounts, SPID and CIE login, sessions and tokens for apps, storefront and operator portal."
tags: ["service", "identita"]
aliases: ["identity-service"]
lang: "en"
runtime: "Keycloak 25 extensions (Java), PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-identita"
  - type: "produces"
    target: "okf://atlas/contracts/account-created-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/keycloak"
  - type: "depends_on"
    target: "okf://atlas/dependencies/spid-cie-idp"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "measured_by"
    target: "okf://atlas/slos/identity-service-login-availability"
generated:
  at: "2026-06-23T11:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# identity-service

identity-service is a thin layer over Keycloak realms (ADR-004): one realm for citizens with SPID and CIE identity providers, one for operators with corporate SAML. It issues the JWTs that the API gateway validates and publishes AccountCreated events. SPID level 2 is required for subscription purchases with tax benefits; CIE login from mobile is still an open question.

## Ownership and runtime
Team: [team-identita](../teams/team-identita.md) · Runtime: Keycloak 25 extensions (Java), PostgreSQL

## Interfaces
- Produces [account-created-v1](../contracts/account-created-v1.md)

## Dependencies
- [keycloak](../dependencies/keycloak.md)
- [spid-cie-idp](../dependencies/spid-cie-idp.md)
- [postgresql-16](../dependencies/postgresql-16.md)

## Operational notes
The SPID login outage of April 2026 was caused by an identity provider metadata rotation we did not pick up; metadata is now refreshed hourly and alerted on signature failures.

- SLO: [identity-service-login-availability](../slos/identity-service-login-availability.md)
- Incident: [inc-2026-013-spid-login-down](../incidents/inc-2026-013-spid-login-down.md)
- Open question: [q-008-cie-mobile-login](../questions/q-008-cie-mobile-login.md)
