---
type: "Experiment"
title: "Experiment: x-default pointing to English instead of Italian"
description: "Hypothesis: English x-default helps EU visitors. Result: negative for Italy; reverted."
tags: ["experiment", "esperimento", "negative", "en"]
lang: "en"
hypothesis: "Setting x-default to the English URL increases English impressions without hurting Italian rankings."
result: "negative"
relations:
  - type: "related_to"
    target: "okf://alpinaria/decisions/hreflang-implementation-subfolder"
sources:
  - id: "gsc"
    resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it"
    author: "process:gsc-sync"
generated:
  at: "2026-05-12T08:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "human:giulia.ferri"
  at: "2026-04-25T09:00:00Z"
status: "stable"
---

# Experiment: x-default pointing to English instead of Italian

**Period:** 2026-03-15 → 2026-04-20 on 20 category pairs.

**Result:** English impressions +6% but Italian clicks −4% on the test pairs, because unmatched languages (fr, es) were sent to English pages with higher bounce. Reverted; x-default stays on the Italian URL as decided in February.
