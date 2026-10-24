---
type: "Service"
title: "web-storefront"
description: "Public web shop for tickets and subscriptions, with the journey planner embedded."
tags: ["service", "piattaforma"]
aliases: ["web-storefront"]
lang: "en"
runtime: "Next.js 15 (SSR), Node.js 22"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
  - type: "depends_on"
    target: "okf://atlas/dependencies/kong-gateway"
  - type: "depends_on"
    target: "okf://atlas/dependencies/kubernetes-eks"
generated:
  at: "2026-02-11T12:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# web-storefront

web-storefront is the server-rendered public site: fares, ticket purchase, subscription purchase with SPID, and the planner. It talks to the same APIs as the apps through the API gateway. The DDoS of October 2026 saturated the SSR pods because planner searches were rendered server-side per request; the mitigation moved planner results to client-side fetching behind a challenge.

## Ownership and runtime
Team: [team-piattaforma](../teams/team-piattaforma.md) · Runtime: Next.js 15 (SSR), Node.js 22

## Interfaces
No event interfaces: direct database access only.

## Dependencies
- [kong-gateway](../dependencies/kong-gateway.md)
- [kubernetes-eks](../dependencies/kubernetes-eks.md)

## Operational notes
SSR cost per request is tracked in the open question on storefront rendering.

- Incident: [inc-2026-029-storefront-ddos](../incidents/inc-2026-029-storefront-ddos.md)
- Open question: [q-009-storefront-ssr-cost](../questions/q-009-storefront-ssr-cost.md)
