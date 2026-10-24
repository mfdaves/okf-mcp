---
type: "Technical Issue"
title: "LCP alto sulle immagini prodotto da mobile"
description: "Risolto in parte — LCP da 3,9 s a 2,4 s; resta il lavoro sui template meno usati."
tags: ["technical-issue", "tech", "medium", "in-progress", "it"]
lang: "it"
severity: "medium"
state: "in-progress"
relations:
  - type: "documented_in"
    target: "okf://alpinaria/seo-findings/core-web-vitals-mobile-2026-09"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-06-08T13:00:00Z"
  by: "process:crawl-weekly"
status: "stable"
stale_after: "2027-01-31"
---

# LCP alto sulle immagini prodotto da mobile

**Gravità:** media · **Stato:** in corso · **Owner:** frontend

L'immagine principale delle schede prodotto era caricata in lazy loading e in JPEG pesante. Dopo il caricamento eager con fetchpriority e il formato AVIF, l'LCP mobile è passato da 3,9 s a 2,4 s. Restano da sistemare i template outlet e guide, ancora sopra i 3 s.
