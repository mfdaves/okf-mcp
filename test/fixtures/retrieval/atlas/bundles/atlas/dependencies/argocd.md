---
type: "Dependency"
title: "Argo CD"
description: "GitOps controller proposed in ADR-021 (draft); running in staging only."
tags: ["dependency", "platform", "piattaforma"]
lang: "en"
version: "2.12"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://argo-cd.readthedocs.io/"
generated:
  at: "2026-05-17T08:00:00Z"
  by: "agent/arch-atlas"
verified:
  by: "human:davide.colombo"
  at: "2026-08-03T13:00:00Z"
status: "draft"
stale_after: "2026-12-31"
---

# Argo CD

GitOps controller proposed in ADR-021 (draft); running in staging only.

**Version:** 2.12 · **Kind:** platform · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
staging deployments of platform services; production adoption pending the ADR.

## Support end
Project release line; minor every 3 months.

## Upgrade notes
Drift correction must be tested against the emergency fast-track path before production.
