---
type: "Decision"
title: "ADR-001: Event sourcing for the prepaid wallet"
description: "The wallet is an event-sourced aggregate; balances are projections."
tags: ["adr", "decision", "adr-001"]
aliases: ["ADR-001"]
lang: "en"
decided_on: "2025-07-10"
relations:
  - type: "related_to"
    target: "okf://atlas/services/wallet-service"
  - type: "related_to"
    target: "okf://atlas/postmortems/pm-2026-004-wallet-double-charge"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/001.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-06-05T09:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-10-01T07:00:00Z"
status: "stable"
stale_after: "2027-10-31"
---

# ADR-001: Event sourcing for the prepaid wallet

**Status:** accepted · **Date:** 2025-07-10

## Context
The prepaid wallet must explain every cent to customers and auditors, support reversals months later and survive PSP reconciliation disputes. A mutable balance column cannot reconstruct history.

## Decision
Model each wallet as an event-sourced aggregate (Axon Framework) with commands validated against the replayed state. The balance read model is a projection that can be rebuilt from the event store at any time.

## Consequences
Audit and reconciliation become trivial; the cost is operational: projection lag, snapshotting every 200 events, and command idempotency has to be designed in (it was not, see the double-charge post-mortem).

## Related
- [wallet-service](../services/wallet-service.md)
- [pm-2026-004-wallet-double-charge](../postmortems/pm-2026-004-wallet-double-charge.md)
