---
type: "Decision"
title: "Decision: robots disallow for ?taglia=, canonical for ?colore="
description: "Technical counterpart of the duplicate category pages decision."
tags: ["decision", "decisione", "en"]
lang: "en"
relations:
  - type: "informed_by"
    target: "okf://alpinaria/seo-findings/faceted-navigation-index-bloat"
  - type: "related_to"
    target: "okf://alpinaria/decisions/canonical-pagine-categoria-duplicate"
sources:
  - id: "meeting-2026-09-18"
    resource: "https://docs.agency.internal/alpinaria/meetings/2026-09-18"
    author: "human:giulia.ferri"
  - id: "finding"
    resource: "okf://alpinaria/seo-findings/faceted-navigation-index-bloat"
generated:
  at: "2026-09-18T17:00:00Z"
  by: "human:giulia.ferri"
verified:
  by: "human:marco.benedetti"
  at: "2026-09-19T09:00:00Z"
status: "stable"
---

# Decision: robots disallow for ?taglia=, canonical for ?colore=

**Decided 2026-09-18.** Size facets (`?taglia=`) are disallowed in robots.txt because they have no search demand. Colour facets (`?colore=`) stay crawlable and carry a canonical tag to the base category, so that internal links to colour variants still pass signals. Price and sort parameters are also disallowed. Review after the January crawl.
