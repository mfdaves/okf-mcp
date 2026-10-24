---
type: "Dependency"
title: "Redis 7"
description: "De-duplication windows, read caches and rate-limit counters."
tags: ["dependency", "cache", "piattaforma"]
lang: "en"
version: "7.2"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://redis.io/"
generated:
  at: "2025-12-16T17:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2026-09-30"
---

# Redis 7

De-duplication windows, read caches and rate-limit counters.

**Version:** 7.2 · **Kind:** cache · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
validator-gateway de-duplication (72-hour keys), BFF response cache, notification rate limits, planner nearby-stops cache.

## Support end
7.2 security fixes until 2026-12; licence change evaluated (Valkey as alternative).

## Upgrade notes
Move to Valkey 8 is a draft proposal; API compatible for our usage.
