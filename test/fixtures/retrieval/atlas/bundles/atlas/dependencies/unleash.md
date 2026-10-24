---
type: "Dependency"
title: "Unleash (self-hosted)"
description: "Feature flag service proposed in ADR-016 (draft); kill switch convention `kill.<service>.<feature>`."
tags: ["dependency", "platform", "piattaforma"]
lang: "en"
version: "6.1"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://www.getunleash.io/"
generated:
  at: "2026-01-17T15:00:00Z"
  by: "agent/arch-atlas"
verified:
  by: "human:davide.colombo"
  at: "2026-07-20T08:00:00Z"
status: "draft"
stale_after: "2027-02-28"
---

# Unleash (self-hosted)

Feature flag service proposed in ADR-016 (draft); kill switch convention `kill.<service>.<feature>`.

**Version:** 6.1 · **Kind:** platform · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
notification-hub marketing kill switch; fraud threshold flag; PSP failover flag.

## Support end
Open-source release line.

## Upgrade notes
SDKs cache the last known state, so an Unleash outage freezes flags rather than failing requests.
