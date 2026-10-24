---
type: "Technical Issue"
title: "Alt text mancanti sulle immagini caricate dal PIM"
description: "Aperto — il campo alt non viene popolato dall'export PIM dopo marzo 2026."
tags: ["technical-issue", "tech", "medium", "open", "it"]
lang: "it"
severity: "medium"
state: "open"
relations:
  - type: "documented_in"
    target: "okf://alpinaria/seo-findings/immagini-senza-alt"
  - type: "resolved_by"
    target: "okf://alpinaria/decisions/image-alt-template"
sources:
  - id: "crawl"
    resource: "https://crawl.agency.internal/alpinaria/2026-10-12"
    author: "process:crawl-weekly"
generated:
  at: "2026-08-12T16:00:00Z"
  by: "process:crawl-weekly"
verified:
  by: "process:crawl-weekly"
  at: "2026-10-12T03:00:00Z"
status: "stable"
stale_after: "2027-04-30"
---

# Alt text mancanti sulle immagini caricate dal PIM

**Gravità:** media · **Stato:** aperto · **Owner:** PIM team

Dall'export PIM di marzo 2026 il campo alt delle immagini prodotto arriva vuoto. Implementare il template deciso a settembre e rilanciare il backfill sulle 1.200 immagini senza alt.
