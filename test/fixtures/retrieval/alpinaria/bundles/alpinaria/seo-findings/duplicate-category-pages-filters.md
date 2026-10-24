---
type: "SEO Finding"
title: "Pagine categoria duplicate generate dai filtri colore"
description: "Le URL con ?colore= hanno title e testo identici alla categoria base e sono indicizzate."
tags: ["finding", "seo-finding", "it"]
lang: "it"
relations:
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-scarponi-da-trekking-uomo"
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-scarponi-da-trekking-donna"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
  - id: "gsc"
    resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it"
    author: "process:gsc-sync"
generated:
  at: "2026-04-07T09:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "human:giulia.ferri"
  at: "2026-09-10T09:00:00Z"
status: "stable"
stale_after: "2027-01-31"
---

# Pagine categoria duplicate generate dai filtri colore

Ogni pagina categoria genera fino a 8 varianti `?colore=` con lo stesso title, la stessa H1 e lo stesso testo introduttivo: pagine categoria duplicate a tutti gli effetti. Su `/scarponi-da-trekking/uomo/` ne sono indicizzate 7, e due di queste ricevono impression per la query principale al posto della pagina base. Il tema è stato discusso nella riunione del 18 settembre e ha portato alla decisione sul canonical.
