---
type: "Runbook"
title: "Incident severity triage checklist"
description: "Five questions that set the severity of an incident consistently across teams."
tags: ["runbook", "operations"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/incident-severity-triage"
generated:
  at: "2025-09-23T16:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:davide.colombo"
  at: "2026-07-14T09:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# Incident severity triage checklist

Five questions that set the severity of an incident consistently across teams.

## When to use
At incident declaration and every time the impact changes.

## Prerequisites
The severity levels standard; the current impact estimate.

## Steps
1. Are payments or validations down for everyone? SEV1.
2. Is a whole function (login, planner, refunds) or a whole region down, or money wrong for many customers? SEV2.
3. Is there degradation with a workaround, or a partner-only impact? SEV3.
4. Is it internal only with no customer impact? SEV4, no page.
5. When in doubt, pick the higher severity and downgrade later with a note.

## Rollback
Not applicable.

## Escalation
The incident commander decides; the CTO can override.
