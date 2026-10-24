---
type: "Decision"
title: "ADR-010: 72-hour offline validation window"
description: "Validators accept tickets offline for up to 72 hours and sync later; the ledger tolerates late events."
tags: ["adr", "decision", "adr-010"]
aliases: ["ADR-010"]
lang: "en"
decided_on: "2025-11-03"
relations:
  - type: "related_to"
    target: "okf://atlas/services/validator-gateway"
  - type: "related_to"
    target: "okf://atlas/contracts/ticket-validated-v2"
  - type: "related_to"
    target: "okf://atlas/runbooks/validator-offline-queue-drain"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/010.md"
    author: "human:lucia.bernardi"
generated:
  at: "2025-10-01T12:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:lucia.bernardi"
  at: "2026-05-15T17:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# ADR-010: 72-hour offline validation window

**Status:** accepted · **Date:** 2025-11-03

## Context
Rural lines lose mobile coverage for hours; validators must keep accepting tickets, and the revocation list must bound the fraud exposure.

## Decision
Validators keep a signed revocation list refreshed every 15 minutes when online and an offline queue of up to 72 hours. Drained events carry delayed=true; fare caps are settled when they arrive.

## Consequences
No denied boardings for coverage reasons; caps and inspections can be temporarily inconsistent, which the apps explain to the user.

## Related
- [validator-gateway](../services/validator-gateway.md)
- [ticket-validated-v2](../contracts/ticket-validated-v2.md)
- [validator-offline-queue-drain](../runbooks/validator-offline-queue-drain.md)
