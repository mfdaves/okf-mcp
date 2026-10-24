---
type: "Post-mortem"
title: "Post-mortem INC-2026-029: layer-7 DDoS on server-rendered planner searches"
description: "The storefront rendered planner results server-side per request; the attack targeted that path."
tags: ["post-mortem", "postmortem", "incident-review"]
lang: "en"
relations:
  - type: "documents"
    target: "okf://atlas/incidents/inc-2026-029-storefront-ddos"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-029"
    author: "process:incident-sync"
  - id: "wiki"
    resource: "https://wiki.tessera.internal/postmortems/pm-2026-029-storefront-ddos"
generated:
  at: "2026-06-22T14:00:00Z"
  by: "human:giorgio.leone"
verified:
  by: "human:lucia.bernardi"
  at: "2026-06-06T17:00:00Z"
status: "stable"
---

# Post-mortem INC-2026-029: layer-7 DDoS on server-rendered planner searches

Incident: [inc-2026-029-storefront-ddos](../incidents/inc-2026-029-storefront-ddos.md)

## Summary
40,000 requests per second from about 30,000 IP addresses hit the storefront planner page. Each request triggered a server-side planner call and a full render; SSR pods saturated within 5 minutes and the storefront returned 502 for 55 minutes.

## Contributing factors
- Most expensive path exposed without a challenge or cache.
- Rate limiting per IP is ineffective against a distributed attack.
- Autoscaling ceiling was sized for organic peaks only.

## What went well
The API gateway kept the apps healthy because the attack came through the storefront origin; the WAF challenge was enabled in 20 minutes with a prepared rule.

## Action items
1. Managed challenge on anonymous planner traffic from the web (done).
2. Planner results fetched client-side with caching (done).
3. SSR cost review per route (open question).
4. DDoS triage added to the on-call escalation runbook (done).

## Lessons
Cost asymmetry is the attack surface: never let an anonymous request cost more than a cache lookup.
