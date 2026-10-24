---
type: "Experiment"
title: "Experiment: remove lazy loading from the product hero image"
description: "Hypothesis: eager hero image improves mobile LCP. Result: LCP −0.9 s."
tags: ["experiment", "esperimento", "positive", "en"]
lang: "en"
hypothesis: "Loading the first product image eagerly with fetchpriority=high reduces mobile LCP below 2.5 s."
result: "positive"
relations:
  - type: "informed_by"
    target: "okf://alpinaria/seo-findings/core-web-vitals-mobile-2026-01"
sources:
  - id: "gsc"
    resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it"
    author: "process:gsc-sync"
generated:
  at: "2026-10-19T09:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "process:crawl-weekly"
  at: "2026-07-15T09:00:00Z"
status: "stable"
---

# Experiment: remove lazy loading from the product hero image

**Period:** 2026-06-01 → 2026-07-10, lab and field measurement.

**Result:** mobile LCP on product pages dropped from 3.6 s to 2.7 s in CrUX (−0.9 s) and under 2.5 s after AVIF was added in August. The CLS improvement came from reserving the image box. One of the two changes behind the September Core Web Vitals snapshot.
