---
type: "Runbook"
title: "Use a kill switch flag"
description: "Turn off a risky feature at runtime through its kill switch flag, with the naming and audit rules."
tags: ["runbook", "operations"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/feature-flag-kill-switch"
generated:
  at: "2026-01-03T15:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:davide.colombo"
  at: "2026-07-04T15:00:00Z"
status: "stable"
stale_after: "2026-09-30"
---

# Use a kill switch flag

Turn off a risky feature at runtime through its kill switch flag, with the naming and audit rules.

## When to use
A feature causes errors or cost and a rollback would take longer than a flag flip.

## Prerequisites
Unleash admin access (draft adoption, ADR-016); the flag name `kill.<service>.<feature>` from the service's runbook section.

## Steps
1. Find the flag in Unleash; confirm the service reads it (last seen under 1 minute).
2. Enable the kill switch for the production environment; the SDK applies it within 30 seconds.
3. Verify the feature is off (metrics or a synthetic check) and announce in the incident channel.
4. Leave the flag on until the fix is deployed; remove the flag within 30 days after.

## Rollback
Disable the kill switch; the feature resumes within 30 seconds.

## Escalation
Owning team's on-call; platform on-call if Unleash itself is unavailable (SDKs keep the last known state).
