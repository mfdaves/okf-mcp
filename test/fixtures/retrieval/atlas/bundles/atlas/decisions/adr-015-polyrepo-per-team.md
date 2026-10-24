---
type: "Decision"
title: "ADR-015: One repository per team"
description: "Supersedes ADR-007: each team owns its repositories; shared libraries are versioned packages."
tags: ["adr", "decision", "adr-015"]
aliases: ["ADR-015"]
lang: "en"
decided_on: "2026-02-10"
relations:
  - type: "related_to"
    target: "okf://atlas/decisions/adr-007-monorepo"
  - type: "supersedes"
    target: "okf://atlas/decisions/adr-007-monorepo"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/015.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-05-18T10:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-05-26T08:00:00Z"
status: "stable"
stale_after: "2026-03-31"
---

# ADR-015: One repository per team

**Status:** accepted · **Date:** 2026-02-10

## Context
CI time and unclear ownership in the monorepo (ADR-007).

## Decision
Split the monorepo into one repository per team plus a platform-libraries repository publishing versioned packages; cross-team changes go through package versions.

## Consequences
CI under 10 minutes; dependency upgrades need coordination (Renovate opens the PRs).

## Related
- [adr-007-monorepo](../decisions/adr-007-monorepo.md)
