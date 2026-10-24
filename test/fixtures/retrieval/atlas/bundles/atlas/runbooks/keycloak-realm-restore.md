---
type: "Runbook"
title: "Keycloak realm restore and identity provider metadata reload"
description: "Reload SPID/CIE identity provider metadata, or restore a realm export after a bad configuration change."
tags: ["runbook", "operations", "identity-service"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/identity-service"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/keycloak-realm-restore"
generated:
  at: "2026-05-12T16:00:00Z"
  by: "human:giorgio.leone"
status: "stable"
stale_after: "2026-12-31"
---

# Keycloak realm restore and identity provider metadata reload

Reload SPID/CIE identity provider metadata, or restore a realm export after a bad configuration change.

Services: [identity-service](../services/identity-service.md)

## When to use
SAML signature failures on login (metadata rotation), or a realm misconfiguration deployed by mistake.

## Prerequisites
Keycloak admin credentials from the secrets manager; the last realm export from the nightly job; identity on-call.

## Steps
1. For signature failures: Admin console, Identity Providers, each SPID/CIE provider, 'Import from URL' to reload metadata; repeat the synthetic login.
2. For realm restore: `kc.sh import --file realm-<date>.json --override true` on a maintenance replica, then roll the deployment.
3. Verify the synthetic SPID login and a password login on the citizens realm, and a SAML login on the operators realm.
4. Check AccountCreated events resume on the identity topic.

## Rollback
Re-import the previous export; identity providers keep their old metadata until re-imported.

## Escalation
Identity on-call; AgID SPID help desk for identity provider issues.
