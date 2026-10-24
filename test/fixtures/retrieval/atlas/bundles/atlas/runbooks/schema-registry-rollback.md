---
type: "Runbook"
title: "Roll back a schema registry change"
description: "Revert a schema version that broke consumers and restore producers to the previous version."
tags: ["runbook", "operations"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/schema-registry-rollback"
generated:
  at: "2026-08-24T10:00:00Z"
  by: "human:sara.greco"
verified:
  by: "human:davide.colombo"
  at: "2026-08-27T15:00:00Z"
status: "stable"
stale_after: "2027-02-28"
---

# Roll back a schema registry change

Revert a schema version that broke consumers and restore producers to the previous version.

## When to use
Consumers failing deserialization after a schema registration, or a compatibility level changed by mistake.

## Prerequisites
Schema registry admin credentials; the CI pipeline that registers schemas; the owning team of the subject.

## Steps
1. Identify the subject and the offending version (`GET /subjects/<subject>/versions`).
2. Soft-delete the offending version (`DELETE /subjects/<subject>/versions/<n>`), which keeps consumers able to read already produced messages.
3. Roll back the producer deployment to the release that used the previous version.
4. Restore the compatibility level if it was changed (`PUT /config/<subject>` with BACKWARD or FULL).
5. Open a change ticket: the fix is a new version through CI, never a manual registration.

## Rollback
Undelete the version (`POST /subjects/<subject>/versions/<n>?permanent=false`) if consumers depended on it.

## Escalation
Platform on-call; data lead for warehouse consumers.
