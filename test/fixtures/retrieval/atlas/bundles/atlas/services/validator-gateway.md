---
type: "Service"
title: "validator-gateway"
description: "Receives validations from 4,200 on-board and station validators over MQTT and forwards them as TicketValidated events."
tags: ["service", "biglietti"]
aliases: ["validator-gateway"]
lang: "en"
runtime: "Go 1.23, MQTT (Mosquitto), Redis"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-biglietti"
  - type: "produces"
    target: "okf://atlas/contracts/ticket-validated-v2"
  - type: "depends_on"
    target: "okf://atlas/dependencies/eclipse-mosquitto-mqtt"
  - type: "depends_on"
    target: "okf://atlas/dependencies/redis"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
  - type: "measured_by"
    target: "okf://atlas/slos/validator-gateway-availability"
  - type: "measured_by"
    target: "okf://atlas/slos/validator-gateway-ingest-latency"
generated:
  at: "2026-08-19T10:00:00Z"
  by: "process:catalog-sync"
verified:
  by: "human:davide.colombo"
  at: "2026-05-25T10:00:00Z"
status: "stable"
---

# validator-gateway

validator-gateway terminates the MQTT sessions of the validator fleet, authenticates devices with per-device certificates, de-duplicates retransmissions with a Redis window and publishes TicketValidated v2 events to Kafka. Validators keep an offline queue for up to 72 hours (ADR-010); when a vehicle regains coverage the gateway drains the queue in order and tags the events as delayed.

## Ownership and runtime
Team: [team-biglietti](../teams/team-biglietti.md) · Runtime: Go 1.23, MQTT (Mosquitto), Redis

## Interfaces
- Produces [ticket-validated-v2](../contracts/ticket-validated-v2.md)

## Dependencies
- [eclipse-mosquitto-mqtt](../dependencies/eclipse-mosquitto-mqtt.md)
- [redis](../dependencies/redis.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
The Bologna outage of January 2026 was caused by an expired intermediate CA on the MQTT broker; see the incident and the certificate renewal runbook. Scale horizontally with the scale-validator-gateway runbook before major events (fairs, derby days).

- SLO: [validator-gateway-availability](../slos/validator-gateway-availability.md)
- SLO: [validator-gateway-ingest-latency](../slos/validator-gateway-ingest-latency.md)
- Incident: [inc-2026-001-validator-outage-bologna](../incidents/inc-2026-001-validator-outage-bologna.md)
