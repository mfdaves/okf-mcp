---
type: "Standard"
title: "Service and topic naming"
description: "Naming conventions for services, repositories, topics, flags and dashboards."
tags: ["standard", "engineering", "service-naming"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/standards/service-naming"
generated:
  at: "2025-07-20T15:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-10-04T08:00:00Z"
status: "stable"
---

# Service and topic naming

Services are lower-case hyphenated nouns describing the capability (fare-engine, not pricing-svc). Repositories: <team>/<service>. Topics: <domain>.<entity>.<version>, domains: ticketing, payments, identity, mobility, risk, platform. Feature flags: <service>.<feature>; kill switches: kill.<service>.<feature>. Dashboards: <service>/<aspect>. PagerDuty rotations: <team>-oncall.
