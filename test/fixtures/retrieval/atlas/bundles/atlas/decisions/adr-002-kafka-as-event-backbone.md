---
type: "Decision"
title: "ADR-002: Apache Kafka as the event backbone"
description: "All inter-service events go through Kafka with Avro schemas."
tags: ["adr", "decision", "adr-002"]
aliases: ["ADR-002"]
lang: "en"
decided_on: "2025-07-10"
relations:
  - type: "related_to"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "related_to"
    target: "okf://atlas/decisions/adr-011-avro-schema-registry"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/002.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-02-16T14:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-07-03T13:00:00Z"
status: "stable"
stale_after: "2027-10-31"
---

# ADR-002: Apache Kafka as the event backbone

**Status:** accepted · **Date:** 2025-07-10

## Context
Ticketing produces about 2 million validations and 9 million vehicle positions a day; consumers (ledger, fraud, warehouse, predictions) need replay and independent pace.

## Decision
Use Apache Kafka (managed, 3 brokers per environment) as the only asynchronous channel between services. Topics are named <domain>.<entity>.<version>; every topic has an owner team and a registered schema.

## Consequences
Replay and fan-out come for free; the team must operate consumer lag, rebalances and schema evolution. Synchronous calls remain for queries.

## Related
- [apache-kafka](../dependencies/apache-kafka.md)
- [adr-011-avro-schema-registry](../decisions/adr-011-avro-schema-registry.md)
