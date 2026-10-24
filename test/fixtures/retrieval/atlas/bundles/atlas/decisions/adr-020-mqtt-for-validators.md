---
type: "Decision"
title: "ADR-020: MQTT with per-device certificates for validators and on-board units"
description: "The validator fleet and the on-board units talk MQTT over TLS with mutual authentication."
tags: ["adr", "decision", "adr-020"]
aliases: ["ADR-020"]
lang: "en"
decided_on: "2025-10-20"
relations:
  - type: "related_to"
    target: "okf://atlas/services/validator-gateway"
  - type: "related_to"
    target: "okf://atlas/services/avl-collector"
  - type: "related_to"
    target: "okf://atlas/dependencies/eclipse-mosquitto-mqtt"
sources:
  - id: "adr-repo"
    resource: "https://git.tessera.internal/platform/architecture/adr/020.md"
    author: "human:lucia.bernardi"
generated:
  at: "2026-01-05T12:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-03-01T13:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# ADR-020: MQTT with per-device certificates for validators and on-board units

**Status:** accepted · **Date:** 2025-10-20

## Context
4,200 validators and 1,100 on-board units on mobile networks need a lightweight, resumable protocol with device identity.

## Decision
Mosquitto brokers (clustered) with MQTT 5, QoS 1, per-device X.509 certificates from the fleet CA; the gateway services subscribe and publish to Kafka.

## Consequences
Low bandwidth and offline resume; the fleet CA and the broker certificate chain become critical (the January 2026 outage was an expired intermediate CA).

## Related
- [validator-gateway](../services/validator-gateway.md)
- [avl-collector](../services/avl-collector.md)
- [eclipse-mosquitto-mqtt](../dependencies/eclipse-mosquitto-mqtt.md)
