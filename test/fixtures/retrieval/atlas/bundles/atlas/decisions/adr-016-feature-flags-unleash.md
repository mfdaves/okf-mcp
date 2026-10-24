---
type: "Decision"
title: "ADR-016 (draft): Unleash for feature flags and kill switches"
description: "Draft: adopt Unleash self-hosted for flags, with a kill switch convention."
tags: ["adr", "decision", "adr-016"]
aliases: ["ADR-016"]
lang: "en"
decided_on: "2026-06-18"
relations:
  - type: "related_to"
    target: "okf://atlas/dependencies/unleash"
  - type: "related_to"
    target: "okf://atlas/runbooks/feature-flag-kill-switch"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/016.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-05-01T14:00:00Z"
  by: "human:lucia.bernardi"
status: "draft"
---

# ADR-016 (draft): Unleash for feature flags and kill switches

**Status:** proposed · **Date:** 2026-06-18

## Context
Flags live in environment variables and config maps; turning a feature off needs a deployment.

## Decision
Adopt Unleash (self-hosted) with SDKs in every service; every risky feature ships with a kill switch flag named kill.<service>.<feature>.

## Consequences
Runtime toggles without deployments; another stateful component to run. Not yet approved.

## Related
- [unleash](../dependencies/unleash.md)
- [feature-flag-kill-switch](../runbooks/feature-flag-kill-switch.md)
