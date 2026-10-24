---
type: "Service"
title: "api-gateway"
description: "Edge gateway: TLS termination, JWT validation, rate limiting, routing and API versioning by URL path."
tags: ["service", "piattaforma"]
aliases: ["api-gateway"]
lang: "en"
runtime: "Kong Gateway 3.8 on Kubernetes"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
  - type: "depends_on"
    target: "okf://atlas/dependencies/kong-gateway"
  - type: "depends_on"
    target: "okf://atlas/dependencies/kubernetes-eks"
  - type: "measured_by"
    target: "okf://atlas/slos/api-gateway-availability"
generated:
  at: "2026-08-12T10:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# api-gateway

api-gateway fronts every public and partner API (ADR-013): it validates the JWTs issued by identity-service, applies per-consumer rate limits, routes /v3/tickets, /v2/fares and /v1/planner to the owning services (ADR-008) and terminates TLS with certificates from cert-manager. The certificate expiry incident of June 2026 happened on a partner domain that cert-manager did not manage; all public hostnames are now in the automated inventory.

## Ownership and runtime
Team: [team-piattaforma](../teams/team-piattaforma.md) · Runtime: Kong Gateway 3.8 on Kubernetes

## Interfaces
No event interfaces: direct database access only.

## Dependencies
- [kong-gateway](../dependencies/kong-gateway.md)
- [kubernetes-eks](../dependencies/kubernetes-eks.md)

## Operational notes
Rate limit defaults: 60 requests per minute per anonymous IP, 600 per authenticated user, 6,000 per partner.

- SLO: [api-gateway-availability](../slos/api-gateway-availability.md)
- Incident: [inc-2026-020-api-gateway-cert-expiry](../incidents/inc-2026-020-api-gateway-cert-expiry.md)
