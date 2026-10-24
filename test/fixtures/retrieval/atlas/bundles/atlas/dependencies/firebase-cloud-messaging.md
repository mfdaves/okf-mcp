---
type: "Dependency"
title: "Firebase Cloud Messaging"
description: "Push notification delivery to iOS and Android apps."
tags: ["dependency", "vendor", "piattaforma"]
lang: "en"
version: "HTTP v1 API"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://firebase.google.com/docs/cloud-messaging"
generated:
  at: "2026-07-24T12:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2026-05-31"
---

# Firebase Cloud Messaging

Push notification delivery to iOS and Android apps.

**Version:** HTTP v1 API · **Kind:** vendor · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
notification-hub push channel; per-project quota.

## Support end
Legacy API removed in 2024; HTTP v1 only.

## Upgrade notes
Quota warnings were the first external signal of the notification storm (INC-2026-016).
