---
type: "Standard"
title: "Data contract versioning"
description: "Rules for evolving Kafka topics and REST APIs without breaking consumers."
tags: ["standard", "engineering", "data-contract-versioning"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/standards/data-contract-versioning"
generated:
  at: "2025-11-16T10:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-05-03T08:00:00Z"
status: "stable"
---

# Data contract versioning

Kafka: Avro schemas in the registry; BACKWARD compatibility by default, FULL for commands; a breaking change is a new topic with the next major (v1 to v2) and the old topic is kept for 6 months with a migration owner. REST: major version in the URL path; additive changes only within a major; a deprecated major carries a Sunset header and lives 12 months. Every contract has an owner team, a documented retention and a personal data section. Schemas are registered from CI, never by hand.
