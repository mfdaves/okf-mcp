---
type: "Dependency"
title: "Eclipse Mosquitto (MQTT broker cluster)"
description: "MQTT 5 broker for validators and on-board units with mutual TLS (ADR-020)."
tags: ["dependency", "messaging", "piattaforma"]
lang: "en"
version: "2.0"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-piattaforma"
sources:
  - id: "vendor"
    resource: "https://mosquitto.org/"
generated:
  at: "2026-08-21T14:00:00Z"
  by: "agent/arch-atlas"
status: "stable"
stale_after: "2027-10-31"
---

# Eclipse Mosquitto (MQTT broker cluster)

MQTT 5 broker for validators and on-board units with mutual TLS (ADR-020).

**Version:** 2.0 · **Kind:** messaging · **Owner:** [team-piattaforma](../teams/team-piattaforma.md)

## Where it is used
validator-gateway and avl-collector subscriptions; per-device certificates from the fleet CA.

## Support end
Community support; clustered through a bridge topology.

## Upgrade notes
Broker certificate chain is monitored end to end since INC-2026-001; capacity 10,000 connections per node.
