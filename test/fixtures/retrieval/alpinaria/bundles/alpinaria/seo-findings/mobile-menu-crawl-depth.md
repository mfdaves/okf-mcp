---
type: "SEO Finding"
title: "English category pages sit at crawl depth 5"
description: "EN categories are reachable only through the language switcher and the footer."
tags: ["finding", "seo-finding", "en"]
lang: "en"
relations:
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/en-lightweight-hiking-shoes"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-03-08T12:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "human:giulia.ferri"
  at: "2026-10-05T08:00:00Z"
status: "stable"
stale_after: "2027-01-31"
---

# English category pages sit at crawl depth 5

The English category pages are five clicks from the Italian home page because the main navigation on /en/ is a reduced version and the language switcher links only the home page. Italian categories are at depth 2. Crawl frequency of EN categories is a third of the Italian ones. Fix: mirror the main navigation on /en/ and switch languages page to page.
