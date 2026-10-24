---
type: "SEO Finding"
title: "Faceted navigation index bloat on EN and IT categories"
description: "About 14,000 parameter URLs (?colore=, ?taglia=) are indexed."
tags: ["finding", "seo-finding", "en"]
lang: "en"
relations:
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-scarponi-da-trekking-uomo"
sources:
  - id: "gsc"
    resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it"
    author: "process:gsc-sync"
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-10-10T10:00:00Z"
  by: "agent/seo-alpinaria"
status: "stable"
stale_after: "2027-03-31"
---

# Faceted navigation index bloat on EN and IT categories

Search Console reports 14,200 indexed URLs carrying ?colore= and ?taglia= parameters, against 1,900 canonical pages. Colour facets duplicate the category with the same title and copy; size facets have no search demand at all. The crawl budget is spent on facets: the median crawl frequency of product pages dropped to once every 9 days. The decision taken in September splits the treatment: canonical tag to the base category for colour, robots disallow for size.
