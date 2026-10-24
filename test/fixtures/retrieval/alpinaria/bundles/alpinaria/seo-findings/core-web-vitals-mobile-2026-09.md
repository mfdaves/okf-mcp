---
type: "SEO Finding"
title: "Core Web Vitals mobile status — September 2026"
description: "Current snapshot: LCP 2.4 s after image work; INP 260 ms on category filters still failing."
tags: ["finding", "seo-finding", "en"]
lang: "en"
relations:
  - type: "supersedes"
    target: "okf://alpinaria/seo-findings/core-web-vitals-mobile-2026-01"
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-scarponi-da-trekking-uomo"
sources:
  - id: "crux"
    resource: "https://developer.chrome.com/docs/crux"
    author: "agent/seo-alpinaria"
  - id: "pagespeed"
    resource: "https://pagespeed.web.dev/analysis?url=https://www.alpinaria.it/"
    author: "agent/seo-alpinaria"
generated:
  at: "2026-10-24T09:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "human:giulia.ferri"
  at: "2026-10-02T09:00:00Z"
status: "stable"
stale_after: "2027-01-31"
---

# Core Web Vitals mobile status — September 2026

CrUX field data, 28-day window ending 2026-09-28. Mobile product pages now pass LCP at 2.4 s after removing lazy loading from the hero image and serving AVIF. CLS down to 0.05. INP is still 260 ms on category pages because the colour and size filter widget blocks the main thread on tap; this is the remaining blocker for a full pass. Recommendation: defer filter hydration and split the bundle. Verified against PageSpeed Insights lab runs on 2026-10-02.
