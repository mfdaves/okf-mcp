---
type: "SEO Finding"
title: "Immagini prodotto senza alt text"
description: "1,200 product images are missing alt text across both languages."
tags: ["finding", "seo-finding", "mixed"]
lang: "mixed"
relations:
  - type: "related_to"
    target: "okf://alpinaria/decisions/image-alt-template"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-08-11T13:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "process:crawl-weekly"
  at: "2026-10-05T07:00:00Z"
status: "stable"
stale_after: "2027-03-31"
---

# Immagini prodotto senza alt text

The crawl found 1,200 product images (38% of the catalogue) with an empty or missing alt attribute, plus 300 with the file name as alt. Google Images traffic is 2% of organic sessions, well below the 6–8% typical for footwear. Le immagini senza alt sono concentrate nelle schede caricate dal PIM dopo marzo 2026, dove il campo alt non viene popolato. Soluzione proposta: template alt generato dal PIM (decisione approvata).
