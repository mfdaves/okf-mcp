---
type: "Incident"
title: "INC-2026-013: Login SPID non funzionante per 2 ore"
description: "Il login con SPID ha fallito per 2 ore e 10 minuti a causa dei metadati degli identity provider non aggiornati."
tags: ["incident", "sev2", "identity-service", "incidente"]
aliases: ["INC-2026-013"]
lang: "it"
severity: "SEV2"
occurred_on: "2026-04-15"
relations:
  - type: "affects"
    target: "okf://atlas/services/identity-service"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/keycloak-realm-restore"
  - type: "documented_in"
    target: "okf://atlas/postmortems/pm-2026-013-spid-login"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-013"
    author: "process:incident-sync"
generated:
  at: "2026-08-22T12:00:00Z"
  by: "process:incident-sync"
status: "stable"
---

# INC-2026-013: Login SPID non funzionante per 2 ore

**Gravità:** SEV2 · **Data:** 2026-04-15 · **Servizi:** [identity-service](../services/identity-service.md)

## Impatto
Nessun acquisto di abbonamento con agevolazione e nessuna registrazione via SPID per 2 ore e 10 minuti; circa 3.200 tentativi falliti. Il login con password e CIE funzionava.

## Timeline
10:20 picco di errori 'firma non valida' sulle asserzioni SAML · 10:35 pagina al reperibile identità · 11:00 identificata la rotazione dei metadati di due IdP · 11:45 metadati ricaricati manualmente · 12:30 chiusura dopo verifica su tutti gli IdP.

## Causa radice
Due identity provider SPID hanno ruotato i certificati di firma nei metadati; Keycloak li ricaricava solo ogni 24 ore e rifiutava le asserzioni firmate con il nuovo certificato.

## Risoluzione
Ricarica manuale dei metadati; frequenza di aggiornamento portata a un'ora; allarme sugli errori di firma SAML.

## Azioni successive
Aggiornamento orario dei metadati (fatto); test sintetico di login SPID ogni 5 minuti (fatto); valutare il login CIE da mobile come alternativa (questione aperta).

Post-mortem: [pm-2026-013-spid-login](../postmortems/pm-2026-013-spid-login.md)
