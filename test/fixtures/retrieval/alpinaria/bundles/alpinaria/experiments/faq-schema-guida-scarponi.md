---
type: "Experiment"
title: "Esperimento: FAQ schema sulla guida alla scelta degli scarponi"
description: "Ipotesi: il rich result FAQ aumenta il CTR della guida. Risultato: nessun effetto."
tags: ["experiment", "esperimento", "nullo", "it"]
lang: "it"
hypothesis: "Il markup FAQPage porta un rich result e più clic sulla guida."
result: "nullo"
relations:
  - type: "tests_page"
    target: "okf://alpinaria/landing-pages/it-guida-scelta-scarponi"
sources:
  - id: "gsc"
    resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it"
    author: "process:gsc-sync"
generated:
  at: "2026-04-27T16:00:00Z"
  by: "agent/seo-alpinaria"
status: "stable"
---

# Esperimento: FAQ schema sulla guida alla scelta degli scarponi

**Periodo:** 2026-03-10 → 2026-04-20.

**Ipotesi:** aggiungendo FAQPage con 5 domande la guida ottiene il rich result e un CTR maggiore.

**Risultato:** il rich result è comparso per 9 giorni e poi è sparito; CTR invariato (4,2% vs 4,1%). Nessun effetto misurabile. Markup rimosso a maggio per non appesantire la pagina.
