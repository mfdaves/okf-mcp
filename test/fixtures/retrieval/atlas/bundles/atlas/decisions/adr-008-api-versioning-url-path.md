---
type: "Decision"
title: "ADR-008: API versioning in the URL path"
description: "Public APIs carry the major version in the path (/v3/tickets); minor changes are additive."
tags: ["adr", "decision", "adr-008"]
aliases: ["ADR-008"]
lang: "en"
decided_on: "2025-10-01"
relations:
  - type: "related_to"
    target: "okf://atlas/services/api-gateway"
  - type: "related_to"
    target: "okf://atlas/contracts/api-tickets-v3"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/008.md"
    author: "human:lucia.bernardi"
generated:
  at: "2025-11-27T07:00:00Z"
  by: "human:andrea.moretti"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-07T12:00:00Z"
status: "stable"
stale_after: "2026-09-30"
---

# ADR-008: API versioning in the URL path

**Status:** accepted · **Date:** 2025-10-01

## Context
Partners and the apps need a stable contract; header-based versioning was invisible in logs and hard for partners.

## Decision
Major version in the first path segment, routed by the API gateway; additive changes within a major; a deprecated major is kept for 12 months with a Sunset header.

## Consequences
Clear in logs and documentation; multiple majors run side by side, which costs routing rules and double testing.

## Related
- [api-gateway](../services/api-gateway.md)
- [api-tickets-v3](../contracts/api-tickets-v3.md)
