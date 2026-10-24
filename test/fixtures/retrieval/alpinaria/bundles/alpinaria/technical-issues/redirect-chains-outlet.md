---
type: "Technical Issue"
title: "Redirect chain /saldi/ → /promo/ → /outlet/"
description: "Open — three-hop redirect chain into the outlet page."
tags: ["technical-issue", "tech", "low", "open", "en"]
lang: "en"
severity: "low"
state: "open"
relations:
  - type: "documented_in"
    target: "okf://alpinaria/seo-findings/redirect-chains-outlet"
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-outlet"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-10-05T11:00:00Z"
  by: "process:crawl-weekly"
status: "stable"
stale_after: "2027-04-30"
---

# Redirect chain /saldi/ → /promo/ → /outlet/

**Severity:** low · **State:** open · **Owner:** dev team

Legacy promo URLs go through http→https, then /saldi/→/promo/, then /promo/→/outlet/. Collapse to a single 301 from each legacy URL straight to https://www.alpinaria.it/outlet/. 210 external links depend on it.
