---
type: "Decision"
title: "ADR-021 (draft): GitOps deployments with Argo CD"
description: "Draft: every deployment is a Git commit reconciled by Argo CD; no kubectl apply from laptops."
tags: ["adr", "decision", "adr-021"]
aliases: ["ADR-021"]
lang: "en"
decided_on: "2026-09-02"
relations:
  - type: "related_to"
    target: "okf://atlas/dependencies/argocd"
  - type: "related_to"
    target: "okf://atlas/incidents/inc-2026-022-refund-queue-stuck"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/021.md"
    author: "human:lucia.bernardi"
generated:
  at: "2025-07-12T15:00:00Z"
  by: "human:andrea.moretti"
status: "draft"
---

# ADR-021 (draft): GitOps deployments with Argo CD

**Status:** proposed · **Date:** 2026-09-02

## Context
The refund worker deployment was deleted by a manual kubectl command in September 2026.

## Decision
Adopt Argo CD with one application per service and environment; manual changes to the cluster are reverted automatically; emergency changes go through a fast-track PR.

## Consequences
Auditable deployments and drift correction; teams must learn the PR-based emergency path. Under review by the platform team.

## Related
- [argocd](../dependencies/argocd.md)
- [inc-2026-022-refund-queue-stuck](../incidents/inc-2026-022-refund-queue-stuck.md)
