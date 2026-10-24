---
type: "Decision"
title: "ADR-013: Kong as the API gateway"
description: "Kong Gateway (OSS) on Kubernetes fronts all public and partner APIs."
tags: ["adr", "decision", "adr-013"]
aliases: ["ADR-013"]
lang: "en"
decided_on: "2025-12-02"
relations:
  - type: "related_to"
    target: "okf://atlas/services/api-gateway"
  - type: "related_to"
    target: "okf://atlas/dependencies/kong-gateway"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/013.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-06-20T16:00:00Z"
  by: "human:andrea.moretti"
verified:
  by: "human:lucia.bernardi"
  at: "2026-08-17T08:00:00Z"
status: "stable"
stale_after: "2027-10-31"
---

# ADR-013: Kong as the API gateway

**Status:** accepted · **Date:** 2025-12-02

## Context
JWT validation, rate limiting and routing were duplicated in three BFFs.

## Decision
Deploy Kong Gateway 3.x with declarative configuration in Git; plugins limited to jwt, rate-limiting, request-transformer and prometheus.

## Consequences
One place for edge policy; Kong upgrades and certificate management become platform responsibilities (see the certificate expiry incident).

## Related
- [api-gateway](../services/api-gateway.md)
- [kong-gateway](../dependencies/kong-gateway.md)
