---
type: "Decision"
title: "ADR-014: EMV contactless with token hashing, no PAN storage"
description: "Tap-to-ride with bank cards stores only a salted hash of the EMV token."
tags: ["adr", "decision", "adr-014"]
aliases: ["ADR-014"]
lang: "en"
decided_on: "2026-01-12"
relations:
  - type: "related_to"
    target: "okf://atlas/services/validator-gateway"
  - type: "related_to"
    target: "okf://atlas/contracts/ticket-validated-v2"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/014.md"
    author: "human:lucia.bernardi"
generated:
  at: "2025-10-25T07:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:lucia.bernardi"
  at: "2026-07-23T09:00:00Z"
status: "stable"
stale_after: "2026-03-31"
---

# ADR-014: EMV contactless with token hashing, no PAN storage

**Status:** accepted · **Date:** 2026-01-12

## Context
Tap-to-ride with contactless bank cards requires recognising the same card across validations without storing the PAN (PCI DSS).

## Decision
Validators compute an HMAC of the EMV token with a daily key; the ledger stores only the hash; the PSP maps the token to a payment at aggregation time.

## Consequences
PCI scope stays at the validator firmware and the PSP; cap aggregation across days needs the key rotation schedule in the ledger.

## Related
- [validator-gateway](../services/validator-gateway.md)
- [ticket-validated-v2](../contracts/ticket-validated-v2.md)
