---
type: "Dependency"
title: "Schema registry (Confluent-compatible)"
description: "Avro schema registry for every Kafka topic (ADR-011)."
tags: ["dependency", "messaging", "piattaforma"]
lang: "en"
version: "7.7"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://docs.confluent.io/platform/current/schema-registry/"
generated:
  at: "2026-05-05T10:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2027-06-30"
---

# Schema registry (Confluent-compatible)

Avro schema registry for every Kafka topic (ADR-011).

**Version:** 7.7 · **Kind:** messaging · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
CI registration of schemas; BACKWARD default, FULL for commands; rollback runbook.

## Support end
Pinned with the Kafka managed service.

## Upgrade notes
Never register schemas at runtime; producers fail fast if the registry is unreachable at startup.
