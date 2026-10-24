---
type: "Data Contract"
title: "AccountCreated v1"
description: "A citizen or operator account was created in Keycloak."
tags: ["contract", "event", "identita"]
aliases: ["identity.accounts.v1"]
lang: "en"
channel: "identity.accounts.v1"
format: "Avro"
relations:
  - type: "owned_by"
    target: "okf://atlas/teams/team-identita"
generated:
  at: "2026-07-17T13:00:00Z"
  by: "process:schema-registry-sync"
verified:
  by: "human:andrea.moretti"
  at: "2026-07-04T14:00:00Z"
status: "stable"
---

# AccountCreated v1

A citizen or operator account was created in Keycloak.

**Kind:** event · **Topic:** `identity.accounts.v1` · **Format:** Avro · **Owner:** [team-identita](../teams/team-identita.md)

## Fields
- account_id
- realm (enum: CITIZENS, OPERATORS)
- login_method (enum: SPID, CIE, PASSWORD, SAML)
- spid_level (optional, 1-3)
- created_at

## Compatibility
BACKWARD.

## Personal data
account_id only; no name or fiscal code on the bus.

## Retention
Kafka 30 days.

## Notes
Fiscal code never travels on Kafka: services that need it call identity-service with the account id.
