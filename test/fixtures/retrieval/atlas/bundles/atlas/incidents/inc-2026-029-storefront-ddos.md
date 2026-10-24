---
type: "Incident"
title: "INC-2026-029: DDoS on the web storefront planner"
description: "A layer-7 DDoS of 40,000 requests per second on planner searches saturated the SSR pods; the storefront was unavailable for 55 minutes."
tags: ["incident", "sev1", "web-storefront", "api-gateway"]
aliases: ["INC-2026-029"]
lang: "en"
severity: "SEV1"
occurred_on: "2026-10-07"
relations:
  - type: "affects"
    target: "okf://atlas/services/web-storefront"
  - type: "affects"
    target: "okf://atlas/services/api-gateway"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/on-call-escalation"
  - type: "documented_in"
    target: "okf://atlas/postmortems/pm-2026-029-storefront-ddos"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-029"
    author: "process:incident-sync"
generated:
  at: "2026-01-06T16:00:00Z"
  by: "process:incident-sync"
verified:
  by: "human:giorgio.leone"
  at: "2026-09-09T14:00:00Z"
status: "stable"
---

# INC-2026-029: DDoS on the web storefront planner

**Severity:** SEV1 · **Date:** 2026-10-07 · **Services:** [web-storefront](../services/web-storefront.md), [api-gateway](../services/api-gateway.md)

## Impact
Web storefront unavailable for 55 minutes during the morning peak; apps unaffected; 1,200 lost web purchases estimated.

## Timeline
07:40 traffic spike on /v1/planner/plan through the storefront · 07:45 SSR pods at CPU limit, 502s · 07:50 incident opened, SEV1 · 08:10 WAF challenge enabled on the planner path · 08:20 planner moved to client-side fetch · 08:35 storefront healthy.

## Root cause
Planner results were rendered server-side per request with no cache and no challenge; the attack targeted the most expensive path. Rate limits applied per IP, and the attack used 30,000 IPs.

## Resolution
WAF managed challenge on planner requests from the storefront; client-side fetching; autoscaling ceiling raised.

## Follow-ups
Cost of SSR per route reviewed (open question); challenge kept for anonymous planner traffic; runbook for DDoS triage in the on-call escalation document.

Post-mortem: [pm-2026-029-storefront-ddos](../postmortems/pm-2026-029-storefront-ddos.md)
