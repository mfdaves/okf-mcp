---
type: "Incident"
title: "INC-2026-022: Refund approvals stuck for 6 days"
description: "A manual kubectl command deleted the refund approval worker deployment; 1,150 refunds waited 6 days in the approval queue."
tags: ["incident", "sev3", "refund-service"]
aliases: ["INC-2026-022"]
lang: "en"
severity: "SEV3"
occurred_on: "2026-09-04"
relations:
  - type: "affects"
    target: "okf://atlas/services/refund-service"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/refund-queue-unstick"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-022"
    author: "process:incident-sync"
generated:
  at: "2026-10-05T11:00:00Z"
  by: "process:incident-sync"
status: "stable"
---

# INC-2026-022: Refund approvals stuck for 6 days

**Severity:** SEV3 · **Date:** 2026-09-04 · **Services:** [refund-service](../services/refund-service.md)

## Impact
1,150 refund requests over 50 euro not processed for 6 days; 240 customer complaints; SLO on refund turnaround breached for the month.

## Timeline
Day 0 worker deployment deleted during a manual cleanup · Day 2 first complaints, attributed to volume · Day 5 Temporal task queue backlog noticed · Day 6 deployment restored, backlog drained in 2 hours.

## Root cause
No drift detection for Kubernetes resources: the deletion was not reverted and no alert fired because the workflow metrics counted 'pending' as healthy.

## Resolution
Deployment restored from Git; alert on Temporal task queue age over 1 hour; approval queue age added to the refund SLO.

## Follow-ups
GitOps with automatic drift correction (ADR-021 draft); unstick runbook written.
