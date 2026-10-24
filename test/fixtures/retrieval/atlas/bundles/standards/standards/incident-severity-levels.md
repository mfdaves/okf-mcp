---
type: "Standard"
title: "Incident severity levels"
description: "Definitions of SEV1 to SEV4 and the response each requires."
tags: ["standard", "engineering", "incident-severity-levels"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/standards/incident-severity-levels"
generated:
  at: "2025-08-12T13:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-05-20T13:00:00Z"
status: "stable"
---

# Incident severity levels

SEV1: all customers cannot pay or validate, or data is being corrupted; page the owning team, platform on-call and, after 30 minutes, the CTO; status updates every 30 minutes; post-mortem mandatory within 5 working days. SEV2: a whole function, region or a large group of customers affected, or money wrong for many; page owning team and platform; updates hourly; post-mortem mandatory. SEV3: degradation with a workaround or partner-only impact; ticket, fix in business hours; post-mortem optional. SEV4: internal impact only; no page. Severity can be raised at any time and lowered only with a written rationale.
