---
type: "Open Question"
title: "Questione aperta: reperibilità del team dati fuori orario"
description: "Il team dati copre solo l'orario d'ufficio; gli incidenti notturni sul warehouse aspettano fino alle 6."
tags: ["open-question", "architecture", "questione-aperta"]
lang: "it"
owner: "human:davide.colombo"
due: "2026-11-15"
relations:
  - type: "related_to"
    target: "okf://atlas/slos/reporting-warehouse-freshness"
  - type: "related_to"
    target: "okf://atlas/incidents/inc-2026-018-clickhouse-disk-full"
generated:
  at: "2026-09-19T14:00:00Z"
  by: "human:davide.colombo"
status: "draft"
---

# Questione aperta: reperibilità del team dati fuori orario

Il team dati copre solo l'orario d'ufficio; gli incidenti notturni sul warehouse aspettano fino alle 6.

## Domanda
Introdurre una reperibilità 24/7 per il team dati (4 persone, turni pesanti), far coprire il warehouse al team piattaforma, o accettare un SLO più lasco per i cruscotti degli operatori di notte?

## Opzioni
1. Reperibilità 24/7 del team dati con indennità.
2. Il team piattaforma copre i soli allarmi di infrastruttura (disco, nodi) del warehouse.
3. SLO dei cruscotti valido solo in orario di servizio (05:00-01:00) e nessuna pagina notturna.

## Orientamento attuale
Opzione 2 più opzione 3: l'SLO di freschezza è già definito sull'orario di servizio.

## Owner e scadenza
`human:davide.colombo` · 2026-11-15

## Collegamenti
- [reporting-warehouse-freshness](../slos/reporting-warehouse-freshness.md)
- [inc-2026-018-clickhouse-disk-full](../incidents/inc-2026-018-clickhouse-disk-full.md)
