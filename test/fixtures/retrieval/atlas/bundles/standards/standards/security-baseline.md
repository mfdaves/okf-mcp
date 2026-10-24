---
type: "Standard"
title: "Security baseline"
description: "Minimum security controls for every service: identity, secrets, transport, data, supply chain."
tags: ["standard", "engineering", "security-baseline"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/standards/security-baseline"
generated:
  at: "2025-09-02T15:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-07-12T15:00:00Z"
status: "stable"
---

# Security baseline

All service-to-service calls carry a workload identity; no shared API keys. Secrets live in the secrets manager with rotation schedules (PSP quarterly, database annually, fleet CA every three years with an exercise annually). TLS everywhere, mutual TLS for devices. Personal data is minimised on the bus: account ids only, fiscal codes and names stay in identity-service. Dependencies are scanned daily; critical vulnerabilities patched within 7 days. PCI DSS scope is limited to the hosted payment page and validator firmware.
