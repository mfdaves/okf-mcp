---
type: "SEO Finding"
title: "Cannibalizzazione scarponi donna tra categoria e vecchia URL"
description: "Due pagine si alternavano in SERP per \"scarponi da trekking donna\"."
tags: ["finding", "seo-finding", "it"]
lang: "it"
relations:
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-scarponi-da-trekking-donna"
  - type: "affects_page"
    target: "okf://alpinaria/landing-pages/it-scarponi-da-trekking-donna-old"
sources:
  - id: "gsc"
    resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it"
    author: "process:gsc-sync"
generated:
  at: "2026-05-13T14:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "human:giulia.ferri"
  at: "2026-04-03T09:00:00Z"
status: "stable"
stale_after: "2026-09-30"
---

# Cannibalizzazione scarponi donna tra categoria e vecchia URL

Da Search Console (gennaio–marzo 2026) la query "scarponi da trekking donna" mostrava in alternanza `/scarponi-da-trekking/donna/` e la vecchia `/donna/scarponi/`, con posizione media complessiva 8,1 e CTR 2,3%. Classico caso di cannibalizzazione: due URL con title quasi identici e stessi prodotti. Risolto con il redirect 301 deciso a marzo; dopo il consolidamento la posizione media è 4,6. Finding chiuso ma utile come precedente per le altre categorie.
