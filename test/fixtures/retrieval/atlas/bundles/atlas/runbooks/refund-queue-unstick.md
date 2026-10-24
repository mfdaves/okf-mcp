---
type: "Runbook"
title: "Unstick the refund approval queue"
description: "Restore the approval worker and drain Temporal task queues that accumulated."
tags: ["runbook", "operations", "refund-service"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/refund-service"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/refund-queue-unstick"
generated:
  at: "2025-11-04T12:00:00Z"
  by: "human:andrea.moretti"
verified:
  by: "human:davide.colombo"
  at: "2026-05-27T13:00:00Z"
status: "stable"
stale_after: "2027-10-31"
---

# Unstick the refund approval queue

Restore the approval worker and drain Temporal task queues that accumulated.

Services: [refund-service](../services/refund-service.md)

## When to use
Alert on Temporal task queue age over 1 hour, or refunds pending approval growing for more than a day.

## Prerequisites
Access to the Temporal UI and the refund-service deployment in Git.

## Steps
1. Check that the approval worker deployment exists and has ready pods (`kubectl get deploy refund-approval-worker`).
2. If missing, re-apply from Git (do not create it by hand).
3. In the Temporal UI confirm the task queue backlog is draining; expected rate 10 refunds per second.
4. Spot-check 3 refunds for correct amounts before announcing recovery.
5. Update the refund SLO annotation with the outage window.

## Rollback
Scale the worker to 0 if refunds are executed with wrong amounts; workflows pause safely.

## Escalation
Payments on-call; finance for refunds over 10,000 euro aggregated.
