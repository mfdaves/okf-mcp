---
type: "SEO Finding"
title: "XML sitemap lists 300 removed URLs"
description: "Sitemap still includes URLs returning 410 after the spring catalogue clean-up."
tags: ["finding", "seo-finding", "en"]
lang: "en"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
  - id: "gsc"
    resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it"
    author: "process:gsc-sync"
generated:
  at: "2026-08-12T07:00:00Z"
  by: "agent/seo-alpinaria"
status: "stable"
stale_after: "2027-01-31"
---

# XML sitemap lists 300 removed URLs

The product sitemap lists 300 URLs that return 410 Gone since the April catalogue clean-up, plus 45 URLs that redirect. Search Console flags the sitemap as having errors and crawl stats show Googlebot still requesting the dead URLs weekly. The sitemap generator reads the PIM status field, which is not updated when a product is archived.
