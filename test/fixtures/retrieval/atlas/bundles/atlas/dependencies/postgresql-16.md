---
type: "Dependency"
title: "PostgreSQL 16 (managed)"
description: "Transactional database for most services; one managed instance per service with a synchronous replica."
tags: ["dependency", "database", "piattaforma"]
lang: "en"
version: "16.4"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://www.postgresql.org/support/versioning/"
generated:
  at: "2026-04-27T12:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2027-04-30"
---

# PostgreSQL 16 (managed)

Transactional database for most services; one managed instance per service with a synchronous replica.

**Version:** 16.4 · **Kind:** database · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
wallet event store, ledger (monthly partitions), fare tables, subscriptions, refunds, Keycloak, consents.

## Support end
2028-11 (community); managed engine deprecation announced 12 months ahead.

## Upgrade notes
Minor upgrades are applied in the maintenance window monthly; major upgrade to 17 planned for Q2 2027 after the partitioning question is settled.
