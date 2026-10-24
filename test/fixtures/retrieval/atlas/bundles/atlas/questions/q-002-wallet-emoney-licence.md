---
type: "Open Question"
title: "Questione aperta: il credito prepagato richiede una licenza di moneta elettronica?"
description: "Se il wallet prepagato, superata una certa soglia di raccolta, ricade nella disciplina degli istituti di moneta elettronica."
tags: ["open-question", "architecture", "questione-aperta"]
lang: "it"
owner: "human:andrea.moretti"
due: "2026-11-30"
relations:
  - type: "related_to"
    target: "okf://atlas/services/wallet-service"
generated:
  at: "2026-07-09T16:00:00Z"
  by: "human:elena.marino"
status: "stable"
---

# Questione aperta: il credito prepagato richiede una licenza di moneta elettronica?

Se il wallet prepagato, superata una certa soglia di raccolta, ricade nella disciplina degli istituti di moneta elettronica.

## Domanda
Il wallet raccoglie circa 4 milioni di euro di credito prepagato. Oltre quale soglia e con quali condizioni d'uso (solo biglietti nostri o anche partner) serve una licenza IMEL o un partner autorizzato?

## Opzioni
1. Limitare il credito a 150 euro per wallet e all'acquisto di soli titoli di viaggio (esenzione a rete limitata).
2. Appoggiarsi a un istituto di moneta elettronica partner che custodisce i fondi.
3. Richiedere l'autorizzazione come IMEL.

## Orientamento attuale
Opzione 1 nel breve; parere legale in corso. Impatto tecnico: limite di saldo nel wallet-service e nei top-up.

## Owner e scadenza
`human:andrea.moretti` · 2026-11-30

## Collegamenti
- [wallet-service](../services/wallet-service.md)
