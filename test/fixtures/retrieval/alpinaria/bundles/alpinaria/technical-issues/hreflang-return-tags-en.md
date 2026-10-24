---
type: "Technical Issue"
title: "hreflang return tags missing on Italian pages"
description: "Open — 14 EN/IT pairs without return tags."
tags: ["technical-issue", "tech", "high", "open", "en"]
lang: "en"
severity: "high"
state: "open"
relations:
  - type: "documented_in"
    target: "okf://alpinaria/seo-findings/hreflang-missing-en-pages"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-08-27T10:00:00Z"
  by: "process:crawl-weekly"
verified:
  by: "process:crawl-weekly"
  at: "2026-10-12T03:00:00Z"
status: "stable"
stale_after: "2027-03-31"
---

# hreflang return tags missing on Italian pages

**Severity:** high · **State:** open · **Owner:** dev team

Italian category and product pages do not emit the `en` alternate in the sitemap, so the EN→IT annotation has no return tag and the pair is invalid. Fix in the sitemap generator: emit both directions for every pair in the translation table. Test with the approach-shoes pair, which is already correct.
