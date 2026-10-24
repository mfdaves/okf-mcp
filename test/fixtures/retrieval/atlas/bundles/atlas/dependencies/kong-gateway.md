---
type: "Dependency"
title: "Kong Gateway 3.8 (OSS)"
description: "Edge API gateway (ADR-013) with declarative configuration."
tags: ["dependency", "gateway", "piattaforma"]
lang: "en"
version: "3.8"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://konghq.com/"
generated:
  at: "2026-07-12T13:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2026-12-31"
---

# Kong Gateway 3.8 (OSS)

Edge API gateway (ADR-013) with declarative configuration.

**Version:** 3.8 · **Kind:** gateway · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
api-gateway: JWT, rate limiting, routing by URL version, TLS termination with cert-manager.

## Support end
OSS release line; minor every quarter.

## Upgrade notes
Declarative config validated in CI with deck; plugins limited to four.
