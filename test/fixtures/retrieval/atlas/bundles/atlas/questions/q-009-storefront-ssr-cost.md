---
type: "Open Question"
title: "Open question: server-side rendering cost of the storefront"
description: "SSR costs 11 cents per thousand requests and was the DDoS surface; which routes really need it?"
tags: ["open-question", "architecture", "question"]
lang: "en"
owner: "human:davide.colombo"
due: "2026-12-31"
relations:
  - type: "related_to"
    target: "okf://atlas/services/web-storefront"
  - type: "related_to"
    target: "okf://atlas/incidents/inc-2026-029-storefront-ddos"
generated:
  at: "2026-08-06T08:00:00Z"
  by: "human:elena.marino"
status: "draft"
---

# Open question: server-side rendering cost of the storefront

SSR costs 11 cents per thousand requests and was the DDoS surface; which routes really need it?

## Question
Keep SSR for SEO-relevant pages only (fares, subscriptions) and move the planner and account pages to client rendering with a static shell? Or move the whole storefront to static with islands?

## Options
1. SSR only for public content pages; client rendering for planner and account.
2. Fully static shell with islands and edge caching.
3. Keep SSR, scale and protect with WAF (current state).

## Current leaning
Option 1 before the 2027 season.

## Owner and due date
`human:davide.colombo` · 2026-12-31

## Related
- [web-storefront](../services/web-storefront.md)
- [inc-2026-029-storefront-ddos](../incidents/inc-2026-029-storefront-ddos.md)
