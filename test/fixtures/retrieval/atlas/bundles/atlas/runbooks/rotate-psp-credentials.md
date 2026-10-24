---
type: "Runbook"
title: "Rotate PSP credentials (Nexi XPay and fallback)"
description: "Quarterly rotation of API keys and webhook secrets for both PSP adapters without dropping payments."
tags: ["runbook", "operations", "payments-orchestrator"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/payments-orchestrator"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/rotate-psp-credentials"
generated:
  at: "2025-12-24T16:00:00Z"
  by: "human:sara.greco"
status: "stable"
stale_after: "2027-02-28"
---

# Rotate PSP credentials (Nexi XPay and fallback)

Quarterly rotation of API keys and webhook secrets for both PSP adapters without dropping payments.

Services: [payments-orchestrator](../services/payments-orchestrator.md)

## When to use
Quarterly schedule (first week of January, April, July, October) or immediately after a suspected leak.

## Prerequisites
Access to the PSP merchant back office, the secrets manager and the payments deployment pipeline. Two people from team pagamenti (four-eyes).

## Steps
1. Generate the new key in the PSP back office; keep the old key active.
2. Store the new key in the secrets manager under the next version.
3. Deploy payments-orchestrator with both keys: new for outbound calls, old and new accepted for webhook signatures.
4. Verify a 1 euro authorization and refund in production.
5. After 24 hours revoke the old key at the PSP and remove it from the manager.

## Rollback
Point the outbound key back to the previous secret version and redeploy; webhooks keep working because both signatures are accepted during the window.

## Escalation
Payments on-call; PSP support line in the vendor concept. A failed step 4 is a SEV2 if authorization success drops below the SLO.
