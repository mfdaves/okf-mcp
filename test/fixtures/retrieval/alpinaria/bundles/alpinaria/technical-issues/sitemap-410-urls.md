---
type: "Technical Issue"
title: "Sitemap generator includes archived products"
description: "Open — 300 URLs returning 410 still listed."
tags: ["technical-issue", "tech", "low", "open", "en"]
lang: "en"
severity: "low"
state: "open"
relations:
  - type: "documented_in"
    target: "okf://alpinaria/seo-findings/sitemap-stale-urls"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-05-05T09:00:00Z"
  by: "process:crawl-weekly"
status: "stable"
stale_after: "2027-01-31"
---

# Sitemap generator includes archived products

**Severity:** low · **State:** open · **Owner:** backend

The sitemap job reads the PIM `status` field but archived products keep status `active` with an `archived_at` date. Add the date check, regenerate daily, and drop redirecting URLs.
