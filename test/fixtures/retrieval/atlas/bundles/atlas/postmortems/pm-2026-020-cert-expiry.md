---
type: "Post-mortem"
title: "Post-mortem INC-2026-020: hostname outside the certificate inventory"
description: "The partner hostname predated cert-manager and was never migrated; the expiry inventory did not cover it."
tags: ["post-mortem", "postmortem", "incident-review"]
lang: "en"
relations:
  - type: "documents"
    target: "okf://atlas/incidents/inc-2026-020-api-gateway-cert-expiry"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-020"
    author: "process:incident-sync"
  - id: "wiki"
    resource: "https://wiki.tessera.internal/postmortems/pm-2026-020-cert-expiry"
generated:
  at: "2026-04-22T08:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-09-19T11:00:00Z"
status: "stable"
---

# Post-mortem INC-2026-020: hostname outside the certificate inventory

Incident: [inc-2026-020-api-gateway-cert-expiry](../incidents/inc-2026-020-api-gateway-cert-expiry.md)

## Summary
partners.tessera.it had a manually issued certificate from 2025. When cert-manager was adopted the migration list was built from Kubernetes resources, so a hostname served through a static Kong route was missed. It expired on 30 June and partners failed TLS validation for 4 hours.

## Contributing factors
- Inventory built from the automation's own view, not from DNS.
- Partner traffic has no synthetic check.
- The on-call runbook for certificates assumed cert-manager.

## What went well
The platform on-call rotated the certificate in under 3 hours once found; partners had retry logic and recovered without manual action.

## Action items
1. Weekly job comparing every DNS record with managed certificates (done).
2. Synthetic TLS check per public hostname, alert at 21 days (done).
3. Runbook updated for non-managed hostnames (done).

## Lessons
Inventories must come from outside the system that is supposed to be complete.
