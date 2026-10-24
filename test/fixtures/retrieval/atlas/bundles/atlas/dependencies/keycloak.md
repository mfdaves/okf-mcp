---
type: "Dependency"
title: "Keycloak 25"
description: "Identity provider for citizens (SPID, CIE, password) and operators (SAML)."
tags: ["dependency", "identity", "identita"]
lang: "en"
version: "25.0"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-identita"
sources:
  - id: "vendor"
    resource: "https://www.keycloak.org/"
generated:
  at: "2026-07-08T16:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2026-01-31"
---

# Keycloak 25

Identity provider for citizens (SPID, CIE, password) and operators (SAML).

**Version:** 25.0 · **Kind:** identity · **Owner:** [team-identita](../teams/team-identita.md)

## Where it is used
identity-service realms, JWT issuance for the API gateway, consent-manager account events.

## Support end
Upstream supports the latest major only; 26 released.

## Upgrade notes
Upgrade to 26 blocked by the custom SPID attribute mapper; rewrite scheduled with the identity team.
