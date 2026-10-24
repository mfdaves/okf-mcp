---
type: "Service"
title: "avl-collector"
description: "Collects vehicle positions (AVL) from on-board units every 10 seconds and publishes VehiclePosition events."
tags: ["service", "mobilita"]
aliases: ["avl-collector"]
lang: "en"
runtime: "Go 1.23, MQTT, TimescaleDB"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-mobilita"
  - type: "produces"
    target: "okf://atlas/contracts/vehicle-position-v1"
  - type: "depends_on"
    target: "okf://atlas/dependencies/eclipse-mosquitto-mqtt"
  - type: "depends_on"
    target: "okf://atlas/dependencies/apache-kafka"
generated:
  at: "2026-07-22T13:00:00Z"
  by: "process:catalog-sync"
status: "stable"
---

# avl-collector

avl-collector receives positions from the on-board units of about 1,100 vehicles over the same MQTT broker as the validators, normalises them (WGS84, vehicle id, trip id when matched) and publishes VehiclePosition events. Positions are stored for 90 days in TimescaleDB for operator reporting. A vehicle with no position for 5 minutes during service is flagged to the operator portal.

## Ownership and runtime
Team: [team-mobilita](../teams/team-mobilita.md) · Runtime: Go 1.23, MQTT, TimescaleDB

## Interfaces
- Produces [vehicle-position-v1](../contracts/vehicle-position-v1.md)

## Dependencies
- [eclipse-mosquitto-mqtt](../dependencies/eclipse-mosquitto-mqtt.md)
- [apache-kafka](../dependencies/apache-kafka.md)

## Operational notes
The stale feed incident of August 2026 was a stuck consumer group, not a broker problem: the avl-feed-restart runbook was written after it.

- Incident: [inc-2026-023-avl-feed-stale](../incidents/inc-2026-023-avl-feed-stale.md)
