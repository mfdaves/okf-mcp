---
type: "Technical Issue"
title: "Self-referencing canonical missing on English product pages"
description: "Open — EN product pages have no canonical tag at all."
tags: ["technical-issue", "tech", "medium", "open", "en"]
lang: "en"
severity: "medium"
state: "open"
relations:
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/en-trail-running-shoes"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-05-27T10:00:00Z"
  by: "process:crawl-weekly"
verified:
  by: "process:crawl-weekly"
  at: "2026-10-12T03:00:00Z"
status: "stable"
stale_after: "2027-01-31"
---

# Self-referencing canonical missing on English product pages

**Severity:** medium · **State:** open · **Owner:** dev team

The English product template omits the canonical link element, so parameter and tracking variants of EN product URLs get indexed separately. Add a self-referencing canonical to the EN product template, matching the Italian one.
