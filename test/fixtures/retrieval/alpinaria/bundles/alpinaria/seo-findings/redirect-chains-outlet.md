---
type: "SEO Finding"
title: "Redirect chains into /outlet/"
description: "Old promo URLs reach /outlet/ in three hops."
tags: ["finding", "seo-finding", "en"]
lang: "en"
relations:
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-outlet"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-05-02T13:00:00Z"
  by: "agent/seo-alpinaria"
status: "stable"
stale_after: "2027-01-31"
---

# Redirect chains into /outlet/

Legacy URLs /saldi/, /promo/ and /offerte/ reach /outlet/ through a redirect chain of three hops (http to https, trailing slash, then the final target). 210 external links point to the legacy URLs. Collapse each chain into a single 301 to /outlet/.
