---
type: "Decision"
title: "ADR-018: Nexi XPay as primary PSP with a warm fallback"
description: "Nexi XPay handles card payments; a second PSP adapter is kept configured for failover."
tags: ["adr", "decision", "adr-018"]
aliases: ["ADR-018"]
lang: "en"
decided_on: "2026-04-08"
relations:
  - type: "related_to"
    target: "okf://atlas/services/payments-orchestrator"
  - type: "related_to"
    target: "okf://atlas/dependencies/nexi-xpay"
  - type: "related_to"
    target: "okf://atlas/runbooks/rotate-psp-credentials"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/018.md"
    author: "human:lucia.bernardi"
generated:
  at: "2025-10-02T11:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-09-05T10:00:00Z"
status: "stable"
stale_after: "2026-03-31"
---

# ADR-018: Nexi XPay as primary PSP with a warm fallback

**Status:** accepted · **Date:** 2026-04-08

## Context
The previous PSP had two multi-hour outages in 2025 and no Italian acquiring for Bancomat Pay.

## Decision
Route all card payments to Nexi XPay; keep a second adapter deployed and tested monthly with a 1% traffic canary; switch by feature flag.

## Consequences
Failover in minutes; two PSP contracts and two credential rotations to maintain.

## Related
- [payments-orchestrator](../services/payments-orchestrator.md)
- [nexi-xpay](../dependencies/nexi-xpay.md)
- [rotate-psp-credentials](../runbooks/rotate-psp-credentials.md)
