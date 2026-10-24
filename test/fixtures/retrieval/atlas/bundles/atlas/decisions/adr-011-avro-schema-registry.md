---
type: "Decision"
title: "ADR-011: Avro with a schema registry for all Kafka topics"
description: "Every topic has an Avro schema registered with BACKWARD compatibility by default."
tags: ["adr", "decision", "adr-011"]
aliases: ["ADR-011"]
lang: "en"
decided_on: "2025-11-10"
relations:
  - type: "related_to"
    target: "okf://atlas/dependencies/confluent-schema-registry"
  - type: "related_to"
    target: "okf://atlas/runbooks/schema-registry-rollback"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/011.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-05-09T08:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:lucia.bernardi"
  at: "2026-03-15T11:00:00Z"
status: "stable"
stale_after: "2027-10-31"
---

# ADR-011: Avro with a schema registry for all Kafka topics

**Status:** accepted · **Date:** 2025-11-10

## Context
JSON events broke consumers twice in the first months (renamed field, changed type).

## Decision
Use Avro with the Confluent-compatible schema registry; compatibility BACKWARD by default, FULL for commands; producers register schemas in CI, never at runtime.

## Consequences
Breaking changes become a new major topic (v1 to v2); the registry is a critical dependency with its own rollback runbook.

## Related
- [confluent-schema-registry](../dependencies/confluent-schema-registry.md)
- [schema-registry-rollback](../runbooks/schema-registry-rollback.md)
