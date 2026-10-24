---
type: "Incident"
title: "INC-2026-020: Partner API certificate expired"
description: "The TLS certificate of partners.tessera.it expired; partner integrations (travel agencies, corporate portals) failed for 4 hours."
tags: ["incident", "sev3", "api-gateway"]
aliases: ["INC-2026-020"]
lang: "en"
severity: "SEV3"
occurred_on: "2026-06-30"
relations:
  - type: "affects"
    target: "okf://atlas/services/api-gateway"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/certificate-renewal"
  - type: "documented_in"
    target: "okf://atlas/postmortems/pm-2026-020-cert-expiry"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-020"
    author: "process:incident-sync"
generated:
  at: "2026-08-18T14:00:00Z"
  by: "process:incident-sync"
verified:
  by: "human:giorgio.leone"
  at: "2026-09-03T15:00:00Z"
status: "stable"
---

# INC-2026-020: Partner API certificate expired

**Severity:** SEV3 · **Date:** 2026-06-30 · **Services:** [api-gateway](../services/api-gateway.md)

## Impact
All partner API calls failed TLS validation for 4 hours; 3 corporate subscription portals and 2 travel agencies affected; no citizen impact.

## Timeline
00:00 certificate expires · 08:05 partner reports failures · 08:20 incident opened · 09:10 hostname found outside cert-manager · 11:55 certificate issued and rotated.

## Root cause
partners.tessera.it was configured manually before cert-manager was adopted and never migrated; the expiry inventory covered only cert-manager resources.

## Resolution
Hostname migrated to cert-manager; inventory extended to every public hostname in DNS.

## Follow-ups
Weekly job comparing DNS records with managed certificates (done); expiry alert at 21 days (done).

Post-mortem: [pm-2026-020-cert-expiry](../postmortems/pm-2026-020-cert-expiry.md)
