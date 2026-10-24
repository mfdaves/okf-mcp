---
type: "Open Question"
title: "Questione aperta: login con CIE da mobile (app CieID)"
description: "Il login CIE funziona da desktop con lettore o da mobile con NFC tramite CieID; l'integrazione in app non è ancora fatta."
tags: ["open-question", "architecture", "questione-aperta"]
lang: "it"
owner: "human:chiara.fontana"
due: "2027-03-31"
relations:
  - type: "related_to"
    target: "okf://atlas/services/identity-service"
  - type: "related_to"
    target: "okf://atlas/dependencies/spid-cie-idp"
  - type: "related_to"
    target: "okf://atlas/dependencies/keycloak"
generated:
  at: "2026-05-07T08:00:00Z"
  by: "human:lucia.bernardi"
status: "draft"
---

# Questione aperta: login con CIE da mobile (app CieID)

Il login CIE funziona da desktop con lettore o da mobile con NFC tramite CieID; l'integrazione in app non è ancora fatta.

## Domanda
Integrare il flusso CieID nelle app (deep link e ritorno) come alternativa a SPID, visto che SPID dipende da IdP esterni e la CIE è ormai diffusa? Quanto costa e quali livelli di sicurezza copre?

## Opzioni
1. Integrare CieID livello 2 nelle app entro il 2027.
2. Solo web mobile con CieID, nessuna integrazione nativa.
3. Attendere l'IT Wallet nazionale.

## Orientamento attuale
Opzione 1; dipende dalla migrazione a Keycloak 26.

## Owner e scadenza
`human:chiara.fontana` · 2027-03-31

## Collegamenti
- [identity-service](../services/identity-service.md)
- [spid-cie-idp](../dependencies/spid-cie-idp.md)
- [keycloak](../dependencies/keycloak.md)
