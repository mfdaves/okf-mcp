---
type: "Runbook"
title: "Drenaggio ordinato delle code offline dei validatori"
description: "Dopo un'interruzione di rete o del broker, far rientrare le validazioni accodate nei validatori senza saturare il gateway."
tags: ["runbook", "operations", "validator-gateway", "procedura"]
lang: "it"
relations:
  - type: "runbook_for"
    target: "okf://atlas/services/validator-gateway"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/runbooks/validator-offline-queue-drain"
generated:
  at: "2026-09-03T17:00:00Z"
  by: "human:sara.greco"
status: "stable"
stale_after: "2027-04-30"
---

# Drenaggio ordinato delle code offline dei validatori

Dopo un'interruzione di rete o del broker, far rientrare le validazioni accodate nei validatori senza saturare il gateway.

Servizi: [validator-gateway](../services/validator-gateway.md)

## Quando usarlo
Più di 200 validatori riconnessi insieme con code offline (dopo un'interruzione MQTT, un guasto del broker o una scadenza di certificati).

## Prerequisiti
Accesso al pannello di flotta e alle metriche del gateway; broker sano; certificati verificati con il runbook di rinnovo.

## Passi
1. Portare il gateway a 6 repliche con il runbook di scalatura.
2. Dal pannello di flotta abilitare il rientro per gruppi di 300 dispositivi ogni 5 minuti (linee urbane prima, extraurbane dopo).
3. Controllare che gli eventi arrivino con `delayed=true` e con la sequenza in ordine per dispositivo.
4. Quando la coda media per dispositivo è sotto 10 eventi, abilitare tutti i dispositivi rimanenti.
5. Avvisare il team biglietti per il ricalcolo delle soglie giornaliere degli ultimi 3 giorni.

## Rollback
Sospendere il rientro dal pannello di flotta: i validatori conservano la coda fino a 72 ore (ADR-010).

## Escalation
Reperibile piattaforma per il gateway; team biglietti per le soglie. Se la coda supera le 48 ore su più di 50 dispositivi, aprire un SEV2.
