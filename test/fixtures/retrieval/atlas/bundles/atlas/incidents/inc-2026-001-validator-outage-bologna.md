---
type: "Incident"
title: "INC-2026-001: Validatori offline su tutta la rete urbana di Bologna"
description: "Il 14 gennaio 2026 i 1.800 validatori urbani di Bologna hanno perso la connessione MQTT per 3 ore e 40 minuti."
tags: ["incident", "sev1", "validator-gateway", "incidente"]
aliases: ["INC-2026-001"]
lang: "it"
severity: "SEV1"
occurred_on: "2026-01-14"
relations:
  - type: "affects"
    target: "okf://atlas/services/validator-gateway"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/certificate-renewal"
  - type: "resolved_by"
    target: "okf://atlas/runbooks/validator-offline-queue-drain"
  - type: "documented_in"
    target: "okf://atlas/postmortems/pm-2026-001-validator-outage"
sources:
  - id: "incident-tracker"
    resource: "https://ops.tessera.internal/incidents/INC-2026-001"
    author: "process:incident-sync"
generated:
  at: "2026-09-23T15:00:00Z"
  by: "process:incident-sync"
status: "stable"
---

# INC-2026-001: Validatori offline su tutta la rete urbana di Bologna

**Gravità:** SEV1 · **Data:** 2026-01-14 · **Servizi:** [validator-gateway](../services/validator-gateway.md)

## Impatto
Nessuna validazione registrata in tempo reale per 3 ore e 40 minuti su 1.800 validatori; i viaggiatori hanno continuato a salire (coda offline), ma i controllori non vedevano le validazioni e le soglie giornaliere sono state applicate in ritardo. Circa 95.000 validazioni consegnate in ritardo.

## Timeline
06:12 primi allarmi di sessioni MQTT in calo · 06:30 pagina al reperibile piattaforma · 07:05 identificata la catena di certificati del broker · 08:40 nuovo certificato intermedio distribuito · 09:52 ultimi validatori riconnessi e code svuotate.

## Causa radice
Il certificato intermedio della CA di flotta usato dal broker Mosquitto era scaduto alla mezzanotte; i validatori rifiutavano la catena del broker. Il monitoraggio controllava solo il certificato foglia.

## Risoluzione
Emesso e distribuito un nuovo certificato intermedio; drenaggio delle code offline in ordine con il runbook dedicato; verifica delle soglie giornaliere ricalcolate.

## Azioni successive
Monitorare la scadenza di tutta la catena (fatto); inventario dei certificati con scadenza entro 60 giorni nel runbook di rinnovo (fatto); prova di rinnovo semestrale.

Post-mortem: [pm-2026-001-validator-outage](../postmortems/pm-2026-001-validator-outage.md)
