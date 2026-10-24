---
type: "Decision"
title: "Decisione: redirect 301 da /donna/scarponi/ a /scarponi-da-trekking/donna/"
description: "Chiude la cannibalizzazione tra le due pagine donna."
tags: ["decision", "decisione", "it"]
lang: "it"
relations:
  - type: "informed_by"
    target: "okf://alpinaria/seo-findings/cannibalizzazione-scarponi-donna"
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-scarponi-da-trekking-donna"
sources:
  - id: "meeting-2026-03-05"
    resource: "https://docs.agency.internal/alpinaria/meetings/2026-03-05"
    author: "human:giulia.ferri"
  - id: "finding"
    resource: "okf://alpinaria/seo-findings/cannibalizzazione-scarponi-donna"
generated:
  at: "2026-03-20T11:00:00Z"
  by: "human:giulia.ferri"
verified:
  by: "human:marco.benedetti"
  at: "2026-04-02T09:00:00Z"
status: "stable"
---

# Decisione: redirect 301 da /donna/scarponi/ a /scarponi-da-trekking/donna/

**Deciso il 2026-03-20, eseguito il 2026-04-02.** La vecchia pagina `/donna/scarponi/` viene reindirizzata con 301 alla categoria `/scarponi-da-trekking/donna/` per risolvere la cannibalizzazione documentata nel finding. La pagina vecchia non viene riaperta per campagne: se serve una landing promozionale si usa un parametro di campagna sulla pagina ufficiale.
