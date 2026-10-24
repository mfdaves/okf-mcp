---
type: "Technical Issue"
title: "English category pages at crawl depth 5"
description: "Open — navigation on /en/ is reduced and the language switcher links only the home page."
tags: ["technical-issue", "tech", "medium", "open", "en"]
lang: "en"
severity: "medium"
state: "open"
relations:
  - type: "documented_in"
    target: "okf://alpinaria/seo-findings/mobile-menu-crawl-depth"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-08-19T17:00:00Z"
  by: "process:crawl-weekly"
status: "stable"
stale_after: "2027-06-30"
---

# English category pages at crawl depth 5

**Severity:** medium · **State:** open · **Owner:** frontend

Mirror the full main navigation on /en/ and make the language switcher link the equivalent page (translation table already exists for hreflang). Expected: EN categories at depth 2.
