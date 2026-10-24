---
type: "Runbook"
title: "Riavvio del consumer AVL quando le posizioni si bloccano"
description: "Riavviare il consumer group delle posizioni dei veicoli quando resta in stato zombie dopo un riavvio dei broker."
tags: ["runbook", "operations", "avl-collector", "realtime-predictions", "procedura"]
lang: "it"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/avl-collector"
  - type: "runbook_for"
    target: "okf://atlas/services/realtime-predictions"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/avl-feed-restart"
generated:
  at: "2026-04-20T09:00:00Z"
  by: "human:andrea.moretti"
verified:
  by: "human:davide.colombo"
  at: "2026-10-15T11:00:00Z"
status: "stable"
stale_after: "2027-06-30"
---

# Riavvio del consumer AVL quando le posizioni si bloccano

Riavviare il consumer group delle posizioni dei veicoli quando resta in stato zombie dopo un riavvio dei broker.

Servizi: [avl-collector](../services/avl-collector.md), [realtime-predictions](../services/realtime-predictions.md)

## Quando usarlo
Allarme 'posizioni non aggiornate' per più di 5 minuti con broker sani e dispositivi connessi.

## Prerequisiti
Accesso a Kubernetes e alle metriche del consumer group `avl-collector`.

## Passi
1. Verificare che il broker sia sano e che i dispositivi pubblichino (metriche MQTT).
2. Controllare il lag del gruppo `avl-collector`: se le partizioni sono assegnate ma l'offset non avanza, il consumer è bloccato.
3. Riavviare i pod di avl-collector (`kubectl rollout restart deploy/avl-collector`).
4. Verificare che le posizioni tornino aggiornate entro 2 minuti e che le previsioni ripartano.
5. Se il problema si ripete nella stessa giornata, aprire un ticket per la libreria client.

## Rollback
Non applicabile: il riavvio non perde dati (Kafka conserva 3 giorni).

## Escalation
Reperibile mobilità; reperibile piattaforma per i broker.
