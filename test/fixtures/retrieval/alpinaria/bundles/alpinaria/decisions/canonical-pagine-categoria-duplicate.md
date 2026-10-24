---
type: "Decision"
title: "Decisione: canonical per le pagine categoria duplicate dai filtri colore"
description: "Le varianti ?colore= puntano con canonical alla categoria base; i filtri taglia vengono bloccati."
tags: ["decision", "decisione", "it"]
lang: "it"
relations:
  - type: "supersedes"
    target: "okf://alpinaria/decisions/noindex-filtri-colore-2026-03"
  - type: "informed_by"
    target: "okf://alpinaria/seo-findings/duplicate-category-pages-filters"
  - type: "informed_by"
    target: "okf://alpinaria/seo-findings/faceted-navigation-index-bloat"
sources:
  - id: "meeting-2026-09-18"
    resource: "https://docs.agency.internal/alpinaria/meetings/2026-09-18"
    author: "human:giulia.ferri"
  - id: "finding"
    resource: "okf://alpinaria/seo-findings/duplicate-category-pages-filters"
generated:
  at: "2026-09-18T16:00:00Z"
  by: "human:giulia.ferri"
verified:
  by: "human:marco.benedetti"
  at: "2026-09-19T09:00:00Z"
status: "stable"
---

# Decisione: canonical per le pagine categoria duplicate dai filtri colore

**Deciso il 2026-09-18** (riunione con Marco Benedetti). Le pagine categoria duplicate generate dai filtri colore (`?colore=`) ricevono un tag canonical verso la categoria base invece del noindex deciso a marzo; il noindex faceva perdere i link interni e il segnale delle varianti. I filtri taglia (`?taglia=`) non hanno domanda di ricerca e vengono esclusi dalla scansione via robots.txt. Eccezione: se in futuro un colore avrà domanda propria (es. "scarponi trekking donna rossi") si valuterà una pagina dedicata con testo unico. Owner: team sviluppo, rilascio entro fine ottobre. Questa decisione sostituisce quella di marzo 2026.
