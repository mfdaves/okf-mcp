---
type: "Technical Issue"
title: "URL con parametri ?colore= e ?taglia= indicizzate"
description: "Aperto — circa 14.000 URL con parametri nell'indice."
tags: ["technical-issue", "tech", "high", "open", "it"]
lang: "it"
severity: "high"
state: "open"
relations:
  - type: "documented_in"
    target: "okf://alpinaria/seo-findings/faceted-navigation-index-bloat"
  - type: "resolved_by"
    target: "okf://alpinaria/decisions/faceted-parameters-robots"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-04-23T09:00:00Z"
  by: "process:crawl-weekly"
verified:
  by: "process:crawl-weekly"
  at: "2026-10-12T03:00:00Z"
status: "stable"
stale_after: "2026-12-31"
---

# URL con parametri ?colore= e ?taglia= indicizzate

**Gravità:** alta · **Stato:** aperto, fix in rilascio · **Owner:** sviluppo

I filtri di categoria generano URL con parametri `?colore=` e `?taglia=` indicizzabili. Implementare: canonical alla categoria base sulle varianti colore, disallow in robots.txt per `?taglia=`, `?prezzo=` e `?ordina=`. Verificare che i link interni ai filtri non usino nofollow.
