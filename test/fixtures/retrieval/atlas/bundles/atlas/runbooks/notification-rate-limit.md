---
type: "Runbook"
title: "Tune notification rate limits and stop a storm"
description: "Stop a notification storm and adjust per-user and per-campaign limits."
tags: ["runbook", "operations", "notification-hub"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/notification-hub"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/notification-rate-limit"
generated:
  at: "2026-02-05T17:00:00Z"
  by: "human:giorgio.leone"
status: "stable"
stale_after: "2027-06-30"
---

# Tune notification rate limits and stop a storm

Stop a notification storm and adjust per-user and per-campaign limits.

Services: [notification-hub](../services/notification-hub.md)

## When to use
Delivery rate alert above 5x baseline, FCM quota warnings, or duplicate complaints.

## Prerequisites
Access to the notification-hub admin API and the feature flags.

## Steps
1. Flip the kill switch `kill.notification-hub.marketing` to pause marketing delivery (transactional continues).
2. Identify the producer from the request_id prefix and stop it.
3. Purge the pending queue for that campaign with the admin API.
4. Adjust limits if needed: marketing default 1 per user per day, transactional 20 per user per hour.
5. Re-enable marketing and watch delivery for 15 minutes.

## Rollback
Restore the previous limits from Git; the kill switch is reversible at any time.

## Escalation
Platform on-call; the campaign owner; privacy officer if marketing went to users without consent.
