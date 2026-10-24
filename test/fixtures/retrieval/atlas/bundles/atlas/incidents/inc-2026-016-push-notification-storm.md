---
type: "Incident"
title: "INC-2026-016: 1.2 million duplicate push notifications"
description: "A campaign producer retried a batch without idempotency keys; 1.2 million duplicate pushes were sent in 25 minutes."
tags: ["incident", "sev2", "notification-hub"]
aliases: ["INC-2026-016"]
lang: "en"
severity: "SEV2"
occurred_on: "2026-05-19"
relations:
  - type: "affects"
    target: "okf://atlas/services/notification-hub"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/notification-rate-limit"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-016"
    author: "process:incident-sync"
generated:
  at: "2026-04-25T15:00:00Z"
  by: "process:incident-sync"
verified:
  by: "human:giorgio.leone"
  at: "2026-07-08T12:00:00Z"
status: "stable"
---

# INC-2026-016: 1.2 million duplicate push notifications

**Severity:** SEV2 · **Date:** 2026-05-19 · **Services:** [notification-hub](../services/notification-hub.md)

## Impact
About 400,000 users received 3 identical marketing pushes; 8,000 uninstalls over the following two days; FCM quota warnings.

## Timeline
18:00 campaign batch sent · 18:03 producer timeout, retries the whole batch twice · 18:10 delivery rate alert · 18:20 producer stopped · 18:25 queue drained.

## Root cause
NotificationRequest had an optional request_id; the campaign producer did not set it, so retries were new requests. The per-user rate limit was 10 per hour, too loose for marketing.

## Resolution
Producer stopped and fixed; request_id made mandatory in the schema (FULL compatibility, new required field with a default rejected at the gateway); marketing limited to 1 per user per day.

## Follow-ups
Mandatory idempotency key (done); separate rate limits per category (done); campaign tooling dry run on 1% (done).
