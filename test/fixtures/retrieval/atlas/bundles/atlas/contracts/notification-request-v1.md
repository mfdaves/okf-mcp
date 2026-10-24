---
type: "Data Contract"
title: "NotificationRequest v1"
description: "Request to send a notification to an account through push, SMS or email."
tags: ["contract", "command", "piattaforma"]
aliases: ["platform.notifications.requests.v1"]
lang: "en"
channel: "platform.notifications.requests.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
generated:
  at: "2026-08-01T09:00:00Z"
  by: "process:schema-registry-sync"
status: "stable"
---

# NotificationRequest v1

Request to send a notification to an account through push, SMS or email.

**Kind:** command · **Topic:** `platform.notifications.requests.v1` · **Format:** Avro · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Fields
- request_id (idempotency key, mandatory since 2026-05-20)
- account_id
- template_id
- channel preference
- variables (map)
- category (enum: TRANSACTIONAL, MARKETING)
- requested_at

## Compatibility
FULL.

## Personal data
account_id; variables must not contain personal data beyond first name.

## Retention
Kafka 7 days.

## Notes
Producers without request_id are rejected at the schema level after the notification storm.
