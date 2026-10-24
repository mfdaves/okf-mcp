---
type: "Runbook"
title: "Certificate renewal: cert-manager, fleet CA chain and non-managed hostnames"
description: "Renew or rotate TLS certificates including the fleet CA intermediate and hostnames outside cert-manager."
tags: ["runbook", "operations", "api-gateway", "validator-gateway"]
lang: "en"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/api-gateway"
  - type: "runbook_for"
    target: "okf://atlas/services/validator-gateway"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/certificate-renewal"
generated:
  at: "2026-03-26T16:00:00Z"
  by: "human:giorgio.leone"
verified:
  by: "human:davide.colombo"
  at: "2026-08-21T11:00:00Z"
status: "stable"
stale_after: "2026-07-31"
---

# Certificate renewal: cert-manager, fleet CA chain and non-managed hostnames

Renew or rotate TLS certificates including the fleet CA intermediate and hostnames outside cert-manager.

Services: [api-gateway](../services/api-gateway.md), [validator-gateway](../services/validator-gateway.md)

## When to use
Expiry alert at 21 days, a failed cert-manager renewal, or a fleet CA rotation exercise.

## Prerequisites
The certificate inventory (weekly DNS comparison job output); access to cert-manager namespaces, the fleet CA offline key ceremony, and Kong.

## Steps
1. Identify the certificate class: cert-manager managed, fleet CA (broker and devices), or non-managed hostname.
2. cert-manager: delete the Certificate's secret to force renewal; verify the new NotAfter.
3. Fleet CA intermediate: issue a new intermediate with the offline root, deploy the new chain to the brokers while keeping the old intermediate trusted on devices, then rotate device trust stores in groups of 500.
4. Non-managed hostname: issue through ACME with the DNS challenge, upload to Kong, then migrate the hostname into cert-manager so it never happens again.
5. Update the inventory and verify the whole chain with `openssl verify -show_chain`.

## Rollback
Keep the previous certificate and chain until the new one is verified from a validator and from an external client; revert the Kong certificate object if handshakes fail.

## Escalation
Platform on-call; team biglietti for fleet device impact. Expiry of the fleet intermediate is a SEV1 (INC-2026-001).
