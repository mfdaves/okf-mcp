---
type: "Post-mortem"
title: "Post-mortem INC-2026-013: SPID identity provider metadata rotation"
description: "Two SPID identity providers rotated signing certificates; our daily metadata refresh missed it."
tags: ["post-mortem", "postmortem", "incident-review"]
lang: "en"
relations:
  - type: "documents"
    target: "okf://atlas/incidents/inc-2026-013-spid-login-down"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-013"
    author: "process:incident-sync"
  - id: "wiki"
    resource: "https://wiki.tessera.internal/postmortems/pm-2026-013-spid-login"
generated:
  at: "2026-02-07T07:00:00Z"
  by: "human:davide.colombo"
verified:
  by: "human:lucia.bernardi"
  at: "2026-09-26T07:00:00Z"
status: "stable"
---

# Post-mortem INC-2026-013: SPID identity provider metadata rotation

Incident: [inc-2026-013-spid-login-down](../incidents/inc-2026-013-spid-login-down.md)

## Summary
SPID identity providers may rotate signing certificates at any time by publishing new metadata. Keycloak refreshed the federation metadata every 24 hours, so assertions signed with the new certificates were rejected for 2 hours and 10 minutes until a manual reload.

## Contributing factors
- Refresh interval chosen by default, not by the AgID guidance.
- No synthetic login test; the first signal was customer complaints.
- The error 'invalid signature' was logged at INFO level.

## What went well
The identity on-call recognised the pattern within 25 minutes thanks to a previous near miss documented in the runbook.

## Action items
1. Metadata refresh every hour and on signature failure (done).
2. Synthetic SPID login every 5 minutes with a test identity (done).
3. Signature failures logged at ERROR and alerted (done).

## Lessons
External identity federations change under you; test the login, not the configuration.
