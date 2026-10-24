---
type: "SEO Finding"
title: "English pages missing hreflang return tags"
description: "EN category pages point to IT but IT pages do not point back, so the annotations are ignored."
tags: ["finding", "seo-finding", "en"]
lang: "en"
relations:
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/en-mens-hiking-boots"
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/en-hardshell-jackets"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-08-11T10:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "process:crawl-weekly"
  at: "2026-10-12T03:00:00Z"
status: "stable"
stale_after: "2027-01-31"
---

# English pages missing hreflang return tags

The October crawl shows 14 English pages with hreflang annotations pointing to their Italian twins while the Italian pages carry no return tag. Google ignores hreflang pairs without return links, which explains why Italian URLs are shown to German and Dutch users searching in English. Missing return tags on: /en/mens-hiking-boots/, /en/hardshell-jackets/, /en/lightweight-hiking-shoes/, /en/trail-running-shoes/ and 10 product pages. The approach-shoes pair is correct and can be used as the template.
