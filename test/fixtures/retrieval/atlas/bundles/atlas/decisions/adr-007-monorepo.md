---
type: "Decision"
title: "ADR-007 (superseded): Single monorepo for all services"
description: "Superseded by ADR-015: the monorepo slowed CI and blurred ownership."
tags: ["adr", "decision", "adr-007"]
aliases: ["ADR-007"]
lang: "en"
decided_on: "2025-07-25"
relations:
  - type: "related_to"
    target: "okf://atlas/decisions/adr-015-polyrepo-per-team"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/007.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-03-18T13:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-26T14:00:00Z"
status: "deprecated"
stale_after: "2026-02-28"
---

# ADR-007 (superseded): Single monorepo for all services

**Status:** superseded · **Date:** 2025-07-25

## Context
At the start the platform had 6 services and 12 engineers; one repository simplified shared libraries and refactors.

## Decision
Keep every service in one Git repository with a shared build (Gradle composite + pnpm workspaces).

## Consequences
Worked until about 15 services; CI took 40 minutes and ownership of shared code was unclear. Replaced by one repository per team in ADR-015.

## Related
- [adr-015-polyrepo-per-team](../decisions/adr-015-polyrepo-per-team.md)
