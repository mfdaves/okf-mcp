---
type: "Dependency"
title: "Kubernetes (managed EKS)"
description: "Container platform for every service; two clusters (production, staging) in eu-south-1."
tags: ["dependency", "platform", "piattaforma"]
lang: "en"
version: "1.31"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://kubernetes.io/releases/"
generated:
  at: "2026-10-13T10:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2026-09-30"
---

# Kubernetes (managed EKS)

Container platform for every service; two clusters (production, staging) in eu-south-1.

**Version:** 1.31 · **Kind:** platform · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
all deployments; cert-manager; Kong; autoscaling (HPA) with ceilings per service.

## Support end
EKS supports each minor for 14 months; 1.31 standard support until 2026-11.

## Upgrade notes
Upgrade to 1.32 scheduled for November 2026; manual kubectl changes are being replaced by GitOps (ADR-021 draft).
