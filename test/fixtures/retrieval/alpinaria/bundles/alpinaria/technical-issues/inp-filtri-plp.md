---
type: "Technical Issue"
title: "INP 260 ms on category filter widget"
description: "Open — filter widget blocks the main thread on tap."
tags: ["technical-issue", "tech", "medium", "open", "en"]
lang: "en"
severity: "medium"
state: "open"
relations:
  - type: "documented_in"
    target: "okf://alpinaria/seo-findings/core-web-vitals-mobile-2026-09"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-05-10T09:00:00Z"
  by: "process:crawl-weekly"
status: "stable"
stale_after: "2027-01-31"
---

# INP 260 ms on category filter widget

**Severity:** medium · **State:** open · **Owner:** frontend

Tapping a colour or size filter on category pages triggers a 260 ms long task (hydration of the whole filter tree plus a synchronous price recalculation). Defer hydration until the first interaction, debounce the price recalculation, split the vendor bundle. Target: INP under 200 ms on mobile.
