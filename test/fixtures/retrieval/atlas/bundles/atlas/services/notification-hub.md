---
type: "Service"
title: "notification-hub"
description: "Sends push, SMS and email notifications with templates, rate limits and consent checks."
tags: ["service", "piattaforma"]
aliases: ["notification-hub"]
lang: "en"
runtime: "Node.js 22 / NestJS, Redis, PostgreSQL"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
  - type: "consumes"
    target: "okf://atlas/contracts/notification-request-v1"
  - type: "consumes"
    target: "okf://atlas/contracts/consent-changed-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/firebase-cloud-messaging"
  - type: "depends_on"
    target: "okf://atlas/dependencies/redis"
  - type: "depends_on"
    target: "okf://atlas/dependencies/postgresql-16"
  - type: "measured_by"
    target: "okf://atlas/slos/notification-hub-delivery"
generated:
  at: "2026-02-11T09:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# notification-hub

notification-hub accepts NotificationRequest events, renders the template in the user's language, checks the consent state for marketing messages and delivers through Firebase Cloud Messaging, the SMS gateway or SES. Per-user and per-campaign rate limits protect against storms: the May 2026 storm sent 1.2 million duplicate pushes when a producer retried a batch without idempotency keys. Every request now needs a key.

## Ownership and runtime
Team: [team-piattaforma](../teams/team-piattaforma.md) · Runtime: Node.js 22 / NestJS, Redis, PostgreSQL

## Interfaces
- Consumes [notification-request-v1](../contracts/notification-request-v1.md)
- Consumes [consent-changed-v1](../contracts/consent-changed-v1.md)

## Dependencies
- [firebase-cloud-messaging](../dependencies/firebase-cloud-messaging.md)
- [redis](../dependencies/redis.md)
- [postgresql-16](../dependencies/postgresql-16.md)

## Operational notes
Rate limits are tuned with the notification-rate-limit runbook; transactional messages (ticket issued, payment failed) bypass marketing consent but not the per-user limit.

- SLO: [notification-hub-delivery](../slos/notification-hub-delivery.md)
- Incident: [inc-2026-016-push-notification-storm](../incidents/inc-2026-016-push-notification-storm.md)
