---
type: "Dependency"
title: "Apache Kafka (managed, 3 brokers)"
description: "Event backbone for all asynchronous communication (ADR-002)."
tags: ["dependency", "messaging", "piattaforma"]
lang: "en"
version: "3.8"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://kafka.apache.org/"
generated:
  at: "2026-07-15T16:00:00Z"
  by: "agent/arch-atlas"
verified:
  by: "human:davide.colombo"
  at: "2026-05-10T08:00:00Z"
status: "stable"
stale_after: "2026-03-31"
---

# Apache Kafka (managed, 3 brokers)

Event backbone for all asynchronous communication (ADR-002).

**Version:** 3.8 · **Kind:** messaging · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
every v1/v2 topic in the data contracts; consumer groups per service; topic configuration in Git.

## Support end
Managed service; version pinned per environment.

## Upgrade notes
Broker rolling restarts can leave zombie consumers with the old client library (INC-2026-023): upgrade clients first.
