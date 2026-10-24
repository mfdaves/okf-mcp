---
type: "Technical Issue"
title: "robots.txt blocked /static/css/ (resolved)"
description: "Resolved in May 2026 — kept for history."
tags: ["technical-issue", "tech", "high", "resolved", "en"]
lang: "en"
severity: "high"
state: "resolved"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-04-27T12:00:00Z"
  by: "process:crawl-weekly"
verified:
  by: "process:crawl-weekly"
  at: "2026-10-12T03:00:00Z"
status: "deprecated"
stale_after: "2026-06-30"
---

# robots.txt blocked /static/css/ (resolved)

**Severity:** high · **State:** resolved 2026-05-04

A robots.txt rule from the old CMS blocked /static/css/ and /static/js/, so Googlebot rendered pages without styles and flagged mobile usability errors. Rule removed; mobile usability errors cleared within three weeks.
