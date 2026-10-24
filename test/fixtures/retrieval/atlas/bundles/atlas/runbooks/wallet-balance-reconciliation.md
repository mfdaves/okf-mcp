---
type: "Runbook"
title: "Nightly wallet balance reconciliation"
description: "Compare wallet balances and transactions with PSP settlement files and FareComputed events; resolve mismatches."
tags: ["runbook", "operations", "wallet-service", "payments-orchestrator"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/wallet-service"
  - type: "runbook_for"
    target: "okf://atlas/services/payments-orchestrator"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/wallet-balance-reconciliation"
generated:
  at: "2026-09-25T13:00:00Z"
  by: "human:andrea.moretti"
verified:
  by: "human:davide.colombo"
  at: "2026-07-03T08:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# Nightly wallet balance reconciliation

Compare wallet balances and transactions with PSP settlement files and FareComputed events; resolve mismatches.

Services: [wallet-service](../services/wallet-service.md), [payments-orchestrator](../services/payments-orchestrator.md)

## When to use
Every night at 04:00 (automated) and after any incident involving debits, top-ups or refunds.

## Prerequisites
Settlement file from the PSP (SFTP), the warehouse marts, the reconciliation console.

## Steps
1. The job compares top-ups with PSP captures, debits with FareComputed, and balance_after with the projection.
2. Review the mismatch report: categories are missing capture, duplicate debit, projection lag.
3. Missing capture: re-run the capture through payments-orchestrator with the same payment id (idempotent).
4. Duplicate debit: issue a reversal command with the duplicate's transaction id as reference.
5. Projection lag over 1 minute: rebuild the read model for the affected wallets.

## Rollback
Reversals are themselves events and can be reversed; never edit the event store.

## Escalation
Payments on-call; finance for mismatches over 1,000 euro per night.
