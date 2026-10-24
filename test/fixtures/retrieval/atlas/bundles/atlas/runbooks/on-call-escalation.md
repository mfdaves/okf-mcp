---
type: "Runbook"
title: "On-call escalation and severity triage"
description: "Who to page, in which order, and how to declare a severity; includes DDoS triage."
tags: ["runbook", "operations"]
lang: "en"
relations:
  - type: "supersedes"
    target: "okf://atlas/runbooks/escalation-reperibilita-2025"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/on-call-escalation"
generated:
  at: "2026-07-25T16:00:00Z"
  by: "human:giorgio.leone"
verified:
  by: "human:davide.colombo"
  at: "2026-06-02T07:00:00Z"
status: "stable"
stale_after: "2026-12-31"
---

# On-call escalation and severity triage

Who to page, in which order, and how to declare a severity; includes DDoS triage.

## When to use
Any alert that is not resolved by the first responder in 15 minutes, any customer-facing impact, or any suspected attack.

## Prerequisites
PagerDuty access; the incident channel template; the severity levels from the standards bundle.

## Steps
1. Declare the severity (SEV1: all customers or payments down; SEV2: a region or a function; SEV3: degraded, workaround exists).
2. Page the owning team's rota (see the Team concepts) and, for SEV1-2, the platform on-call.
3. Open the incident channel and the tracker entry; assign an incident commander, who does not debug.
4. For suspected DDoS: enable the prepared WAF challenge rule on the attacked path, raise the autoscaling ceiling, then investigate.
5. Status update every 30 minutes for SEV1, every hour for SEV2.
6. After resolution, schedule the post-mortem within 5 working days for SEV1-2.

## Rollback
Not applicable.

## Escalation
SEV1 pages the CTO after 30 minutes without mitigation. Regional operators' NOC is informed for any validator or AVL impact.
