#!/usr/bin/env node
"use strict";
/*
 * Retrieval fixture "atlas": a reproducible OKF v0.2 software-architecture catalog of an Italian
 * company (Tessera Mobilità S.p.A., Bologna: regional public-transport ticketing and mobility
 * platform). Fixture 2 of the WP0 harness; it measures agent-agnosticism of retrieval, so nothing
 * in it refers to the SEO domain of fixture 1.
 *
 * Writes:
 *   <out>/bundles/atlas/       the catalog: services, data contracts, ADRs, incidents, post-mortems,
 *                              runbooks, dependencies, SLOs, open questions, teams (English majority,
 *                              Italian minority; stemming at 1.0 supports en and it only)
 *   <out>/bundles/standards/   company-wide engineering standards (shared, read-only by convention)
 *   <out>/okf.project.yaml     project file declaring both bundles and the custom relation types
 *
 * Usage: node generate.js [--out <dir>] [--seed <n>]
 *
 * Defaults regenerate the committed fixture in place (--out defaults to this directory, seed 7).
 * Everything is deterministic for a given seed: test/retrieval-fixtures.test.js asserts that a
 * fresh run is byte-identical to the committed tree. All concept text is hand-written; the seed
 * only drives provenance variation (verification, timestamps, stale_after) on templated families.
 */

const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const OUT = path.resolve(opt("--out", __dirname));
const SEED = Number(opt("--seed", 7));
const CATALOG = "atlas";
const STANDARDS = "standards";

// ---------------------------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------------------------
function mulberry32(a) {
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const pad = (n, w) => String(n).padStart(w, "0");

// ---------------------------------------------------------------------------------------------
// YAML emitter (block style, JSON-quoted scalars => valid YAML 1.2 core schema)
// ---------------------------------------------------------------------------------------------
function yamlScalar(v) {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v));
}
function yamlLines(value, indent) {
  const pre = " ".repeat(indent);
  const lines = [];
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const inner = yamlLines(item, indent + 2);
        lines.push(`${pre}- ${inner[0].trimStart()}`);
        inner.slice(1).forEach((l) => lines.push(l));
      } else {
        lines.push(`${pre}- ${yamlScalar(item)}`);
      }
    });
    return lines;
  }
  Object.entries(value).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      if (!v.length) { lines.push(`${pre}${k}: []`); return; }
      if (v.every((x) => typeof x !== "object")) {
        lines.push(`${pre}${k}: [${v.map(yamlScalar).join(", ")}]`);
      } else {
        lines.push(`${pre}${k}:`);
        yamlLines(v, indent + 2).forEach((l) => lines.push(l));
      }
    } else if (typeof v === "object") {
      lines.push(`${pre}${k}:`);
      yamlLines(v, indent + 2).forEach((l) => lines.push(l));
    } else {
      lines.push(`${pre}${k}: ${yamlScalar(v)}`);
    }
  });
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Actors, sources, dates
// ---------------------------------------------------------------------------------------------
const ACTOR = {
  sync: "process:catalog-sync",
  registry: "process:schema-registry-sync",
  tracker: "process:incident-sync",
  agent: "agent/arch-atlas",
  cto: "human:lucia.bernardi",          // CTO
  sre: "human:davide.colombo",          // SRE lead, team piattaforma
  ticketing: "human:sara.greco",        // tech lead ticketing
  payments: "human:andrea.moretti",     // tech lead payments
  identity: "human:chiara.fontana",     // tech lead identity
  mobility: "human:marco.vitale",       // tech lead mobility data
  data: "human:elena.marino",           // data platform lead
  oncall: "human:giorgio.leone",        // on-call coordinator
};
const SRC = {
  git: (repo) => ({ id: "git", resource: `https://git.tessera.internal/platform/${repo}`, author: ACTOR.sync }),
  registry: { id: "schema-registry", resource: "https://schema-registry.tessera.internal/subjects", author: ACTOR.registry },
  tracker: (key) => ({ id: "incident-tracker", resource: `https://ops.tessera.internal/incidents/${key}`, author: ACTOR.tracker }),
  adr: (n) => ({ id: "adr-repo", resource: `https://git.tessera.internal/platform/architecture/adr/${n}.md`, author: ACTOR.cto }),
  wiki: (page) => ({ id: "wiki", resource: `https://wiki.tessera.internal/${page}` }),
  grafana: (uid) => ({ id: "grafana", resource: `https://grafana.tessera.internal/d/${uid}`, author: ACTOR.sre }),
  vendor: (url) => ({ id: "vendor", resource: url }),
};

const TODAY = "2026-10-24";
const PAST = ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-09-30"];
const FUTURE = ["2026-12-31", "2027-02-28", "2027-04-30", "2027-06-30", "2027-10-31"];
function isoAt(y, m, d, h) { return `${y}-${pad(m, 2)}-${pad(d, 2)}T${pad(h || 9, 2)}:00:00Z`; }
function randomAt(fromMonthIndex, toMonthIndex) {
  // month index 0 = 2025-07
  const mi = fromMonthIndex + Math.floor(rng() * (toMonthIndex - fromMonthIndex + 1));
  const y = mi < 6 ? 2025 : 2026;
  const m = mi < 6 ? 7 + mi : mi - 5;
  return isoAt(y, m, 1 + Math.floor(rng() * 27), 7 + Math.floor(rng() * 11));
}

// ---------------------------------------------------------------------------------------------
// Concept registry
// ---------------------------------------------------------------------------------------------
const bundles = { [CATALOG]: [], [STANDARDS]: [] };
const ids = new Set();

function concept(bundle, c) {
  if (!c.id || !c.type || !c.title) throw new Error(`concept missing id/type/title: ${JSON.stringify(c).slice(0, 80)}`);
  const key = `${bundle}/${c.id}`;
  if (ids.has(key)) throw new Error(`duplicate concept id ${key}`);
  ids.add(key);
  bundles[bundle].push(Object.assign({ bundle }, c));
  return c.id;
}
const cat = (c) => concept(CATALOG, c);
const uri = (id, bundle) => `okf://${bundle || CATALOG}/${id}`;
const rel = (type, id, bundle) => ({ type, target: uri(id, bundle) });
// Markdown link relative to a file at depth 1 (e.g. services/x.md -> ../teams/y.md)
const mdlink = (text, id) => `[${text}](../${id}.md)`;

// Provenance helpers -------------------------------------------------------------------------
function provenance(kind, overrides) {
  const p = {};
  switch (kind) {
    case "service":
      p.generated = { at: randomAt(6, 15), by: ACTOR.sync };
      if (chance(0.55)) p.verified = { by: pick([ACTOR.sre, ACTOR.ticketing, ACTOR.payments, ACTOR.identity, ACTOR.mobility]), at: randomAt(10, 15) };
      p.status = "stable";
      break;
    case "contract":
      p.generated = { at: randomAt(4, 15), by: ACTOR.registry };
      if (chance(0.6)) p.verified = { by: pick([ACTOR.data, ACTOR.ticketing, ACTOR.payments]), at: randomAt(9, 15) };
      p.status = "stable";
      break;
    case "adr":
      p.generated = { at: randomAt(0, 14), by: pick([ACTOR.cto, ACTOR.sre, ACTOR.ticketing, ACTOR.payments]) };
      p.verified = { by: ACTOR.cto, at: randomAt(8, 15) };
      p.status = "stable";
      p.stale_after = chance(0.25) ? pick(PAST) : pick(FUTURE);
      break;
    case "incident":
      p.generated = { at: randomAt(6, 15), by: ACTOR.tracker };
      if (chance(0.7)) p.verified = { by: ACTOR.oncall, at: randomAt(10, 15) };
      p.status = "stable";
      break;
    case "postmortem":
      p.generated = { at: randomAt(7, 15), by: pick([ACTOR.sre, ACTOR.oncall]) };
      p.verified = { by: ACTOR.cto, at: randomAt(10, 15) };
      p.status = "stable";
      break;
    case "runbook":
      p.generated = { at: randomAt(2, 14), by: pick([ACTOR.sre, ACTOR.oncall, ACTOR.payments, ACTOR.ticketing]) };
      if (chance(0.7)) p.verified = { by: ACTOR.sre, at: randomAt(8, 15) };
      p.status = "stable";
      p.stale_after = chance(0.3) ? pick(PAST) : pick(FUTURE);
      break;
    case "dependency":
      p.generated = { at: randomAt(5, 15), by: ACTOR.agent };
      if (chance(0.4)) p.verified = { by: ACTOR.sre, at: randomAt(10, 15) };
      p.status = "stable";
      p.stale_after = chance(0.3) ? pick(PAST) : pick(FUTURE);
      break;
    case "slo":
      p.generated = { at: randomAt(6, 14), by: ACTOR.sre };
      p.verified = { by: pick([ACTOR.sre, ACTOR.cto]), at: randomAt(10, 15) };
      p.status = "stable";
      p.stale_after = chance(0.2) ? pick(PAST) : pick(FUTURE);
      break;
    case "question":
      p.generated = { at: randomAt(10, 15), by: pick([ACTOR.cto, ACTOR.sre, ACTOR.data, ACTOR.identity]) };
      p.status = chance(0.7) ? "draft" : "stable";
      break;
    case "team":
      p.generated = { at: randomAt(0, 2), by: ACTOR.cto };
      p.verified = { by: ACTOR.cto, at: randomAt(12, 15) };
      p.status = "stable";
      break;
    case "standard":
      p.generated = { at: randomAt(0, 4), by: ACTOR.cto };
      p.verified = { by: ACTOR.cto, at: randomAt(10, 15) };
      p.status = "stable";
      break;
    default:
      break;
  }
  return Object.assign(p, overrides || {});
}

// ---------------------------------------------------------------------------------------------
// 1. Teams (6)
// ---------------------------------------------------------------------------------------------
const TEAMS = [
  ["teams/team-biglietti", "Team Biglietti (Ticketing)", "Owns fares, ticket issuing, validation and inspection.", ACTOR.ticketing, "ticketing-oncall", "Bologna, 7 engineers. Writes incidents in Italian because the on-call rota is shared with the regional operators' NOC."],
  ["teams/team-pagamenti", "Team Pagamenti (Payments)", "Owns the wallet, payment orchestration, PSP and PagoPA integrations, refunds.", ACTOR.payments, "payments-oncall", "Bologna and Milano, 6 engineers. PCI DSS scope owner."],
  ["teams/team-identita", "Team Identità (Identity)", "Owns accounts, SPID/CIE login, consents and the Keycloak realms.", ACTOR.identity, "identity-oncall", "Bologna, 4 engineers. Data protection officer liaison."],
  ["teams/team-mobilita", "Team Mobilità (Mobility data)", "Owns GTFS ingestion, AVL collection, the trip planner and arrival predictions.", ACTOR.mobility, "mobility-oncall", "Bologna, 5 engineers plus two data scientists."],
  ["teams/team-piattaforma", "Team Piattaforma (Platform / SRE)", "Owns Kubernetes, Kafka, the API gateway, observability, on-call tooling and the architecture catalog.", ACTOR.sre, "platform-oncall", "Bologna, 5 engineers. Runs the weekly operations review and the ADR process with the CTO."],
  ["teams/team-dati", "Team Dati (Data platform)", "Owns the ClickHouse warehouse, dbt models, reporting for operators and the fraud scoring model.", ACTOR.data, "data-oncall", "Bologna, 4 engineers. Business hours on-call only."],
];
TEAMS.forEach(([id, title, description, lead, rota, notes]) => cat({
  id, type: "Team", lang: "en", title, description,
  tags: ["team", "ownership", id.split("/")[1].replace("team-", "")],
  ...provenance("team"),
  body: `# ${title}\n\n${description}\n\n## Lead and on-call\nTech lead: \`${lead}\`. PagerDuty rota: \`${rota}\`. ${notes}\n`,
}));

// ---------------------------------------------------------------------------------------------
// 2. Services (24)
// ---------------------------------------------------------------------------------------------
// [id, lang, title, team, runtime, description, purpose, produces, consumes, deps, notes, extra]
const SERVICES = [
  ["services/fare-engine", "en", "fare-engine", "team-biglietti", "Kotlin 2 / Spring Boot 3, PostgreSQL",
    "Computes the price of a journey from the zone matrix, time bands and daily/weekly fare caps.",
    "fare-engine is the single place where a journey becomes a price. It loads the regional zone matrix and the time bands published by the operators, applies the daily and weekly caps per account, and returns a FareComputed event that ticket-issuer and validation-ledger consume. Fare tables are versioned and activated at a cut-over timestamp; a wrong table is rolled back by activating the previous version, never by editing rows in place.",
    ["contracts/fare-computed-v1"], ["contracts/ticket-validated-v2"], ["dependencies/postgresql-16", "dependencies/apache-kafka"],
    "Fare table changes go through the fare-table hotfix runbook. The cap miscalculation incident of May 2026 came from a time-zone bug at the daily cap boundary (midnight Europe/Rome vs UTC).",
    { slos: ["slos/fare-engine-latency-p99"], incidents: ["incidents/inc-2026-015-fare-cap-miscalculation"] }],
  ["services/ticket-issuer", "en", "ticket-issuer", "team-biglietti", "Kotlin 2 / Spring Boot 3, PostgreSQL",
    "Issues single tickets, carnets and QR / EMV tokens after a successful payment or wallet debit.",
    "ticket-issuer creates the ticket record, signs the QR payload (Ed25519, 90-second rotating key id) or registers the EMV contactless token, and publishes the ticket to the validator fleet through the validator-gateway. It owns the REST tickets API v3 used by the mobile BFF and the web storefront. Idempotency is keyed on the payment id, so a retried purchase never issues two tickets.",
    [], ["contracts/payment-authorized-v1", "contracts/wallet-transaction-v1", "contracts/fare-computed-v1"], ["dependencies/postgresql-16", "dependencies/apache-kafka"],
    "Replaces the ticket module of the legacy SBE monolith; the migration of carnets finished in June 2026.",
    { api: "contracts/api-tickets-v3", slos: [] }],
  ["services/validator-gateway", "en", "validator-gateway", "team-biglietti", "Go 1.23, MQTT (Mosquitto), Redis",
    "Receives validations from 4,200 on-board and station validators over MQTT and forwards them as TicketValidated events.",
    "validator-gateway terminates the MQTT sessions of the validator fleet, authenticates devices with per-device certificates, de-duplicates retransmissions with a Redis window and publishes TicketValidated v2 events to Kafka. Validators keep an offline queue for up to 72 hours (ADR-010); when a vehicle regains coverage the gateway drains the queue in order and tags the events as delayed.",
    ["contracts/ticket-validated-v2"], [], ["dependencies/eclipse-mosquitto-mqtt", "dependencies/redis", "dependencies/apache-kafka"],
    "The Bologna outage of January 2026 was caused by an expired intermediate CA on the MQTT broker; see the incident and the certificate renewal runbook. Scale horizontally with the scale-validator-gateway runbook before major events (fairs, derby days).",
    { slos: ["slos/validator-gateway-availability", "slos/validator-gateway-ingest-latency"], incidents: ["incidents/inc-2026-001-validator-outage-bologna"] }],
  ["services/validation-ledger", "en", "validation-ledger", "team-biglietti", "Java 21 / Spring Boot 3, PostgreSQL (partitioned by month)",
    "Append-only ledger of every validation; source of truth for inspections, caps and operator settlement.",
    "validation-ledger consumes TicketValidated events and appends them to a monthly-partitioned PostgreSQL table with an idempotency key (device id, sequence number). It answers 'was this ticket validated on this vehicle' for the inspector backend and feeds the warehouse. Retention is 24 months for raw validations and 10 years for aggregates (ADR-019).",
    [], ["contracts/ticket-validated-v2"], ["dependencies/postgresql-16", "dependencies/apache-kafka"],
    "Partitioning strategy is an open question: monthly partitions reached 180 GB in September 2026.",
    { slos: [], questions: ["questions/q-006-postgres-partitioning-validations"] }],
  ["services/wallet-service", "en", "wallet-service", "team-pagamenti", "Java 21 / Axon Framework, PostgreSQL event store",
    "Prepaid wallet per account: top-ups, debits, holds and reversals, event-sourced.",
    "wallet-service keeps one event-sourced aggregate per wallet (ADR-001). Every debit is a command that fails if the balance would go negative; holds reserve funds for pay-as-you-go journeys until the daily cap is settled by fare-engine. Balances are projected to a read model used by the BFF; the projection lags the event store by under a second in normal operation.",
    ["contracts/wallet-transaction-v1"], ["contracts/wallet-topup-requested-v1", "contracts/payment-authorized-v1", "contracts/fare-computed-v1"], ["dependencies/postgresql-16", "dependencies/apache-kafka"],
    "The double-charge incident of February 2026 was a duplicate command replay after a Kafka rebalance; fixed by making the command handler idempotent on the payment id. Balances are reconciled nightly against the PSP settlement file with the wallet balance reconciliation runbook.",
    { slos: ["slos/wallet-service-consistency"], incidents: ["incidents/inc-2026-004-wallet-double-charge"] }],
  ["services/payments-orchestrator", "en", "payments-orchestrator", "team-pagamenti", "Java 21 / Spring Boot 3, PostgreSQL",
    "Orchestrates card payments through the PSP adapters: authorization, 3-D Secure, capture, refunds.",
    "payments-orchestrator exposes one internal payment API and routes to Nexi XPay as the primary PSP (ADR-018) with a fallback adapter kept warm for failover. It runs the 3-D Secure challenge flow, captures on ticket issue, and publishes PaymentAuthorized and PaymentRefunded events through the transactional outbox (ADR-012). PSP credentials are rotated quarterly with the rotate-psp-credentials runbook.",
    ["contracts/payment-authorized-v1", "contracts/payment-refunded-v1"], ["contracts/wallet-topup-requested-v1"], ["dependencies/nexi-xpay", "dependencies/postgresql-16", "dependencies/apache-kafka"],
    "PCI DSS scope: card data never touches our network; the hosted payment page tokenises the PAN.",
    { slos: ["slos/payments-orchestrator-authorization-success"] }],
  ["services/pagopa-adapter", "it", "pagopa-adapter", "team-pagamenti", "Java 21 / Spring Boot 3, PostgreSQL",
    "Integrazione con la piattaforma pagoPA per abbonamenti e sanzioni: creazione avvisi, ricezione delle ricevute telematiche (RT), riconciliazione.",
    "pagopa-adapter genera gli avvisi di pagamento pagoPA per gli abbonamenti annuali e per le sanzioni elevate dai controllori, riceve le ricevute telematiche (RT) dal nodo e le riconcilia con gli ordini interni. L'integrazione è diretta con il nodo dei pagamenti (ADR-009), senza intermediario tecnologico. Gli avvisi non pagati scadono dopo 30 giorni e vengono annullati in batch notturno.",
    ["contracts/payment-authorized-v1"], [], ["dependencies/pagopa-platform", "dependencies/postgresql-16"],
    "L'incidente di marzo 2026 (timeout del nodo) ha lasciato 1.900 RT non riconciliate per 14 ore: la procedura di riconciliazione manuale è nel runbook dedicato. Le RT arrivano anche a distanza di giorni: non trattare mai un avviso come non pagato prima della scadenza.",
    { slos: ["slos/pagopa-adapter-rt-delivery"], incidents: ["incidents/inc-2026-007-pagopa-timeout"] }],
  ["services/identity-service", "en", "identity-service", "team-identita", "Keycloak 25 extensions (Java), PostgreSQL",
    "Accounts, SPID and CIE login, sessions and tokens for apps, storefront and operator portal.",
    "identity-service is a thin layer over Keycloak realms (ADR-004): one realm for citizens with SPID and CIE identity providers, one for operators with corporate SAML. It issues the JWTs that the API gateway validates and publishes AccountCreated events. SPID level 2 is required for subscription purchases with tax benefits; CIE login from mobile is still an open question.",
    ["contracts/account-created-v1"], [], ["dependencies/keycloak", "dependencies/spid-cie-idp", "dependencies/postgresql-16"],
    "The SPID login outage of April 2026 was caused by an identity provider metadata rotation we did not pick up; metadata is now refreshed hourly and alerted on signature failures.",
    { slos: ["slos/identity-service-login-availability"], incidents: ["incidents/inc-2026-013-spid-login-down"], questions: ["questions/q-008-cie-mobile-login"] }],
  ["services/consent-manager", "it", "consent-manager", "team-identita", "Node.js 22 / Fastify, PostgreSQL",
    "Gestione dei consensi GDPR (marketing, profilazione, geolocalizzazione) e delle richieste di cancellazione.",
    "consent-manager registra i consensi espressi dagli utenti nelle app e nello storefront, con versione dell'informativa e timestamp, e pubblica ConsentChanged per i servizi che devono adeguarsi (notification-hub smette di inviare marketing entro 5 minuti). Gestisce anche le richieste di cancellazione dell'account: orchestra l'anonimizzazione nel ledger delle validazioni e nel warehouse entro 30 giorni.",
    ["contracts/consent-changed-v1"], ["contracts/account-created-v1"], ["dependencies/postgresql-16", "dependencies/apache-kafka"],
    "Il registro dei trattamenti è nel wiki legale; questo servizio ne è l'implementazione tecnica. Le cancellazioni non toccano gli aggregati fiscali (10 anni).",
    { slos: [] }],
  ["services/trip-planner", "en", "trip-planner", "team-mobilita", "Rust 1.80, in-memory transit graph",
    "Door-to-door journey planning over the regional GTFS network with real-time adjustments.",
    "trip-planner implements a RAPTOR-based router (ADR-005) over the merged GTFS of all regional operators, with walking legs from OpenStreetMap and real-time delays from the predictions service. The graph is rebuilt in memory on every GTFS release and swapped atomically; a release that fails validation keeps the previous graph. It serves the planner API v1 to the BFF and the storefront.",
    [], ["contracts/gtfs-feed-manifest-v1", "contracts/arrival-prediction-v1"], ["dependencies/redis"],
    "Memory per replica is 6 GB with the full regional network; the SSR cost question for the storefront is partly about planner calls.",
    { api: "contracts/api-planner-v1", slos: ["slos/trip-planner-latency"] }],
  ["services/gtfs-ingest", "en", "gtfs-ingest", "team-mobilita", "Python 3.12, Prefect, PostgreSQL",
    "Downloads, validates and merges GTFS and GTFS-RT feeds from the regional operators.",
    "gtfs-ingest pulls the static GTFS of each operator on their publication schedule, validates it with the MobilityData validator, merges the feeds into one regional dataset and publishes a GtfsFeedManifest when a new release is ready. GTFS-RT trip updates and alerts are proxied with a 30-second cache. A feed that fails validation is rejected and the operator is notified; the previous release stays active.",
    ["contracts/gtfs-feed-manifest-v1"], [], ["dependencies/postgresql-16", "dependencies/apache-kafka"],
    "The import failure of March 2026 came from an operator shipping a GTFS with duplicated trip ids; the manual import runbook covers the override. Feed quality by vendor is an open question.",
    { slos: ["slos/gtfs-ingest-freshness"], incidents: ["incidents/inc-2026-009-gtfs-import-failure"], questions: ["questions/q-003-gtfs-rt-vendor-quality"] }],
  ["services/avl-collector", "en", "avl-collector", "team-mobilita", "Go 1.23, MQTT, TimescaleDB",
    "Collects vehicle positions (AVL) from on-board units every 10 seconds and publishes VehiclePosition events.",
    "avl-collector receives positions from the on-board units of about 1,100 vehicles over the same MQTT broker as the validators, normalises them (WGS84, vehicle id, trip id when matched) and publishes VehiclePosition events. Positions are stored for 90 days in TimescaleDB for operator reporting. A vehicle with no position for 5 minutes during service is flagged to the operator portal.",
    ["contracts/vehicle-position-v1"], [], ["dependencies/eclipse-mosquitto-mqtt", "dependencies/apache-kafka"],
    "The stale feed incident of August 2026 was a stuck consumer group, not a broker problem: the avl-feed-restart runbook was written after it.",
    { slos: [], incidents: ["incidents/inc-2026-023-avl-feed-stale"] }],
  ["services/realtime-predictions", "en", "realtime-predictions", "team-mobilita", "Python 3.12, ONNX Runtime, Redis",
    "Predicts arrival times at stops from vehicle positions, schedule and historical delays.",
    "realtime-predictions joins VehiclePosition events with the active GTFS schedule and a gradient-boosted model of historical delays per route segment, and publishes ArrivalPrediction events consumed by the trip planner and the mobile BFF. The model is retrained weekly from the warehouse. The service is new (September 2026) and still in draft status in this catalog: prediction accuracy has an SLO but no alert yet.",
    ["contracts/arrival-prediction-v1"], ["contracts/vehicle-position-v1", "contracts/gtfs-feed-manifest-v1"], ["dependencies/onnx-runtime", "dependencies/redis", "dependencies/apache-kafka"],
    "Replaces the vendor predictions bought with the AVL hardware, whose contract ends in 2027.",
    { status: "draft", slos: ["slos/realtime-predictions-accuracy"] }],
  ["services/notification-hub", "en", "notification-hub", "team-piattaforma", "Node.js 22 / NestJS, Redis, PostgreSQL",
    "Sends push, SMS and email notifications with templates, rate limits and consent checks.",
    "notification-hub accepts NotificationRequest events, renders the template in the user's language, checks the consent state for marketing messages and delivers through Firebase Cloud Messaging, the SMS gateway or SES. Per-user and per-campaign rate limits protect against storms: the May 2026 storm sent 1.2 million duplicate pushes when a producer retried a batch without idempotency keys. Every request now needs a key.",
    [], ["contracts/notification-request-v1", "contracts/consent-changed-v1"], ["dependencies/firebase-cloud-messaging", "dependencies/redis", "dependencies/postgresql-16"],
    "Rate limits are tuned with the notification-rate-limit runbook; transactional messages (ticket issued, payment failed) bypass marketing consent but not the per-user limit.",
    { slos: ["slos/notification-hub-delivery"], incidents: ["incidents/inc-2026-016-push-notification-storm"] }],
  ["services/fraud-scoring", "en", "fraud-scoring", "team-dati", "Python 3.12 / FastAPI, ONNX Runtime, Redis",
    "Scores validations and top-ups for fraud (cloned QR codes, stolen cards, inspection evasion patterns).",
    "fraud-scoring combines deterministic rules (same QR validated on two vehicles 40 km apart within 10 minutes) with an ONNX model trained on labelled inspection outcomes. It publishes FraudScore events; scores above 0.9 block the ticket and notify the inspector backend. The model is retrained monthly, which is too slow according to the open question on retraining cadence.",
    ["contracts/fraud-score-v1"], ["contracts/ticket-validated-v2", "contracts/wallet-topup-requested-v1", "contracts/inspection-result-v1"], ["dependencies/onnx-runtime", "dependencies/redis", "dependencies/apache-kafka"],
    "False positives are reviewed weekly by team biglietti; the threshold is a feature flag.",
    { slos: ["slos/fraud-scoring-latency"], questions: ["questions/q-004-fraud-model-retraining"] }],
  ["services/reporting-warehouse", "en", "reporting-warehouse", "team-dati", "ClickHouse 24, dbt, Airflow",
    "Analytical warehouse for validations, sales, settlement between operators and regulatory reports.",
    "reporting-warehouse ingests every Kafka topic through ClickHouse Kafka engines, models them with dbt into settlement, ridership and revenue marts, and serves the operator portal dashboards and the quarterly report to the Regione. Raw tables keep 24 months; marts keep 10 years. The disk-full incident of June 2026 came from an unbounded raw table of AVL positions that nobody had put a TTL on.",
    [], ["contracts/ticket-validated-v2", "contracts/wallet-transaction-v1", "contracts/payment-authorized-v1", "contracts/vehicle-position-v1", "contracts/subscription-renewed-v1"], ["dependencies/clickhouse", "dependencies/apache-kafka"],
    "Freshness SLO is 15 minutes for the operator dashboards; the regulatory marts are rebuilt nightly.",
    { slos: ["slos/reporting-warehouse-freshness"], incidents: ["incidents/inc-2026-018-clickhouse-disk-full"] }],
  ["services/operator-portal", "it", "operator-portal", "team-dati", "React 19 / Vite, Node.js 22 BFF",
    "Portale di back-office per gli operatori regionali: cruscotti, rendicontazione, gestione flotta e tariffe.",
    "operator-portal è l'applicazione web usata dagli operatori regionali (TPL) per consultare validazioni e incassi, scaricare la rendicontazione mensile per la compensazione tra operatori, pubblicare le tabelle tariffarie e vedere lo stato della flotta (posizioni AVL, veicoli senza segnale). L'accesso avviene con SAML aziendale sul realm operatori. Non ha accesso ai dati personali dei viaggiatori: vede solo aggregati.",
    [], ["contracts/vehicle-position-v1"], ["dependencies/keycloak", "dependencies/clickhouse"],
    "Le tabelle tariffarie pubblicate dal portale diventano attive nel fare-engine solo dopo l'approvazione del team biglietti.",
    { slos: [] }],
  ["services/mobile-bff", "en", "mobile-bff", "team-piattaforma", "Node.js 22 / NestJS, Redis",
    "Backend-for-frontend of the iOS and Android apps: aggregates tickets, wallet, planner and predictions.",
    "mobile-bff composes the screens of the apps from the tickets API, the wallet read model, the planner and the predictions cache, and adapts them per app version. It is the only caller allowed to use the batch endpoints of the tickets API. Responses are cached in Redis for 5 seconds per user to absorb pull-to-refresh storms.",
    [], ["contracts/arrival-prediction-v1"], ["dependencies/redis", "dependencies/kong-gateway"],
    "App versions older than 12 months are refused with a forced-update response.",
    { slos: ["slos/mobile-bff-latency"] }],
  ["services/web-storefront", "en", "web-storefront", "team-piattaforma", "Next.js 15 (SSR), Node.js 22",
    "Public web shop for tickets and subscriptions, with the journey planner embedded.",
    "web-storefront is the server-rendered public site: fares, ticket purchase, subscription purchase with SPID, and the planner. It talks to the same APIs as the apps through the API gateway. The DDoS of October 2026 saturated the SSR pods because planner searches were rendered server-side per request; the mitigation moved planner results to client-side fetching behind a challenge.",
    [], [], ["dependencies/kong-gateway", "dependencies/kubernetes-eks"],
    "SSR cost per request is tracked in the open question on storefront rendering.",
    { slos: [], incidents: ["incidents/inc-2026-029-storefront-ddos"], questions: ["questions/q-009-storefront-ssr-cost"] }],
  ["services/inspector-app-backend", "it", "inspector-app-backend", "team-biglietti", "Kotlin 2 / Ktor, PostgreSQL, Redis",
    "Backend dell'app dei controllori: verifica dei titoli di viaggio a bordo, sanzioni, sincronizzazione offline.",
    "inspector-app-backend risponde alle verifiche dei controllori: dato un QR o un token EMV letto a bordo, interroga il ledger delle validazioni e restituisce l'esito (valido, non validato, scaduto, bloccato per frode). Le sanzioni vengono registrate e inviate a pagopa-adapter per l'avviso. L'app funziona anche offline con una lista di revoca scaricata ogni 15 minuti; gli esiti vengono sincronizzati al rientro in copertura.",
    ["contracts/inspection-result-v1"], ["contracts/fraud-score-v1"], ["dependencies/postgresql-16", "dependencies/redis"],
    "L'incidente di settembre 2026 (sincronizzazione) ha prodotto 300 esiti duplicati: la chiave di idempotenza è ora (dispositivo, sequenza) come per i validatori.",
    { slos: ["slos/inspector-backend-sync-latency"], incidents: ["incidents/inc-2026-025-inspector-app-sync"] }],
  ["services/subscription-manager", "en", "subscription-manager", "team-biglietti", "Java 21 / Spring Boot 3, PostgreSQL",
    "Season passes: purchase, renewal, tax-benefit eligibility, suspension and refunds of subscriptions.",
    "subscription-manager manages monthly and annual passes, their renewal schedule and the eligibility checks for tax benefits (ISEE band, student status) that require SPID level 2. Renewals are driven by a scheduler that publishes SubscriptionRenewed events; the duplicate renewal incident of September 2026 came from two scheduler replicas both holding the lock after a Postgres failover.",
    ["contracts/subscription-renewed-v1"], ["contracts/payment-authorized-v1", "contracts/account-created-v1"], ["dependencies/postgresql-16", "dependencies/apache-kafka"],
    "Annual passes are paid through pagoPA when bought by companies for their employees.",
    { slos: ["slos/subscription-manager-renewal-success"], incidents: ["incidents/inc-2026-027-subscription-renewal-duplicate"] }],
  ["services/refund-service", "en", "refund-service", "team-pagamenti", "Java 21 / Spring Boot 3, PostgreSQL, Temporal",
    "Refund workflow for tickets, subscriptions and wallet balances, with approval steps and PSP execution.",
    "refund-service runs a Temporal workflow per refund request: eligibility (unused ticket, strike days, subscription suspension), approval when above 50 euro, execution through payments-orchestrator or as wallet credit, and customer notification. Requests stuck in the approval queue were the September 2026 incident: the approval task queue had no worker after a deployment removed the worker deployment by mistake.",
    [], ["contracts/payment-refunded-v1"], ["dependencies/postgresql-16", "dependencies/apache-kafka"],
    "Target turnaround is 5 working days; the SLO measures it end to end.",
    { slos: ["slos/refund-service-turnaround"], incidents: ["incidents/inc-2026-022-refund-queue-stuck"] }],
  ["services/api-gateway", "en", "api-gateway", "team-piattaforma", "Kong Gateway 3.8 on Kubernetes",
    "Edge gateway: TLS termination, JWT validation, rate limiting, routing and API versioning by URL path.",
    "api-gateway fronts every public and partner API (ADR-013): it validates the JWTs issued by identity-service, applies per-consumer rate limits, routes /v3/tickets, /v2/fares and /v1/planner to the owning services (ADR-008) and terminates TLS with certificates from cert-manager. The certificate expiry incident of June 2026 happened on a partner domain that cert-manager did not manage; all public hostnames are now in the automated inventory.",
    [], [], ["dependencies/kong-gateway", "dependencies/kubernetes-eks"],
    "Rate limit defaults: 60 requests per minute per anonymous IP, 600 per authenticated user, 6,000 per partner.",
    { slos: ["slos/api-gateway-availability"], incidents: ["incidents/inc-2026-020-api-gateway-cert-expiry"] }],
  ["services/legacy-sbe", "it", "legacy-sbe (Sistema di Bigliettazione Elettronica)", "team-biglietti", "Java 8 monolite, Oracle 12c",
    "Monolite storico di bigliettazione elettronica, in dismissione: resta solo per gli abbonamenti su tessera fisica fino a marzo 2027.",
    "legacy-sbe è il sistema di bigliettazione elettronica in esercizio dal 2014: emissione su tessera contactless Mifare, validazione, rendicontazione. Dal 2025 le funzioni sono state migrate ai servizi del catalogo (ADR-017); restano attive solo le tessere fisiche degli abbonati annuali, che scadono entro marzo 2027. Non si sviluppano nuove funzionalità; le patch di sicurezza sono applicate dal fornitore.",
    [], [], [],
    "Il crash di novembre 2025 (tablespace Oracle pieno) è documentato nell'incidente storico. Il runbook di riavvio è deprecato insieme al servizio: in caso di problemi contattare il fornitore, non riavviare.",
    { status: "deprecated", stale: "2026-03-31", incidents: ["incidents/inc-2025-041-legacy-sbe-crash"] }],
];

const SERVICE_INDEX = new Map(SERVICES.map((s) => [s[0], s]));
SERVICES.forEach(([id, lang, title, team, runtime, description, purpose, produces, consumes, deps, notes, extra]) => {
  const x = extra || {};
  const it = lang === "it";
  const prov = provenance("service");
  if (x.status) prov.status = x.status;
  if (x.stale) prov.stale_after = x.stale;
  if (x.status === "deprecated") { prov.verified = { by: ACTOR.ticketing, at: isoAt(2025, 12, 10) }; }
  const relations = [rel("owned_by", `teams/${team}`)]
    .concat(produces.map((c) => rel("produces", c)))
    .concat(consumes.map((c) => rel("consumes", c)))
    .concat(deps.map((d) => rel("depends_on", d)))
    .concat((x.slos || []).map((s) => rel("measured_by", s)))
    .concat(x.api ? [rel("implements", x.api)] : []);
  const sections = [];
  sections.push(`# ${title}\n\n${purpose}`);
  sections.push(`## ${it ? "Proprietà e runtime" : "Ownership and runtime"}\n${it ? "Team" : "Team"}: ${mdlink(team, `teams/${team}`)} · ${it ? "Runtime" : "Runtime"}: ${runtime}`);
  const iface = [];
  if (x.api) iface.push(`- ${it ? "Espone" : "Exposes"} ${mdlink(x.api.split("/")[1], x.api)}`);
  produces.forEach((c) => iface.push(`- ${it ? "Produce" : "Produces"} ${mdlink(c.split("/")[1], c)}`));
  consumes.forEach((c) => iface.push(`- ${it ? "Consuma" : "Consumes"} ${mdlink(c.split("/")[1], c)}`));
  sections.push(`## ${it ? "Interfacce" : "Interfaces"}\n${iface.length ? iface.join("\n") : (it ? "Nessuna interfaccia a eventi: solo accesso diretto al database." : "No event interfaces: direct database access only.")}`);
  sections.push(`## ${it ? "Dipendenze" : "Dependencies"}\n${deps.length ? deps.map((d) => `- ${mdlink(d.split("/")[1], d)}`).join("\n") : (it ? "Nessuna dipendenza censita nel catalogo (stack fornitore)." : "No catalogued dependencies.")}`);
  const ops = [];
  (x.slos || []).forEach((s) => ops.push(`- SLO: ${mdlink(s.split("/")[1], s)}`));
  (x.incidents || []).forEach((i) => ops.push(`- ${it ? "Incidente" : "Incident"}: ${mdlink(i.split("/")[1], i)}`));
  (x.questions || []).forEach((q) => ops.push(`- ${it ? "Questione aperta" : "Open question"}: ${mdlink(q.split("/")[1], q)}`));
  sections.push(`## ${it ? "Note operative" : "Operational notes"}\n${notes}${ops.length ? `\n\n${ops.join("\n")}` : ""}`);
  cat({
    id, type: "Service", lang, title, description,
    tags: ["service", team.replace("team-", ""), ...(it ? ["servizio"] : [])],
    aliases: [title.split(" ")[0]],
    runtime, ...prov, relations,
    body: `${sections.join("\n\n")}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Data contracts (19)
// ---------------------------------------------------------------------------------------------
// [id, lang, title, kind, channel, format, owner team, description, fields, compatibility, pii, retention, notes, extra]
const CONTRACTS = [
  ["contracts/ticket-validated-v2", "en", "TicketValidated v2", "event", "ticketing.validations.v2", "Avro (schema registry subject ticketing.validations.v2-value)", "team-biglietti",
    "Event emitted by validator-gateway for every validation; v2 adds the delayed flag and the EMV token hash.",
    ["ticket_id (uuid)", "device_id (string, validator serial)", "sequence (long, per device, idempotency key with device_id)", "validated_at (timestamp-millis, device clock)", "received_at (timestamp-millis, gateway clock)", "vehicle_id / stop_id (optional)", "zone (string)", "medium (enum: QR, EMV, CARD)", "token_hash (bytes, EMV only)", "delayed (boolean: true when drained from the offline queue)"],
    "BACKWARD; consumers must tolerate new optional fields. Producers: validator-gateway only.", "ticket_id links to an account through ticket-issuer; the event itself carries no direct identifier.", "Kafka 30 days; ledger 24 months; warehouse raw 24 months.",
    "v1 is deprecated since 2026-05-01 and its topic is read only by the legacy SBE bridge. The sequence field is what the ledger and the inspector backend use to de-duplicate.", { supersedes: "contracts/ticket-validated-v1" }],
  ["contracts/ticket-validated-v1", "en", "TicketValidated v1 (deprecated)", "event", "ticketing.validations.v1", "JSON", "team-biglietti",
    "Deprecated validation event without the delayed flag; kept for the legacy SBE bridge until March 2027.",
    ["ticket_id", "device_id", "validated_at", "zone"], "None (JSON without registry).", "Same as v2.", "Kafka 7 days.",
    "Do not add consumers. The bridge that mirrors v2 into v1 is removed when the legacy SBE is retired.", { status: "deprecated", stale: "2026-05-01" }],
  ["contracts/fare-computed-v1", "en", "FareComputed v1", "event", "ticketing.fares.v1", "Avro", "team-biglietti",
    "Price decision for a journey or a cap settlement, emitted by fare-engine.",
    ["journey_id", "account_id (optional for anonymous QR)", "amount_cents", "currency (EUR)", "fare_table_version", "cap_applied (enum: NONE, DAILY, WEEKLY)", "computed_at"],
    "BACKWARD.", "account_id is a pseudonymous id.", "Kafka 30 days; warehouse 10 years (aggregates).",
    "fare_table_version makes every price reproducible: the hotfix runbook relies on it.", {}],
  ["contracts/wallet-transaction-v1", "en", "WalletTransaction v1", "event", "payments.wallet.transactions.v1", "Avro", "team-pagamenti",
    "Every settled wallet movement: top-up, debit, hold, release, reversal.",
    ["wallet_id", "transaction_id (idempotency key)", "kind (enum)", "amount_cents (signed)", "balance_after_cents", "reference (payment id or journey id)", "occurred_at"],
    "BACKWARD.", "wallet_id maps to an account.", "Kafka 90 days; event store indefinitely (fiscal retention 10 years).",
    "balance_after_cents is authoritative for the read model; the nightly reconciliation compares it with the PSP settlement.", {}],
  ["contracts/wallet-topup-requested-v1", "en", "WalletTopUpRequested v1", "command", "payments.wallet.topups.v1", "Avro", "team-pagamenti",
    "Command from the BFF or storefront asking for a top-up through the PSP.",
    ["wallet_id", "request_id (idempotency key)", "amount_cents", "payment_method (enum: CARD, PAGOPA)", "requested_at"],
    "FULL.", "None beyond wallet_id.", "Kafka 7 days.", "Fraud scoring consumes it to spot card-testing patterns (many small top-ups).", {}],
  ["contracts/payment-authorized-v1", "en", "PaymentAuthorized v1", "event", "payments.authorizations.v1", "Avro", "team-pagamenti",
    "Successful authorization or capture at the PSP or a paid pagoPA notice.",
    ["payment_id", "order_id", "amount_cents", "psp (enum: NEXI, FALLBACK, PAGOPA)", "card_brand (optional)", "authorized_at", "captured (boolean)"],
    "BACKWARD.", "No PAN; card_brand only.", "Kafka 90 days; warehouse 10 years.", "Published through the transactional outbox of payments-orchestrator (ADR-012), never directly from the request thread.", {}],
  ["contracts/payment-refunded-v1", "en", "PaymentRefunded v1", "event", "payments.refunds.v1", "Avro", "team-pagamenti",
    "Refund executed at the PSP or credited to a wallet.", ["refund_id", "payment_id", "amount_cents", "channel (enum: PSP, WALLET)", "executed_at"],
    "BACKWARD.", "None.", "Kafka 90 days.", "refund-service consumes it to close the workflow.", {}],
  ["contracts/account-created-v1", "en", "AccountCreated v1", "event", "identity.accounts.v1", "Avro", "team-identita",
    "A citizen or operator account was created in Keycloak.", ["account_id", "realm (enum: CITIZENS, OPERATORS)", "login_method (enum: SPID, CIE, PASSWORD, SAML)", "spid_level (optional, 1-3)", "created_at"],
    "BACKWARD.", "account_id only; no name or fiscal code on the bus.", "Kafka 30 days.", "Fiscal code never travels on Kafka: services that need it call identity-service with the account id.", {}],
  ["contracts/consent-changed-v1", "it", "ConsentChanged v1", "event", "identity.consents.v1", "Avro", "team-identita",
    "Cambio di stato di un consenso GDPR (marketing, profilazione, geolocalizzazione).", ["account_id", "purpose (enum: MARKETING, PROFILING, GEOLOCATION)", "granted (boolean)", "policy_version", "changed_at"],
    "BACKWARD.", "Solo account_id.", "Kafka 30 giorni; registro consensi 10 anni.", "notification-hub deve applicare la revoca del marketing entro 5 minuti dalla ricezione.", {}],
  ["contracts/vehicle-position-v1", "en", "VehiclePosition v1", "event", "mobility.positions.v1", "Avro", "team-mobilita",
    "Vehicle position every 10 seconds from the on-board unit.", ["vehicle_id", "operator_id", "lat / lon (WGS84)", "bearing", "speed_kmh", "trip_id (optional, when matched)", "recorded_at", "received_at"],
    "BACKWARD.", "None.", "Kafka 3 days; TimescaleDB 90 days; warehouse raw with a 24-month TTL (added after the disk-full incident).", "About 9 million events per day.", {}],
  ["contracts/arrival-prediction-v1", "en", "ArrivalPrediction v1", "event", "mobility.predictions.v1", "Avro", "team-mobilita",
    "Predicted arrival at a stop for a trip, refreshed every 30 seconds.", ["trip_id", "stop_id", "predicted_at", "arrival_at", "confidence (0-1)", "model_version"],
    "BACKWARD.", "None.", "Kafka 1 day; Redis latest value only.", "confidence below 0.3 is shown as 'scheduled' in the apps, not as a prediction.", {}],
  ["contracts/gtfs-feed-manifest-v1", "en", "GtfsFeedManifest v1", "event", "mobility.gtfs.releases.v1", "JSON Schema", "team-mobilita",
    "Announces a validated merged GTFS release with its download location and validity window.", ["release_id", "operators (list)", "valid_from / valid_to", "object_store_url", "validator_report_url", "published_at"],
    "Additive JSON; consumers ignore unknown keys.", "None.", "Kafka 90 days; releases kept 2 years in object storage.", "trip-planner and realtime-predictions rebuild on this event; a manual import publishes the same manifest.", {}],
  ["contracts/subscription-renewed-v1", "en", "SubscriptionRenewed v1", "event", "ticketing.subscriptions.renewals.v1", "Avro", "team-biglietti",
    "A season pass was renewed and charged.", ["subscription_id", "account_id", "period_start / period_end", "amount_cents", "payment_id", "renewed_at"],
    "BACKWARD.", "account_id.", "Kafka 90 days; warehouse 10 years.", "Exactly-once is not guaranteed by Kafka: consumers de-duplicate on (subscription_id, period_start), which is how the duplicate renewal incident was contained downstream.", {}],
  ["contracts/fraud-score-v1", "en", "FraudScore v1", "event", "risk.scores.v1", "Avro", "team-dati",
    "Fraud score for a validation or top-up, with the rule or model that produced it.", ["subject_kind (enum: VALIDATION, TOPUP)", "subject_id", "score (0-1)", "reasons (list of rule ids)", "model_version", "scored_at"],
    "BACKWARD.", "None.", "Kafka 30 days.", "Scores above 0.9 block; between 0.6 and 0.9 flag for inspection.", {}],
  ["contracts/inspection-result-v1", "it", "InspectionResult v1", "event", "ticketing.inspections.v1", "Avro", "team-biglietti",
    "Esito di una verifica a bordo da parte di un controllore.", ["inspection_id", "device_id + sequence (chiave di idempotenza)", "ticket_id (opzionale)", "outcome (enum: VALID, NOT_VALIDATED, EXPIRED, BLOCKED, NO_TICKET)", "fine_issued (boolean)", "inspected_at", "synced_at"],
    "BACKWARD.", "Nessun dato personale: la sanzione con i dati anagrafici resta nel backend dei controllori.", "Kafka 90 giorni; warehouse 10 anni.", "synced_at può distare ore da inspected_at quando l'app era offline.", {}],
  ["contracts/notification-request-v1", "en", "NotificationRequest v1", "command", "platform.notifications.requests.v1", "Avro", "team-piattaforma",
    "Request to send a notification to an account through push, SMS or email.", ["request_id (idempotency key, mandatory since 2026-05-20)", "account_id", "template_id", "channel preference", "variables (map)", "category (enum: TRANSACTIONAL, MARKETING)", "requested_at"],
    "FULL.", "account_id; variables must not contain personal data beyond first name.", "Kafka 7 days.", "Producers without request_id are rejected at the schema level after the notification storm.", {}],
  ["contracts/api-tickets-v3", "en", "Tickets API v3 (REST)", "api", "/v3/tickets", "OpenAPI 3.1", "team-biglietti",
    "Purchase, list and show tickets and carnets; batch endpoints restricted to the mobile BFF.",
    ["POST /v3/tickets (idempotency-key header required)", "GET /v3/tickets/{id}", "GET /v3/accounts/{id}/tickets?status=", "POST /v3/tickets:batch (BFF only)", "GET /v3/tickets/{id}/qr (rotating payload)"],
    "URL-path versioning (ADR-008); v2 is sunset on 2027-01-31.", "Account-scoped; JWT validated by the gateway.", "Not applicable.", "Error model follows RFC 9457 problem details.", {}],
  ["contracts/api-fares-v2", "en", "Fares API v2 (REST)", "api", "/v2/fares", "OpenAPI 3.1", "team-biglietti",
    "Quote a journey price and list zones and time bands.", ["GET /v2/fares/quote?from=&to=&at=", "GET /v2/zones", "GET /v2/fare-tables/{version}"],
    "URL-path versioning; quotes are cacheable for 60 seconds.", "None.", "Not applicable.", "Served by fare-engine; the quote endpoint is the one measured by the latency SLO.", {}],
  ["contracts/api-planner-v1", "en", "Planner API v1 (REST)", "api", "/v1/planner", "OpenAPI 3.1", "team-mobilita",
    "Journey planning between coordinates or stops with departure or arrival time.", ["GET /v1/planner/plan?from=&to=&depart_at=|arrive_by=", "GET /v1/planner/stops/nearby?lat=&lon="],
    "URL-path versioning.", "Coordinates are not stored.", "Not applicable.", "Public, rate limited to 60 requests per minute per IP; the storefront DDoS hit this endpoint.", {}],
];
CONTRACTS.forEach(([id, lang, title, kind, channel, format, team, description, fields, compatibility, pii, retention, notes, extra]) => {
  const x = extra || {};
  const it = lang === "it";
  const prov = provenance("contract");
  if (x.status) prov.status = x.status;
  if (x.stale) prov.stale_after = x.stale;
  const relations = [rel("owned_by", `teams/${team}`)].concat(x.supersedes ? [rel("supersedes", x.supersedes)] : []);
  const kindLabel = kind === "api" ? "REST API" : kind === "command" ? (it ? "comando" : "command") : (it ? "evento" : "event");
  cat({
    id, type: "Data Contract", lang, title, description,
    tags: ["contract", kind, team.replace("team-", ""), ...(it ? ["contratto"] : [])],
    aliases: [channel],
    channel, format, ...prov, relations,
    body: `# ${title}\n\n${description}\n\n**${it ? "Tipo" : "Kind"}:** ${kindLabel} · **${kind === "api" ? (it ? "Percorso" : "Path") : (it ? "Topic" : "Topic")}:** \`${channel}\` · **${it ? "Formato" : "Format"}:** ${format} · **Owner:** ${mdlink(team, `teams/${team}`)}\n\n## ${kind === "api" ? (it ? "Endpoint" : "Endpoints") : (it ? "Campi" : "Fields")}\n${fields.map((f) => `- ${f}`).join("\n")}\n\n## ${it ? "Compatibilità" : "Compatibility"}\n${compatibility}\n\n## ${it ? "Dati personali" : "Personal data"}\n${pii}\n\n## ${it ? "Conservazione" : "Retention"}\n${retention}\n\n## ${it ? "Note" : "Notes"}\n${notes}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Architecture decision records (21)
// ---------------------------------------------------------------------------------------------
// [id, lang, number, title, date, description, context, decision, consequences, related, extra]
const ADRS = [
  ["decisions/adr-001-event-sourcing-for-wallet", "en", 1, "ADR-001: Event sourcing for the prepaid wallet", "2025-07-10",
    "The wallet is an event-sourced aggregate; balances are projections.",
    "The prepaid wallet must explain every cent to customers and auditors, support reversals months later and survive PSP reconciliation disputes. A mutable balance column cannot reconstruct history.",
    "Model each wallet as an event-sourced aggregate (Axon Framework) with commands validated against the replayed state. The balance read model is a projection that can be rebuilt from the event store at any time.",
    "Audit and reconciliation become trivial; the cost is operational: projection lag, snapshotting every 200 events, and command idempotency has to be designed in (it was not, see the double-charge post-mortem).",
    ["services/wallet-service", "postmortems/pm-2026-004-wallet-double-charge"], {}],
  ["decisions/adr-002-kafka-as-event-backbone", "en", 2, "ADR-002: Apache Kafka as the event backbone", "2025-07-10",
    "All inter-service events go through Kafka with Avro schemas.",
    "Ticketing produces about 2 million validations and 9 million vehicle positions a day; consumers (ledger, fraud, warehouse, predictions) need replay and independent pace.",
    "Use Apache Kafka (managed, 3 brokers per environment) as the only asynchronous channel between services. Topics are named <domain>.<entity>.<version>; every topic has an owner team and a registered schema.",
    "Replay and fan-out come for free; the team must operate consumer lag, rebalances and schema evolution. Synchronous calls remain for queries.",
    ["dependencies/apache-kafka", "decisions/adr-011-avro-schema-registry"], {}],
  ["decisions/adr-003-postgres-over-cockroach", "en", 3, "ADR-003: PostgreSQL instead of CockroachDB for transactional data", "2025-08-02",
    "Keep PostgreSQL 16 with managed failover; no distributed SQL for now.",
    "A multi-region active-active deployment was considered for the ledger and the wallet. CockroachDB would give it at the cost of latency, licensing and a new operational skill set.",
    "Standardise on PostgreSQL 16 (managed, one primary per service, synchronous replica in a second availability zone). Revisit when a second region becomes a regulatory or business requirement.",
    "Simple operations and skills already in house; a regional failover is a runbook, not automatic. The multi-region question stays open.",
    ["dependencies/postgresql-16", "questions/q-001-multi-region-active-active", "runbooks/postgres-failover"], {}],
  ["decisions/adr-004-keycloak-for-spid-cie", "it", 4, "ADR-004: Keycloak come identity provider per SPID e CIE", "2025-08-20",
    "Keycloak gestisce i realm cittadini e operatori; SPID e CIE sono identity provider federati.",
    "L'accesso con SPID (livello 2) e CIE è obbligatorio per gli abbonamenti con agevolazioni fiscali; gli operatori accedono con SAML aziendale. Servono due popolazioni separate, sessioni, token e un registro degli accessi.",
    "Adottare Keycloak 25 con due realm (cittadini, operatori). SPID e CIE sono configurati come identity provider SAML federati con i metadati aggiornati automaticamente; le estensioni custom restano minime (mappatura attributi, livello SPID nel token).",
    "Tempi brevi e conformità alle regole tecniche AgID; dipendenza dalla rotazione dei metadati degli IdP (causa dell'incidente di aprile 2026). Il login CIE da mobile resta una questione aperta.",
    ["services/identity-service", "dependencies/keycloak", "incidents/inc-2026-013-spid-login-down"], {}],
  ["decisions/adr-005-raptor-trip-planner", "en", 5, "ADR-005: In-house RAPTOR trip planner instead of OpenTripPlanner", "2025-09-05",
    "Build the planner in Rust on RAPTOR; do not run OpenTripPlanner.",
    "OpenTripPlanner covers the need but its memory footprint with real-time updates and its JVM tuning were a recurring source of incidents at the previous vendor. The regional network is small enough for an in-memory router.",
    "Implement RAPTOR (round-based public transit routing) in Rust with walking legs precomputed from OpenStreetMap; rebuild the graph per GTFS release and swap atomically.",
    "Predictable latency (p95 under 150 ms) and 6 GB per replica; the team owns an algorithmic codebase, which is a hiring constraint.",
    ["services/trip-planner"], {}],
  ["decisions/adr-006-clickhouse-warehouse", "en", 6, "ADR-006: ClickHouse as the analytical warehouse", "2025-09-20",
    "ClickHouse with Kafka engines and dbt replaces the Oracle reporting schema of the legacy SBE.",
    "Operator settlement and the regional reports need joins over billions of validations; the Oracle reporting schema took 9 hours nightly.",
    "Run ClickHouse 24 (3 shards, 2 replicas) ingesting Kafka topics directly; model with dbt; keep raw 24 months and marts 10 years.",
    "Reports in minutes; TTLs must be declared on every raw table (lesson from the disk-full incident).",
    ["services/reporting-warehouse", "dependencies/clickhouse", "incidents/inc-2026-018-clickhouse-disk-full"], {}],
  ["decisions/adr-007-monorepo", "en", 7, "ADR-007 (superseded): Single monorepo for all services", "2025-07-25",
    "Superseded by ADR-015: the monorepo slowed CI and blurred ownership.",
    "At the start the platform had 6 services and 12 engineers; one repository simplified shared libraries and refactors.",
    "Keep every service in one Git repository with a shared build (Gradle composite + pnpm workspaces).",
    "Worked until about 15 services; CI took 40 minutes and ownership of shared code was unclear. Replaced by one repository per team in ADR-015.",
    ["decisions/adr-015-polyrepo-per-team"], { status: "deprecated", stale: "2026-02-28" }],
  ["decisions/adr-008-api-versioning-url-path", "en", 8, "ADR-008: API versioning in the URL path", "2025-10-01",
    "Public APIs carry the major version in the path (/v3/tickets); minor changes are additive.",
    "Partners and the apps need a stable contract; header-based versioning was invisible in logs and hard for partners.",
    "Major version in the first path segment, routed by the API gateway; additive changes within a major; a deprecated major is kept for 12 months with a Sunset header.",
    "Clear in logs and documentation; multiple majors run side by side, which costs routing rules and double testing.",
    ["services/api-gateway", "contracts/api-tickets-v3"], {}],
  ["decisions/adr-009-pagopa-direct-integration", "it", 9, "ADR-009: Integrazione diretta con il nodo pagoPA", "2025-10-15",
    "Integrazione diretta con il nodo dei pagamenti, senza partner tecnologico.",
    "Gli abbonamenti aziendali e le sanzioni devono essere incassati tramite pagoPA. Un partner tecnologico costa lo 0,8% per transazione e introduce un terzo sistema da riconciliare.",
    "Integrarsi direttamente con il nodo pagoPA (ente creditore con intermediario proprio), gestendo avvisi, RPT/RT e riconciliazione in pagopa-adapter.",
    "Risparmio sulle commissioni e un solo punto di riconciliazione; il team pagamenti deve seguire le specifiche SANP e i certificati del nodo. Il timeout del nodo di marzo 2026 ha mostrato che la riconciliazione manuale deve essere un runbook pronto.",
    ["services/pagopa-adapter", "dependencies/pagopa-platform", "runbooks/pagopa-reconciliation"], {}],
  ["decisions/adr-010-offline-validation-window", "en", 10, "ADR-010: 72-hour offline validation window", "2025-11-03",
    "Validators accept tickets offline for up to 72 hours and sync later; the ledger tolerates late events.",
    "Rural lines lose mobile coverage for hours; validators must keep accepting tickets, and the revocation list must bound the fraud exposure.",
    "Validators keep a signed revocation list refreshed every 15 minutes when online and an offline queue of up to 72 hours. Drained events carry delayed=true; fare caps are settled when they arrive.",
    "No denied boardings for coverage reasons; caps and inspections can be temporarily inconsistent, which the apps explain to the user.",
    ["services/validator-gateway", "contracts/ticket-validated-v2", "runbooks/validator-offline-queue-drain"], {}],
  ["decisions/adr-011-avro-schema-registry", "en", 11, "ADR-011: Avro with a schema registry for all Kafka topics", "2025-11-10",
    "Every topic has an Avro schema registered with BACKWARD compatibility by default.",
    "JSON events broke consumers twice in the first months (renamed field, changed type).",
    "Use Avro with the Confluent-compatible schema registry; compatibility BACKWARD by default, FULL for commands; producers register schemas in CI, never at runtime.",
    "Breaking changes become a new major topic (v1 to v2); the registry is a critical dependency with its own rollback runbook.",
    ["dependencies/confluent-schema-registry", "runbooks/schema-registry-rollback"], {}],
  ["decisions/adr-012-outbox-pattern", "en", 12, "ADR-012: Transactional outbox for events emitted from database transactions", "2025-11-24",
    "Services write events to an outbox table in the same transaction and a relay publishes them.",
    "payments-orchestrator lost PaymentAuthorized events when the process died between the commit and the Kafka produce.",
    "Every service that emits events as a consequence of a database write uses an outbox table and Debezium (or a polling relay) to publish; direct produce from the request path is forbidden for those events.",
    "At-least-once delivery with ordering per aggregate; consumers must be idempotent. Slight publication latency (under 500 ms).",
    ["services/payments-orchestrator", "contracts/payment-authorized-v1"], {}],
  ["decisions/adr-013-kong-api-gateway", "en", 13, "ADR-013: Kong as the API gateway", "2025-12-02",
    "Kong Gateway (OSS) on Kubernetes fronts all public and partner APIs.",
    "JWT validation, rate limiting and routing were duplicated in three BFFs.",
    "Deploy Kong Gateway 3.x with declarative configuration in Git; plugins limited to jwt, rate-limiting, request-transformer and prometheus.",
    "One place for edge policy; Kong upgrades and certificate management become platform responsibilities (see the certificate expiry incident).",
    ["services/api-gateway", "dependencies/kong-gateway"], {}],
  ["decisions/adr-014-emv-contactless-tokenization", "en", 14, "ADR-014: EMV contactless with token hashing, no PAN storage", "2026-01-12",
    "Tap-to-ride with bank cards stores only a salted hash of the EMV token.",
    "Tap-to-ride with contactless bank cards requires recognising the same card across validations without storing the PAN (PCI DSS).",
    "Validators compute an HMAC of the EMV token with a daily key; the ledger stores only the hash; the PSP maps the token to a payment at aggregation time.",
    "PCI scope stays at the validator firmware and the PSP; cap aggregation across days needs the key rotation schedule in the ledger.",
    ["services/validator-gateway", "contracts/ticket-validated-v2"], {}],
  ["decisions/adr-015-polyrepo-per-team", "en", 15, "ADR-015: One repository per team", "2026-02-10",
    "Supersedes ADR-007: each team owns its repositories; shared libraries are versioned packages.",
    "CI time and unclear ownership in the monorepo (ADR-007).",
    "Split the monorepo into one repository per team plus a platform-libraries repository publishing versioned packages; cross-team changes go through package versions.",
    "CI under 10 minutes; dependency upgrades need coordination (Renovate opens the PRs).",
    ["decisions/adr-007-monorepo"], { supersedes: "decisions/adr-007-monorepo" }],
  ["decisions/adr-016-feature-flags-unleash", "en", 16, "ADR-016 (draft): Unleash for feature flags and kill switches", "2026-06-18",
    "Draft: adopt Unleash self-hosted for flags, with a kill switch convention.",
    "Flags live in environment variables and config maps; turning a feature off needs a deployment.",
    "Adopt Unleash (self-hosted) with SDKs in every service; every risky feature ships with a kill switch flag named kill.<service>.<feature>.",
    "Runtime toggles without deployments; another stateful component to run. Not yet approved.",
    ["dependencies/unleash", "runbooks/feature-flag-kill-switch"], { status: "draft" }],
  ["decisions/adr-017-retire-legacy-sbe", "it", 17, "ADR-017: Dismissione del legacy SBE entro marzo 2027", "2026-03-20",
    "Il monolite SBE viene spento a marzo 2027; nessuna nuova funzione, solo patch di sicurezza del fornitore.",
    "Il monolite SBE (Java 8, Oracle 12c) costa 400 mila euro l'anno di manutenzione e licenze; tutte le funzioni tranne le tessere fisiche sono già migrate.",
    "Congelare il SBE: nessuna nuova funzionalità, patch di sicurezza applicate dal fornitore, spegnimento alla scadenza dell'ultimo abbonamento su tessera fisica (marzo 2027). Il ponte eventi v1 viene rimosso nello stesso momento.",
    "Risparmio dal 2027; i dati storici devono essere archiviati prima dello spegnimento (questione aperta).",
    ["services/legacy-sbe", "questions/q-010-legacy-sbe-data-archive"], {}],
  ["decisions/adr-018-nexi-primary-psp", "en", 18, "ADR-018: Nexi XPay as primary PSP with a warm fallback", "2026-04-08",
    "Nexi XPay handles card payments; a second PSP adapter is kept configured for failover.",
    "The previous PSP had two multi-hour outages in 2025 and no Italian acquiring for Bancomat Pay.",
    "Route all card payments to Nexi XPay; keep a second adapter deployed and tested monthly with a 1% traffic canary; switch by feature flag.",
    "Failover in minutes; two PSP contracts and two credential rotations to maintain.",
    ["services/payments-orchestrator", "dependencies/nexi-xpay", "runbooks/rotate-psp-credentials"], {}],
  ["decisions/adr-019-data-retention-validations", "it", 19, "ADR-019: Conservazione dei dati di validazione", "2026-04-22",
    "Validazioni grezze 24 mesi, aggregati 10 anni, posizioni veicoli 90 giorni.",
    "Il GDPR impone minimizzazione; la normativa fiscale e i contratti di servizio con la Regione richiedono aggregati per 10 anni; le contestazioni delle sanzioni arrivano fino a 18 mesi dopo.",
    "Validazioni grezze (con ticket_id) conservate 24 mesi nel ledger e nel warehouse, poi anonimizzate; aggregati per linea, zona e giorno conservati 10 anni; posizioni AVL 90 giorni in TimescaleDB e 24 mesi nel warehouse con TTL.",
    "Le cancellazioni account non toccano gli aggregati; le partizioni mensili del ledger si eliminano con un job, non a mano.",
    ["services/validation-ledger", "services/reporting-warehouse"], {}],
  ["decisions/adr-020-mqtt-for-validators", "en", 20, "ADR-020: MQTT with per-device certificates for validators and on-board units", "2025-10-20",
    "The validator fleet and the on-board units talk MQTT over TLS with mutual authentication.",
    "4,200 validators and 1,100 on-board units on mobile networks need a lightweight, resumable protocol with device identity.",
    "Mosquitto brokers (clustered) with MQTT 5, QoS 1, per-device X.509 certificates from the fleet CA; the gateway services subscribe and publish to Kafka.",
    "Low bandwidth and offline resume; the fleet CA and the broker certificate chain become critical (the January 2026 outage was an expired intermediate CA).",
    ["services/validator-gateway", "services/avl-collector", "dependencies/eclipse-mosquitto-mqtt"], {}],
  ["decisions/adr-021-argocd-gitops", "en", 21, "ADR-021 (draft): GitOps deployments with Argo CD", "2026-09-02",
    "Draft: every deployment is a Git commit reconciled by Argo CD; no kubectl apply from laptops.",
    "The refund worker deployment was deleted by a manual kubectl command in September 2026.",
    "Adopt Argo CD with one application per service and environment; manual changes to the cluster are reverted automatically; emergency changes go through a fast-track PR.",
    "Auditable deployments and drift correction; teams must learn the PR-based emergency path. Under review by the platform team.",
    ["dependencies/argocd", "incidents/inc-2026-022-refund-queue-stuck"], { status: "draft" }],
];
ADRS.forEach(([id, lang, number, title, date, description, context, decision, consequences, related, extra]) => {
  const x = extra || {};
  const it = lang === "it";
  const prov = provenance("adr");
  prov.sources = [SRC.adr(pad(number, 3))];
  if (x.status) prov.status = x.status;
  if (x.stale) prov.stale_after = x.stale;
  if (x.status === "draft") { delete prov.verified; delete prov.stale_after; }
  const relations = related.map((r) => rel("related_to", r)).concat(x.supersedes ? [rel("supersedes", x.supersedes)] : []);
  const statusLabel = x.status === "deprecated" ? (it ? "superata" : "superseded") : x.status === "draft" ? (it ? "bozza" : "proposed") : (it ? "accettata" : "accepted");
  cat({
    id, type: "Decision", lang, title, description,
    tags: ["adr", "decision", `adr-${pad(number, 3)}`, ...(it ? ["decisione"] : [])],
    aliases: [`ADR-${pad(number, 3)}`],
    decided_on: date, ...prov, relations,
    body: `# ${title}\n\n**${it ? "Stato" : "Status"}:** ${statusLabel} · **${it ? "Data" : "Date"}:** ${date}\n\n## ${it ? "Contesto" : "Context"}\n${context}\n\n## ${it ? "Decisione" : "Decision"}\n${decision}\n\n## ${it ? "Conseguenze" : "Consequences"}\n${consequences}\n\n## ${it ? "Collegamenti" : "Related"}\n${related.map((r) => `- ${mdlink(r.split("/")[1], r)}`).join("\n")}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Incidents (16)
// ---------------------------------------------------------------------------------------------
// [id, lang, key, title, severity, date, services, description, impact, timeline, rootCause, resolution, followUps, extra]
const INCIDENTS = [
  ["incidents/inc-2026-001-validator-outage-bologna", "it", "INC-2026-001", "INC-2026-001: Validatori offline su tutta la rete urbana di Bologna", "SEV1", "2026-01-14",
    ["services/validator-gateway"], "Il 14 gennaio 2026 i 1.800 validatori urbani di Bologna hanno perso la connessione MQTT per 3 ore e 40 minuti.",
    "Nessuna validazione registrata in tempo reale per 3 ore e 40 minuti su 1.800 validatori; i viaggiatori hanno continuato a salire (coda offline), ma i controllori non vedevano le validazioni e le soglie giornaliere sono state applicate in ritardo. Circa 95.000 validazioni consegnate in ritardo.",
    "06:12 primi allarmi di sessioni MQTT in calo · 06:30 pagina al reperibile piattaforma · 07:05 identificata la catena di certificati del broker · 08:40 nuovo certificato intermedio distribuito · 09:52 ultimi validatori riconnessi e code svuotate.",
    "Il certificato intermedio della CA di flotta usato dal broker Mosquitto era scaduto alla mezzanotte; i validatori rifiutavano la catena del broker. Il monitoraggio controllava solo il certificato foglia.",
    "Emesso e distribuito un nuovo certificato intermedio; drenaggio delle code offline in ordine con il runbook dedicato; verifica delle soglie giornaliere ricalcolate.",
    "Monitorare la scadenza di tutta la catena (fatto); inventario dei certificati con scadenza entro 60 giorni nel runbook di rinnovo (fatto); prova di rinnovo semestrale.",
    { postmortem: "postmortems/pm-2026-001-validator-outage", runbooks: ["runbooks/certificate-renewal", "runbooks/validator-offline-queue-drain"] }],
  ["incidents/inc-2026-004-wallet-double-charge", "en", "INC-2026-004", "INC-2026-004: Duplicate wallet debits after a Kafka rebalance", "SEV2", "2026-02-19",
    ["services/wallet-service"], "2,340 wallets were debited twice for the same journey after a consumer-group rebalance replayed commands.",
    "2,340 customers saw two debits for one journey (average 1.50 euro); 410 balances went negative and blocked further travel until the reversal. No card payments were affected.",
    "14:02 deployment of wallet-service triggers a consumer rebalance · 14:03-14:09 commands from the uncommitted offset window are reprocessed · 14:25 customer support reports double debits · 14:40 incident opened · 15:30 automatic reversal script prepared · 16:10 all duplicates reversed.",
    "The debit command handler was not idempotent: a replayed WalletTopUp/Debit command with the same payment id produced a second event. At-least-once delivery plus a non-idempotent handler.",
    "Reversal events issued for every duplicate; command handler made idempotent on the payment id; consumer offsets committed after the event store write.",
    "Idempotency keys mandatory on every command handler (done); chaos test that kills a consumer mid-batch (done); reconciliation report compares debits with FareComputed daily.",
    { postmortem: "postmortems/pm-2026-004-wallet-double-charge", runbooks: ["runbooks/wallet-balance-reconciliation"] }],
  ["incidents/inc-2026-007-pagopa-timeout", "it", "INC-2026-007", "INC-2026-007: Timeout del nodo pagoPA e ricevute non riconciliate", "SEV2", "2026-03-11",
    ["services/pagopa-adapter"], "Per 14 ore il nodo pagoPA ha risposto in timeout alle richieste di stato; 1.900 ricevute telematiche sono rimaste non riconciliate.",
    "1.900 avvisi pagati risultavano non pagati nel portale e nelle app; 60 abbonamenti aziendali non attivati fino al giorno dopo; 12 sanzioni sollecitate per errore.",
    "09:30 aumento dei timeout verso il nodo · 10:15 ticket aperto con l'assistenza pagoPA · 13:00 confermato degrado lato nodo · 23:40 nodo ripristinato · 03:30 (giorno dopo) riconciliazione manuale completata.",
    "Degrado del nodo dei pagamenti (lato pagoPA). Lato nostro, la riconciliazione dipendeva solo dalle RT push: senza un job di polling dello stato degli avvisi, il ritardo del nodo è diventato un ritardo nostro.",
    "Riconciliazione manuale con il runbook; aggiunto il job di polling dello stato degli avvisi ogni 30 minuti per quelli in attesa da più di 2 ore; solleciti sospesi fino alla riconciliazione.",
    "Job di polling (fatto); allarme sulle RT in attesa da più di 4 ore (fatto); testo chiaro nelle app 'pagamento in verifica' (in corso).",
    { postmortem: "postmortems/pm-2026-007-pagopa-timeout", runbooks: ["runbooks/pagopa-reconciliation"] }],
  ["incidents/inc-2026-009-gtfs-import-failure", "en", "INC-2026-009", "INC-2026-009: GTFS release rejected for 9 days, planner on stale timetable", "SEV3", "2026-03-24",
    ["services/gtfs-ingest", "services/trip-planner"], "An operator shipped a GTFS with duplicated trip ids; the merge was rejected daily and the planner served the previous timetable for 9 days, missing a schedule change.",
    "Journey plans on 14 suburban lines showed the old schedule for 9 days after the operator changed it; about 2% of planner searches gave wrong departure times.",
    "Day 1 nightly merge rejected, notification to the operator · Day 4 operator reports they had fixed it (they had not) · Day 8 customer complaints correlated · Day 9 manual import with the duplicate trips renamed.",
    "The validator correctly rejected the feed, but rejection notifications went to a mailbox nobody read, and the planner had no signal that its timetable was older than the operator's published change.",
    "Manual import with a per-operator override (now the manual import runbook); rejection alerts routed to the mobility on-call channel; planner shows a staleness banner when the active release is older than 7 days.",
    "Staleness SLO on GTFS ingest (done); operator-facing validation report (done); feed quality by vendor tracked in an open question.",
    { runbooks: ["runbooks/gtfs-manual-import"] }],
  ["incidents/inc-2026-011-kafka-partition-lag", "en", "INC-2026-011", "INC-2026-011: Consumer lag of 6 hours on validations after broker disk pressure", "SEV2", "2026-04-02",
    ["services/validation-ledger", "services/reporting-warehouse"], "One Kafka broker hit disk pressure and throttled; the ledger consumer fell 6 hours behind, delaying inspections and caps.",
    "Inspectors saw 'not validated' for tickets validated up to 6 hours earlier (about 900 disputed checks); daily caps settled late; warehouse dashboards stale for the morning.",
    "05:40 broker-2 disk at 92%, throttling · 07:10 ledger lag alert fires at 30 minutes · 07:30 incident opened · 08:15 old segments of the positions topic deleted, retention corrected · 11:50 lag recovered.",
    "The mobility.positions.v1 topic had retention set to 30 days instead of 3 by a configuration drift; the broker ran out of disk headroom and throttled all partitions on that broker.",
    "Retention fixed to 3 days and enforced from Git; inspector backend falls back to a 'validated recently, syncing' answer when lag is over 10 minutes.",
    "Topic configuration in Git with drift detection (done); disk alert at 75% (done); lag SLO for the ledger consumer (done).",
    { postmortem: "postmortems/pm-2026-011-kafka-lag", runbooks: ["runbooks/replay-kafka-topic"] }],
  ["incidents/inc-2026-013-spid-login-down", "it", "INC-2026-013", "INC-2026-013: Login SPID non funzionante per 2 ore", "SEV2", "2026-04-15",
    ["services/identity-service"], "Il login con SPID ha fallito per 2 ore e 10 minuti a causa dei metadati degli identity provider non aggiornati.",
    "Nessun acquisto di abbonamento con agevolazione e nessuna registrazione via SPID per 2 ore e 10 minuti; circa 3.200 tentativi falliti. Il login con password e CIE funzionava.",
    "10:20 picco di errori 'firma non valida' sulle asserzioni SAML · 10:35 pagina al reperibile identità · 11:00 identificata la rotazione dei metadati di due IdP · 11:45 metadati ricaricati manualmente · 12:30 chiusura dopo verifica su tutti gli IdP.",
    "Due identity provider SPID hanno ruotato i certificati di firma nei metadati; Keycloak li ricaricava solo ogni 24 ore e rifiutava le asserzioni firmate con il nuovo certificato.",
    "Ricarica manuale dei metadati; frequenza di aggiornamento portata a un'ora; allarme sugli errori di firma SAML.",
    "Aggiornamento orario dei metadati (fatto); test sintetico di login SPID ogni 5 minuti (fatto); valutare il login CIE da mobile come alternativa (questione aperta).",
    { postmortem: "postmortems/pm-2026-013-spid-login", runbooks: ["runbooks/keycloak-realm-restore"] }],
  ["incidents/inc-2026-015-fare-cap-miscalculation", "en", "INC-2026-015", "INC-2026-015: Daily cap applied across the wrong day boundary", "SEV2", "2026-05-06",
    ["services/fare-engine"], "For 11 days journeys between 00:00 and 02:00 local time were capped with the previous day; 18,000 customers were undercharged or overcharged by up to 3 euro.",
    "18,000 affected accounts over 11 days; net effect 9,400 euro undercharged and 2,100 euro overcharged (refunded as wallet credit).",
    "Day 1 fare table v41 activated with the new night fares · Day 6 operator notices lower night revenue · Day 10 analysis in the warehouse finds the midnight pattern · Day 11 hotfix activated as fare table v42.",
    "The cap window was computed in UTC after a library upgrade changed the default time zone handling; Europe/Rome midnight fell at 22:00 or 23:00 UTC, so night journeys joined the previous day's cap.",
    "Fare table v42 with explicit Europe/Rome zone in the cap computation; recomputation of 11 days of caps from FareComputed events; wallet credits for overcharges.",
    "Time-zone regression test around DST changes (done); fare table activation requires a shadow run on the previous day's validations (done).",
    { postmortem: "postmortems/pm-2026-015-fare-cap", runbooks: ["runbooks/fare-table-hotfix"] }],
  ["incidents/inc-2026-016-push-notification-storm", "en", "INC-2026-016", "INC-2026-016: 1.2 million duplicate push notifications", "SEV2", "2026-05-19",
    ["services/notification-hub"], "A campaign producer retried a batch without idempotency keys; 1.2 million duplicate pushes were sent in 25 minutes.",
    "About 400,000 users received 3 identical marketing pushes; 8,000 uninstalls over the following two days; FCM quota warnings.",
    "18:00 campaign batch sent · 18:03 producer timeout, retries the whole batch twice · 18:10 delivery rate alert · 18:20 producer stopped · 18:25 queue drained.",
    "NotificationRequest had an optional request_id; the campaign producer did not set it, so retries were new requests. The per-user rate limit was 10 per hour, too loose for marketing.",
    "Producer stopped and fixed; request_id made mandatory in the schema (FULL compatibility, new required field with a default rejected at the gateway); marketing limited to 1 per user per day.",
    "Mandatory idempotency key (done); separate rate limits per category (done); campaign tooling dry run on 1% (done).",
    { runbooks: ["runbooks/notification-rate-limit"] }],
  ["incidents/inc-2026-018-clickhouse-disk-full", "en", "INC-2026-018", "INC-2026-018: ClickHouse shard disk full, operator dashboards down", "SEV3", "2026-06-09",
    ["services/reporting-warehouse"], "The raw AVL positions table had no TTL and filled one shard; ingestion stopped and the operator dashboards were down for 5 hours.",
    "Operator dashboards and the daily settlement export unavailable for 5 hours; no data loss (Kafka retention covered the gap).",
    "02:10 shard-1 disk 100%, inserts fail · 06:00 data on-call starts (business hours rota) · 07:30 raw positions table identified · 08:00 TTL 24 months applied and old parts dropped · 09:15 ingestion caught up.",
    "The raw table for VehiclePosition events was created without a TTL clause; 9 million rows a day for 8 months filled the shard. Disk alerts went to a channel without paging.",
    "TTL applied; parts older than 24 months dropped; disk alert routed to paging at 80%.",
    "dbt macro that fails CI when a raw model has no TTL (done); data team paging rota for SEV2+ outside business hours (open question on on-call).",
    { runbooks: ["runbooks/clickhouse-disk-cleanup"] }],
  ["incidents/inc-2026-020-api-gateway-cert-expiry", "en", "INC-2026-020", "INC-2026-020: Partner API certificate expired", "SEV3", "2026-06-30",
    ["services/api-gateway"], "The TLS certificate of partners.tessera.it expired; partner integrations (travel agencies, corporate portals) failed for 4 hours.",
    "All partner API calls failed TLS validation for 4 hours; 3 corporate subscription portals and 2 travel agencies affected; no citizen impact.",
    "00:00 certificate expires · 08:05 partner reports failures · 08:20 incident opened · 09:10 hostname found outside cert-manager · 11:55 certificate issued and rotated.",
    "partners.tessera.it was configured manually before cert-manager was adopted and never migrated; the expiry inventory covered only cert-manager resources.",
    "Hostname migrated to cert-manager; inventory extended to every public hostname in DNS.",
    "Weekly job comparing DNS records with managed certificates (done); expiry alert at 21 days (done).",
    { postmortem: "postmortems/pm-2026-020-cert-expiry", runbooks: ["runbooks/certificate-renewal"] }],
  ["incidents/inc-2026-022-refund-queue-stuck", "en", "INC-2026-022", "INC-2026-022: Refund approvals stuck for 6 days", "SEV3", "2026-09-04",
    ["services/refund-service"], "A manual kubectl command deleted the refund approval worker deployment; 1,150 refunds waited 6 days in the approval queue.",
    "1,150 refund requests over 50 euro not processed for 6 days; 240 customer complaints; SLO on refund turnaround breached for the month.",
    "Day 0 worker deployment deleted during a manual cleanup · Day 2 first complaints, attributed to volume · Day 5 Temporal task queue backlog noticed · Day 6 deployment restored, backlog drained in 2 hours.",
    "No drift detection for Kubernetes resources: the deletion was not reverted and no alert fired because the workflow metrics counted 'pending' as healthy.",
    "Deployment restored from Git; alert on Temporal task queue age over 1 hour; approval queue age added to the refund SLO.",
    "GitOps with automatic drift correction (ADR-021 draft); unstick runbook written.",
    { runbooks: ["runbooks/refund-queue-unstick"] }],
  ["incidents/inc-2026-023-avl-feed-stale", "en", "INC-2026-023", "INC-2026-023: Vehicle positions frozen for 50 minutes", "SEV3", "2026-08-12",
    ["services/avl-collector", "services/realtime-predictions"], "The AVL consumer group got stuck after a broker restart; positions in the apps and the operator portal froze for 50 minutes.",
    "Live map and arrival predictions frozen for 50 minutes across the region; predictions fell back to schedule.",
    "15:20 broker rolling restart · 15:22 avl-collector consumer stops committing · 15:35 stale position alert · 15:50 on-call restarts the consumer group · 16:10 positions current again.",
    "A known client library bug left the consumer in a zombie state after the group coordinator moved; the collector reported healthy because its HTTP probe did not check consumption progress.",
    "Consumer restarted; readiness probe now fails when no message is consumed for 60 seconds while partitions are assigned; client library upgraded.",
    "Restart runbook written; library upgrade across services tracked by Renovate.",
    { runbooks: ["runbooks/avl-feed-restart"] }],
  ["incidents/inc-2026-025-inspector-app-sync", "it", "INC-2026-025", "INC-2026-025: Esiti di verifica duplicati dopo la sincronizzazione offline", "SEV3", "2026-09-16",
    ["services/inspector-app-backend"], "300 esiti di verifica sono stati registrati due volte quando le app dei controllori hanno sincronizzato dopo una giornata offline.",
    "300 esiti duplicati, 41 sanzioni duplicate inviate a pagoPA e annullate il giorno dopo; nessun impatto sui viaggiatori oltre alla notifica doppia.",
    "08:00 sciopero della rete mobile in Appennino, app offline · 17:30 rientro in copertura, sincronizzazione · 18:10 pagopa-adapter segnala avvisi duplicati · 19:00 duplicati identificati e annullati.",
    "La sincronizzazione ritentava il batch intero al primo errore di rete; la chiave di idempotenza era l'id generato dal server, non quello del dispositivo.",
    "Chiave di idempotenza (dispositivo, sequenza) come per i validatori; annullamento degli avvisi duplicati.",
    "Test di sincronizzazione con rete instabile (fatto); allarme su sanzioni duplicate in pagopa-adapter (fatto).",
    { runbooks: [] }],
  ["incidents/inc-2026-027-subscription-renewal-duplicate", "en", "INC-2026-027", "INC-2026-027: 620 subscriptions renewed and charged twice", "SEV2", "2026-09-28",
    ["services/subscription-manager"], "After a PostgreSQL failover two scheduler replicas both believed they held the renewal lock; 620 passes were renewed and charged twice.",
    "620 customers charged twice for their monthly pass (29 to 45 euro); refunds within 3 days; 90 complaints.",
    "03:00 managed failover of the subscription database · 03:01 advisory lock lost, both replicas acquire it on reconnect · 03:05-03:20 renewal batch runs twice · 08:30 finance notices doubled revenue · 09:00 incident opened · 14:00 refunds queued.",
    "The leader election used a PostgreSQL advisory lock without a fencing token; after failover both replicas reconnected and each obtained the lock on different connections before the batch finished.",
    "Refunds through refund-service; scheduler switched to a lease with a fencing token stored with each renewal; downstream consumers de-duplicate on (subscription_id, period_start).",
    "Fencing tokens for every scheduler (done); failover game day for team biglietti (planned).",
    { runbooks: ["runbooks/postgres-failover"] }],
  ["incidents/inc-2026-029-storefront-ddos", "en", "INC-2026-029", "INC-2026-029: DDoS on the web storefront planner", "SEV1", "2026-10-07",
    ["services/web-storefront", "services/api-gateway"], "A layer-7 DDoS of 40,000 requests per second on planner searches saturated the SSR pods; the storefront was unavailable for 55 minutes.",
    "Web storefront unavailable for 55 minutes during the morning peak; apps unaffected; 1,200 lost web purchases estimated.",
    "07:40 traffic spike on /v1/planner/plan through the storefront · 07:45 SSR pods at CPU limit, 502s · 07:50 incident opened, SEV1 · 08:10 WAF challenge enabled on the planner path · 08:20 planner moved to client-side fetch · 08:35 storefront healthy.",
    "Planner results were rendered server-side per request with no cache and no challenge; the attack targeted the most expensive path. Rate limits applied per IP, and the attack used 30,000 IPs.",
    "WAF managed challenge on planner requests from the storefront; client-side fetching; autoscaling ceiling raised.",
    "Cost of SSR per route reviewed (open question); challenge kept for anonymous planner traffic; runbook for DDoS triage in the on-call escalation document.",
    { postmortem: "postmortems/pm-2026-029-storefront-ddos", runbooks: ["runbooks/on-call-escalation"] }],
  ["incidents/inc-2025-041-legacy-sbe-crash", "it", "INC-2025-041", "INC-2025-041 (storico): Crash del legacy SBE per tablespace Oracle pieno", "SEV2", "2025-11-18",
    ["services/legacy-sbe"], "Incidente storico: il monolite SBE si è fermato per 5 ore perché il tablespace Oracle delle validazioni era pieno.",
    "Emissione su tessera fisica e rendicontazione del SBE ferme per 5 ore; nessun impatto sui nuovi servizi.",
    "11:00 errori ORA-01653 · 11:30 fornitore contattato · 14:00 tablespace esteso dal fornitore · 16:00 riavvio e verifica.",
    "Crescita del tablespace non monitorata; il fornitore non aveva allarmi configurati.",
    "Tablespace esteso dal fornitore; monitoraggio aggiunto dal fornitore.",
    "Nessuna azione lato nostro: il sistema è in dismissione (ADR-017). Questo incidente è conservato come storico.",
    { stale: "2026-05-31", runbooks: ["runbooks/legacy-sbe-restart"] }],
];
INCIDENTS.forEach(([id, lang, key, title, severity, date, services, description, impact, timeline, rootCause, resolution, followUps, extra]) => {
  const x = extra || {};
  const it = lang === "it";
  const prov = provenance("incident");
  prov.sources = [SRC.tracker(key)];
  if (x.stale) prov.stale_after = x.stale;
  const relations = services.map((s) => rel("affects", s))
    .concat((x.runbooks || []).map((r) => rel("resolved_by", r)))
    .concat(x.postmortem ? [rel("documented_in", x.postmortem)] : []);
  cat({
    id, type: "Incident", lang, title, description,
    tags: ["incident", severity.toLowerCase(), ...services.map((s) => s.split("/")[1]), ...(it ? ["incidente"] : [])],
    aliases: [key],
    severity, occurred_on: date, ...prov, relations,
    body: `# ${title}\n\n**${it ? "Gravità" : "Severity"}:** ${severity} · **${it ? "Data" : "Date"}:** ${date} · **${it ? "Servizi" : "Services"}:** ${services.map((s) => mdlink(s.split("/")[1], s)).join(", ")}\n\n## ${it ? "Impatto" : "Impact"}\n${impact}\n\n## Timeline\n${timeline}\n\n## ${it ? "Causa radice" : "Root cause"}\n${rootCause}\n\n## ${it ? "Risoluzione" : "Resolution"}\n${resolution}\n\n## ${it ? "Azioni successive" : "Follow-ups"}\n${followUps}${x.postmortem ? `\n\n${it ? "Post-mortem" : "Post-mortem"}: ${mdlink(x.postmortem.split("/")[1], x.postmortem)}` : ""}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Post-mortems (8)
// ---------------------------------------------------------------------------------------------
// [id, lang, title, incident, description, summary, factors, wentWell, actions, lessons]
const POSTMORTEMS = [
  ["postmortems/pm-2026-001-validator-outage", "it", "Post-mortem INC-2026-001: certificato intermedio scaduto sul broker MQTT", "incidents/inc-2026-001-validator-outage-bologna",
    "Analisi dell'interruzione dei validatori di Bologna: catena di certificati non monitorata.",
    "Un certificato intermedio della CA di flotta è scaduto a mezzanotte; i validatori hanno rifiutato il broker per 3 ore e 40 minuti. Il monitoraggio controllava solo il certificato foglia del broker.",
    "- La CA di flotta era stata creata nel 2023 con un intermedio a 3 anni e nessun promemoria.\n- Il controllo di scadenza usava `openssl s_client` sul solo certificato foglia.\n- Il runbook di rinnovo descriveva solo i certificati pubblici gestiti da cert-manager.",
    "La coda offline dei validatori (ADR-010) ha evitato rifiuti di salita; il drenaggio ordinato ha funzionato al primo tentativo.",
    "1. Monitorare la scadenza dell'intera catena per ogni endpoint TLS (fatto, team piattaforma).\n2. Inventario di tutti i certificati con scadenza entro 60 giorni nel runbook di rinnovo (fatto).\n3. Esercitazione semestrale di rotazione della CA di flotta (prima: 2026-07).",
    "Tutto ciò che scade va inventariato, non solo ciò che è automatizzato."],
  ["postmortems/pm-2026-004-wallet-double-charge", "en", "Post-mortem INC-2026-004: non-idempotent wallet command handler", "incidents/inc-2026-004-wallet-double-charge",
    "Why a consumer rebalance produced 2,340 duplicate debits and what changed.",
    "A deployment caused a Kafka consumer-group rebalance; commands between the last committed offset and the rebalance were reprocessed and the debit handler, which keyed nothing on the payment id, emitted a second debit event per command.",
    "- Idempotency was assumed from exactly-once semantics that Kafka does not provide across a database write.\n- Offsets were committed before the event store write.\n- The reconciliation that would have caught it ran weekly.",
    "The event-sourced model made the reversal exact: every duplicate event could be identified and reversed with its original amount within two hours.",
    "1. Idempotency key on every command handler, enforced by a shared library (done).\n2. Commit offsets after the event store write (done).\n3. Daily reconciliation of debits against FareComputed (done).\n4. Chaos test killing a consumer mid-batch in CI (done).",
    "At-least-once delivery is the contract; idempotency is the consumer's job, every time."],
  ["postmortems/pm-2026-007-pagopa-timeout", "it", "Post-mortem INC-2026-007: dipendenza dalle sole ricevute push di pagoPA", "incidents/inc-2026-007-pagopa-timeout",
    "Perché un degrado del nodo pagoPA è diventato 14 ore di avvisi 'non pagati'.",
    "Il nodo pagoPA ha risposto in timeout per 14 ore. La riconciliazione dipendeva solo dalle ricevute telematiche inviate dal nodo: senza polling dello stato degli avvisi, il ritardo del nodo è diventato il nostro.",
    "- Nessun job di polling dello stato degli avvisi in attesa.\n- I solleciti per le sanzioni partivano in automatico dopo 48 ore senza verificare lo stato al nodo.\n- La procedura manuale di riconciliazione esisteva solo nella memoria di una persona.",
    "L'assistenza pagoPA ha confermato il degrado in 3 ore; il team ha sospeso i solleciti prima che partissero in massa.",
    "1. Job di polling ogni 30 minuti per gli avvisi in attesa da più di 2 ore (fatto).\n2. Runbook di riconciliazione manuale scritto e provato (fatto).\n3. Solleciti bloccati finché lo stato non è confermato dal nodo (fatto).",
    "Ogni integrazione push ha bisogno di un percorso pull per la riconciliazione."],
  ["postmortems/pm-2026-011-kafka-lag", "en", "Post-mortem INC-2026-011: topic retention drift filled a broker", "incidents/inc-2026-011-kafka-partition-lag",
    "A retention setting changed by hand caused disk pressure and 6 hours of consumer lag.",
    "The positions topic retention had been raised to 30 days during a debugging session in February and never reverted. By April the broker holding its largest partitions ran out of headroom, throttled, and the ledger consumer fell 6 hours behind.",
    "- Topic configuration was not under version control.\n- Disk alerts fired at 90%, too late for a broker that fills 1% per hour.\n- The inspector backend treated 'not found in ledger' as 'not validated'.",
    "The ledger consumer recovered on its own once segments were deleted; no data was lost; the replay runbook was not needed but was ready.",
    "1. Topic configuration declared in Git with drift detection every 15 minutes (done).\n2. Disk alert at 75% with paging (done).\n3. Inspector backend answers 'validated recently, syncing' when consumer lag exceeds 10 minutes (done).\n4. Consumer lag SLO for the ledger (done).",
    "Configuration that is not in Git does not exist; it only hurts."],
  ["postmortems/pm-2026-013-spid-login", "en", "Post-mortem INC-2026-013: SPID identity provider metadata rotation", "incidents/inc-2026-013-spid-login-down",
    "Two SPID identity providers rotated signing certificates; our daily metadata refresh missed it.",
    "SPID identity providers may rotate signing certificates at any time by publishing new metadata. Keycloak refreshed the federation metadata every 24 hours, so assertions signed with the new certificates were rejected for 2 hours and 10 minutes until a manual reload.",
    "- Refresh interval chosen by default, not by the AgID guidance.\n- No synthetic login test; the first signal was customer complaints.\n- The error 'invalid signature' was logged at INFO level.",
    "The identity on-call recognised the pattern within 25 minutes thanks to a previous near miss documented in the runbook.",
    "1. Metadata refresh every hour and on signature failure (done).\n2. Synthetic SPID login every 5 minutes with a test identity (done).\n3. Signature failures logged at ERROR and alerted (done).",
    "External identity federations change under you; test the login, not the configuration."],
  ["postmortems/pm-2026-015-fare-cap", "en", "Post-mortem INC-2026-015: cap window computed in UTC", "incidents/inc-2026-015-fare-cap-miscalculation",
    "A library upgrade changed time-zone defaults; 11 days of night journeys joined the wrong daily cap.",
    "The fare cap window was computed from timestamps truncated to the day in UTC after an upgrade of the date-time library. Europe/Rome midnight is 22:00 or 23:00 UTC, so journeys between 00:00 and 02:00 local time were capped with the previous day.",
    "- No regression test around midnight or DST changes.\n- Fare table activation had no shadow run against real validations.\n- Revenue anomalies were visible in the warehouse from day 2 but nobody looked at night revenue specifically.",
    "FareComputed events carried the fare table version, so recomputing 11 days of caps was a batch job, not a forensic exercise.",
    "1. Time-zone regression suite around midnight and DST (done).\n2. Shadow run of a new fare table on the previous day before activation (done, part of the hotfix runbook).\n3. Night revenue anomaly alert in the warehouse (done).",
    "Explicit time zones everywhere money is computed; defaults are a dependency you do not control."],
  ["postmortems/pm-2026-020-cert-expiry", "en", "Post-mortem INC-2026-020: hostname outside the certificate inventory", "incidents/inc-2026-020-api-gateway-cert-expiry",
    "The partner hostname predated cert-manager and was never migrated; the expiry inventory did not cover it.",
    "partners.tessera.it had a manually issued certificate from 2025. When cert-manager was adopted the migration list was built from Kubernetes resources, so a hostname served through a static Kong route was missed. It expired on 30 June and partners failed TLS validation for 4 hours.",
    "- Inventory built from the automation's own view, not from DNS.\n- Partner traffic has no synthetic check.\n- The on-call runbook for certificates assumed cert-manager.",
    "The platform on-call rotated the certificate in under 3 hours once found; partners had retry logic and recovered without manual action.",
    "1. Weekly job comparing every DNS record with managed certificates (done).\n2. Synthetic TLS check per public hostname, alert at 21 days (done).\n3. Runbook updated for non-managed hostnames (done).",
    "Inventories must come from outside the system that is supposed to be complete."],
  ["postmortems/pm-2026-029-storefront-ddos", "en", "Post-mortem INC-2026-029: layer-7 DDoS on server-rendered planner searches", "incidents/inc-2026-029-storefront-ddos",
    "The storefront rendered planner results server-side per request; the attack targeted that path.",
    "40,000 requests per second from about 30,000 IP addresses hit the storefront planner page. Each request triggered a server-side planner call and a full render; SSR pods saturated within 5 minutes and the storefront returned 502 for 55 minutes.",
    "- Most expensive path exposed without a challenge or cache.\n- Rate limiting per IP is ineffective against a distributed attack.\n- Autoscaling ceiling was sized for organic peaks only.",
    "The API gateway kept the apps healthy because the attack came through the storefront origin; the WAF challenge was enabled in 20 minutes with a prepared rule.",
    "1. Managed challenge on anonymous planner traffic from the web (done).\n2. Planner results fetched client-side with caching (done).\n3. SSR cost review per route (open question).\n4. DDoS triage added to the on-call escalation runbook (done).",
    "Cost asymmetry is the attack surface: never let an anonymous request cost more than a cache lookup."],
];
POSTMORTEMS.forEach(([id, lang, title, incident, description, summary, factors, wentWell, actions, lessons]) => {
  const it = lang === "it";
  const prov = provenance("postmortem");
  prov.sources = [SRC.tracker(incident.split("/")[1].split("-").slice(0, 3).join("-").toUpperCase()), SRC.wiki(`postmortems/${id.split("/")[1]}`)];
  cat({
    id, type: "Post-mortem", lang, title, description,
    tags: ["post-mortem", "postmortem", "incident-review", ...(it ? ["analisi"] : [])],
    ...prov, relations: [rel("documents", incident)],
    body: `# ${title}\n\n${it ? "Incidente" : "Incident"}: ${mdlink(incident.split("/")[1], incident)}\n\n## ${it ? "Sintesi" : "Summary"}\n${summary}\n\n## ${it ? "Fattori concorrenti" : "Contributing factors"}\n${factors}\n\n## ${it ? "Cosa ha funzionato" : "What went well"}\n${wentWell}\n\n## ${it ? "Azioni" : "Action items"}\n${actions}\n\n## ${it ? "Lezione" : "Lessons"}\n${lessons}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Runbooks (20)
// ---------------------------------------------------------------------------------------------
// [id, lang, title, services, description, when, prerequisites, steps, rollback, escalation, extra]
const RUNBOOKS = [
  ["runbooks/replay-kafka-topic", "en", "Replay a Kafka topic into a consumer", ["services/validation-ledger", "services/reporting-warehouse"],
    "Reset a consumer group to an offset or timestamp and replay events safely.",
    "A consumer lost or corrupted its state (ledger partition rebuilt, warehouse table dropped) or a bug skipped events. Not for lag: lag recovers alone.",
    "Consumer is idempotent on its key (ledger: device_id + sequence; warehouse: ReplacingMergeTree). Change window approved by the owning team. kafka-consumer-groups access from the ops bastion.",
    "1. Stop every instance of the consumer (scale the deployment to 0).\n2. `kafka-consumer-groups --group <group> --topic <topic> --reset-offsets --to-datetime <ISO> --execute`.\n3. Scale the consumer back to 1 replica, watch lag and error rate for 10 minutes.\n4. Scale to the normal replica count.\n5. Record the replay window in the incident or change ticket.",
    "Reset offsets back to the saved values printed by `--dry-run` in step 2; if duplicates were produced downstream, run the consumer's reconciliation job.",
    "Platform on-call for broker issues; owning team for data correctness. Replays over 24 hours need the data lead's approval.", {}],
  ["runbooks/rotate-psp-credentials", "en", "Rotate PSP credentials (Nexi XPay and fallback)", ["services/payments-orchestrator"],
    "Quarterly rotation of API keys and webhook secrets for both PSP adapters without dropping payments.",
    "Quarterly schedule (first week of January, April, July, October) or immediately after a suspected leak.",
    "Access to the PSP merchant back office, the secrets manager and the payments deployment pipeline. Two people from team pagamenti (four-eyes).",
    "1. Generate the new key in the PSP back office; keep the old key active.\n2. Store the new key in the secrets manager under the next version.\n3. Deploy payments-orchestrator with both keys: new for outbound calls, old and new accepted for webhook signatures.\n4. Verify a 1 euro authorization and refund in production.\n5. After 24 hours revoke the old key at the PSP and remove it from the manager.",
    "Point the outbound key back to the previous secret version and redeploy; webhooks keep working because both signatures are accepted during the window.",
    "Payments on-call; PSP support line in the vendor concept. A failed step 4 is a SEV2 if authorization success drops below the SLO.", {}],
  ["runbooks/postgres-failover", "en", "PostgreSQL failover and post-failover checks", ["services/wallet-service", "services/subscription-manager", "services/validation-ledger"],
    "Promote the synchronous replica of a managed PostgreSQL instance and verify the services that hold leases or locks.",
    "Primary unresponsive for more than 2 minutes, planned maintenance of the primary, or availability-zone loss.",
    "Managed database console access; the service owner informed; replica lag 0 (synchronous).",
    "1. Trigger the managed failover (console or `aws rds reboot-db-instance --force-failover`).\n2. Wait for the DNS endpoint to point to the new primary (under 60 seconds).\n3. Restart services that hold advisory locks or leases (subscription-manager scheduler) so that fencing tokens are renewed.\n4. Check connection pool errors drop to zero and replication resumes to the new replica.\n5. For event-sourced services, verify the projection catches up (wallet read model lag under 1 second).",
    "Managed failover is not reversible as such; fail back with the same procedure once the old primary is healthy and in sync.",
    "Platform on-call; owning team for step 3 and 5. A duplicate-processing symptom after failover is a SEV2 (see INC-2026-027).", {}],
  ["runbooks/validator-offline-queue-drain", "it", "Drenaggio ordinato delle code offline dei validatori", ["services/validator-gateway"],
    "Dopo un'interruzione di rete o del broker, far rientrare le validazioni accodate nei validatori senza saturare il gateway.",
    "Più di 200 validatori riconnessi insieme con code offline (dopo un'interruzione MQTT, un guasto del broker o una scadenza di certificati).",
    "Accesso al pannello di flotta e alle metriche del gateway; broker sano; certificati verificati con il runbook di rinnovo.",
    "1. Portare il gateway a 6 repliche con il runbook di scalatura.\n2. Dal pannello di flotta abilitare il rientro per gruppi di 300 dispositivi ogni 5 minuti (linee urbane prima, extraurbane dopo).\n3. Controllare che gli eventi arrivino con `delayed=true` e con la sequenza in ordine per dispositivo.\n4. Quando la coda media per dispositivo è sotto 10 eventi, abilitare tutti i dispositivi rimanenti.\n5. Avvisare il team biglietti per il ricalcolo delle soglie giornaliere degli ultimi 3 giorni.",
    "Sospendere il rientro dal pannello di flotta: i validatori conservano la coda fino a 72 ore (ADR-010).",
    "Reperibile piattaforma per il gateway; team biglietti per le soglie. Se la coda supera le 48 ore su più di 50 dispositivi, aprire un SEV2.", {}],
  ["runbooks/on-call-escalation", "en", "On-call escalation and severity triage", [],
    "Who to page, in which order, and how to declare a severity; includes DDoS triage.",
    "Any alert that is not resolved by the first responder in 15 minutes, any customer-facing impact, or any suspected attack.",
    "PagerDuty access; the incident channel template; the severity levels from the standards bundle.",
    "1. Declare the severity (SEV1: all customers or payments down; SEV2: a region or a function; SEV3: degraded, workaround exists).\n2. Page the owning team's rota (see the Team concepts) and, for SEV1-2, the platform on-call.\n3. Open the incident channel and the tracker entry; assign an incident commander, who does not debug.\n4. For suspected DDoS: enable the prepared WAF challenge rule on the attacked path, raise the autoscaling ceiling, then investigate.\n5. Status update every 30 minutes for SEV1, every hour for SEV2.\n6. After resolution, schedule the post-mortem within 5 working days for SEV1-2.",
    "Not applicable.",
    "SEV1 pages the CTO after 30 minutes without mitigation. Regional operators' NOC is informed for any validator or AVL impact.", { supersedes: "runbooks/escalation-reperibilita-2025" }],
  ["runbooks/escalation-reperibilita-2025", "it", "Escalation della reperibilità (versione 2025, superata)", [],
    "Vecchia procedura di escalation in italiano, sostituita dalla versione inglese unificata nel 2026.",
    "Non usare: sostituita dal runbook di escalation unificato. Conservata come storico.",
    "Nessuno.",
    "1. Chiamare il reperibile del team.\n2. Se non risponde entro 15 minuti, chiamare il responsabile.\n3. Aprire il ticket.",
    "Non applicabile.",
    "Responsabile tecnico di turno.", { status: "deprecated", stale: "2026-01-31" }],
  ["runbooks/pagopa-reconciliation", "it", "Riconciliazione manuale degli avvisi pagoPA", ["services/pagopa-adapter"],
    "Allineare lo stato degli avvisi con il nodo quando le ricevute telematiche non sono arrivate o sono arrivate in ritardo.",
    "Avvisi in stato 'in attesa' da più di 4 ore con pagamento confermato dall'utente, oppure dopo un degrado del nodo segnalato da pagoPA.",
    "Accesso al portale del nodo e alla console di pagopa-adapter; elenco degli IUV interessati; solleciti sospesi.",
    "1. Esportare dalla console gli IUV in attesa da più di 4 ore.\n2. Per ogni IUV interrogare lo stato al nodo (`verificaRPT` / API GPD).\n3. Per gli avvisi risultati pagati, importare la RT con l'azione 'riconcilia' della console: attiva abbonamenti e chiude sanzioni.\n4. Per gli avvisi scaduti non pagati, annullarli e riattivare i solleciti.\n5. Registrare il numero di avvisi riconciliati nel ticket e avvisare l'amministrazione.",
    "L'azione 'riconcilia' è idempotente: ripeterla non duplica attivazioni. Un'attivazione errata si annulla dalla console con motivazione.",
    "Reperibile pagamenti; assistenza pagoPA per stati incoerenti; amministrazione per le sanzioni annullate.", {}],
  ["runbooks/gtfs-manual-import", "en", "Manual GTFS import with per-operator override", ["services/gtfs-ingest", "services/trip-planner"],
    "Import an operator feed that the nightly validation rejects, after fixing or accepting known defects.",
    "Nightly merge rejected for more than 2 days and the operator cannot fix the feed before a schedule change takes effect.",
    "Validator report of the rejected feed; agreement of the mobility lead; the override reason.",
    "1. Download the rejected feed and run the validator locally to list errors.\n2. Apply the override script for the accepted defects (rename duplicated trip ids, drop shapes with invalid coordinates).\n3. Run the merge with `--override <operator> --reason '<text>'`; the manifest records the override.\n4. Check the planner rebuild log and spot-check 5 journeys on the affected lines.\n5. Notify the operator with the list of defects they must fix in the next release.",
    "Republish the previous manifest; the planner swaps back to the previous graph within 2 minutes.",
    "Mobility on-call; the mobility lead approves any override that drops trips.", {}],
  ["runbooks/clickhouse-disk-cleanup", "en", "ClickHouse disk pressure: find and drop oversized parts", ["services/reporting-warehouse"],
    "Free disk on a ClickHouse shard without losing data covered by Kafka retention.",
    "Disk above 80% on any shard, or inserts failing with 'not enough space'.",
    "ClickHouse admin access; the TTL policy from ADR-019; the list of raw tables and their Kafka retention.",
    "1. `SELECT table, formatReadableSize(sum(bytes)) FROM system.parts GROUP BY table ORDER BY sum(bytes) DESC`.\n2. For raw tables with Kafka retention still covering the data, drop the oldest partitions beyond the TTL (`ALTER TABLE ... DROP PARTITION`).\n3. For tables without a TTL, add one now (`ALTER TABLE ... MODIFY TTL ...`) and let the merge free space.\n4. If still above 80%, detach the raw partitions of the last 24 hours and re-ingest later from Kafka.\n5. Confirm the dbt CI check for TTLs covers the offending table.",
    "Detached partitions can be re-attached; dropped partitions are rebuilt by replaying Kafka (see the replay runbook) if within retention.",
    "Data on-call during business hours; platform on-call outside (the paging gap is an open question).", {}],
  ["runbooks/certificate-renewal", "en", "Certificate renewal: cert-manager, fleet CA chain and non-managed hostnames", ["services/api-gateway", "services/validator-gateway"],
    "Renew or rotate TLS certificates including the fleet CA intermediate and hostnames outside cert-manager.",
    "Expiry alert at 21 days, a failed cert-manager renewal, or a fleet CA rotation exercise.",
    "The certificate inventory (weekly DNS comparison job output); access to cert-manager namespaces, the fleet CA offline key ceremony, and Kong.",
    "1. Identify the certificate class: cert-manager managed, fleet CA (broker and devices), or non-managed hostname.\n2. cert-manager: delete the Certificate's secret to force renewal; verify the new NotAfter.\n3. Fleet CA intermediate: issue a new intermediate with the offline root, deploy the new chain to the brokers while keeping the old intermediate trusted on devices, then rotate device trust stores in groups of 500.\n4. Non-managed hostname: issue through ACME with the DNS challenge, upload to Kong, then migrate the hostname into cert-manager so it never happens again.\n5. Update the inventory and verify the whole chain with `openssl verify -show_chain`.",
    "Keep the previous certificate and chain until the new one is verified from a validator and from an external client; revert the Kong certificate object if handshakes fail.",
    "Platform on-call; team biglietti for fleet device impact. Expiry of the fleet intermediate is a SEV1 (INC-2026-001).", {}],
  ["runbooks/refund-queue-unstick", "en", "Unstick the refund approval queue", ["services/refund-service"],
    "Restore the approval worker and drain Temporal task queues that accumulated.",
    "Alert on Temporal task queue age over 1 hour, or refunds pending approval growing for more than a day.",
    "Access to the Temporal UI and the refund-service deployment in Git.",
    "1. Check that the approval worker deployment exists and has ready pods (`kubectl get deploy refund-approval-worker`).\n2. If missing, re-apply from Git (do not create it by hand).\n3. In the Temporal UI confirm the task queue backlog is draining; expected rate 10 refunds per second.\n4. Spot-check 3 refunds for correct amounts before announcing recovery.\n5. Update the refund SLO annotation with the outage window.",
    "Scale the worker to 0 if refunds are executed with wrong amounts; workflows pause safely.",
    "Payments on-call; finance for refunds over 10,000 euro aggregated.", {}],
  ["runbooks/keycloak-realm-restore", "en", "Keycloak realm restore and identity provider metadata reload", ["services/identity-service"],
    "Reload SPID/CIE identity provider metadata, or restore a realm export after a bad configuration change.",
    "SAML signature failures on login (metadata rotation), or a realm misconfiguration deployed by mistake.",
    "Keycloak admin credentials from the secrets manager; the last realm export from the nightly job; identity on-call.",
    "1. For signature failures: Admin console, Identity Providers, each SPID/CIE provider, 'Import from URL' to reload metadata; repeat the synthetic login.\n2. For realm restore: `kc.sh import --file realm-<date>.json --override true` on a maintenance replica, then roll the deployment.\n3. Verify the synthetic SPID login and a password login on the citizens realm, and a SAML login on the operators realm.\n4. Check AccountCreated events resume on the identity topic.",
    "Re-import the previous export; identity providers keep their old metadata until re-imported.",
    "Identity on-call; AgID SPID help desk for identity provider issues.", {}],
  ["runbooks/fare-table-hotfix", "it", "Hotfix di una tabella tariffaria", ["services/fare-engine"],
    "Pubblicare una nuova versione della tabella tariffaria in emergenza con prova in ombra e attivazione a orario.",
    "Prezzi o soglie errati in produzione (reclami, anomalie di incasso, errore in una tabella pubblicata dal portale operatori).",
    "La tabella corretta approvata dal team biglietti; accesso alla console del fare-engine; le validazioni del giorno precedente nel warehouse.",
    "1. Caricare la nuova tabella come versione successiva (mai modificare la versione attiva).\n2. Eseguire la prova in ombra sulle validazioni del giorno precedente: la console mostra le differenze di prezzo per fascia oraria e per soglia.\n3. Verificare in particolare la finestra 23:00-02:00 (lezione dell'INC-2026-015) e i cambi di ora legale.\n4. Attivare la nuova versione all'orario concordato (di norma 03:00) e controllare i primi FareComputed.\n5. Avviare il ricalcolo delle soglie per il periodo errato e i rimborsi a credito wallet.",
    "Riattivare la versione precedente dalla console: l'attivazione è un puntatore, non una migrazione.",
    "Reperibile biglietti; amministrazione per il ricalcolo degli incassi degli operatori.", {}],
  ["runbooks/scale-validator-gateway", "en", "Scale the validator gateway for events and queue drains", ["services/validator-gateway"],
    "Raise replicas and broker limits before fairs, derby days and queue drains; return to baseline after.",
    "Expected validation peak above 2x baseline (events published by the operators) or before a queue drain.",
    "Platform on-call; the event calendar from the operators; broker connection limits.",
    "1. Raise the gateway deployment from 3 to 6 replicas and the Mosquitto max connections per node by 50%.\n2. Confirm Redis de-duplication memory headroom (keys expire after 72 hours).\n3. Watch ingest latency p95; baseline is 400 ms, alert at 2 seconds.\n4. After the event, scale back to 3 replicas once the connection count is at baseline for 1 hour.",
    "Scale back immediately if Redis memory exceeds 80%; the broker buffers for the duration.",
    "Platform on-call; team biglietti for fare and cap effects of delayed events.", {}],
  ["runbooks/notification-rate-limit", "en", "Tune notification rate limits and stop a storm", ["services/notification-hub"],
    "Stop a notification storm and adjust per-user and per-campaign limits.",
    "Delivery rate alert above 5x baseline, FCM quota warnings, or duplicate complaints.",
    "Access to the notification-hub admin API and the feature flags.",
    "1. Flip the kill switch `kill.notification-hub.marketing` to pause marketing delivery (transactional continues).\n2. Identify the producer from the request_id prefix and stop it.\n3. Purge the pending queue for that campaign with the admin API.\n4. Adjust limits if needed: marketing default 1 per user per day, transactional 20 per user per hour.\n5. Re-enable marketing and watch delivery for 15 minutes.",
    "Restore the previous limits from Git; the kill switch is reversible at any time.",
    "Platform on-call; the campaign owner; privacy officer if marketing went to users without consent.", {}],
  ["runbooks/schema-registry-rollback", "en", "Roll back a schema registry change", [],
    "Revert a schema version that broke consumers and restore producers to the previous version.",
    "Consumers failing deserialization after a schema registration, or a compatibility level changed by mistake.",
    "Schema registry admin credentials; the CI pipeline that registers schemas; the owning team of the subject.",
    "1. Identify the subject and the offending version (`GET /subjects/<subject>/versions`).\n2. Soft-delete the offending version (`DELETE /subjects/<subject>/versions/<n>`), which keeps consumers able to read already produced messages.\n3. Roll back the producer deployment to the release that used the previous version.\n4. Restore the compatibility level if it was changed (`PUT /config/<subject>` with BACKWARD or FULL).\n5. Open a change ticket: the fix is a new version through CI, never a manual registration.",
    "Undelete the version (`POST /subjects/<subject>/versions/<n>?permanent=false`) if consumers depended on it.",
    "Platform on-call; data lead for warehouse consumers.", {}],
  ["runbooks/incident-severity-triage", "en", "Incident severity triage checklist", [],
    "Five questions that set the severity of an incident consistently across teams.",
    "At incident declaration and every time the impact changes.",
    "The severity levels standard; the current impact estimate.",
    "1. Are payments or validations down for everyone? SEV1.\n2. Is a whole function (login, planner, refunds) or a whole region down, or money wrong for many customers? SEV2.\n3. Is there degradation with a workaround, or a partner-only impact? SEV3.\n4. Is it internal only with no customer impact? SEV4, no page.\n5. When in doubt, pick the higher severity and downgrade later with a note.",
    "Not applicable.",
    "The incident commander decides; the CTO can override.", {}],
  ["runbooks/wallet-balance-reconciliation", "en", "Nightly wallet balance reconciliation", ["services/wallet-service", "services/payments-orchestrator"],
    "Compare wallet balances and transactions with PSP settlement files and FareComputed events; resolve mismatches.",
    "Every night at 04:00 (automated) and after any incident involving debits, top-ups or refunds.",
    "Settlement file from the PSP (SFTP), the warehouse marts, the reconciliation console.",
    "1. The job compares top-ups with PSP captures, debits with FareComputed, and balance_after with the projection.\n2. Review the mismatch report: categories are missing capture, duplicate debit, projection lag.\n3. Missing capture: re-run the capture through payments-orchestrator with the same payment id (idempotent).\n4. Duplicate debit: issue a reversal command with the duplicate's transaction id as reference.\n5. Projection lag over 1 minute: rebuild the read model for the affected wallets.",
    "Reversals are themselves events and can be reversed; never edit the event store.",
    "Payments on-call; finance for mismatches over 1,000 euro per night.", {}],
  ["runbooks/avl-feed-restart", "it", "Riavvio del consumer AVL quando le posizioni si bloccano", ["services/avl-collector", "services/realtime-predictions"],
    "Riavviare il consumer group delle posizioni dei veicoli quando resta in stato zombie dopo un riavvio dei broker.",
    "Allarme 'posizioni non aggiornate' per più di 5 minuti con broker sani e dispositivi connessi.",
    "Accesso a Kubernetes e alle metriche del consumer group `avl-collector`.",
    "1. Verificare che il broker sia sano e che i dispositivi pubblichino (metriche MQTT).\n2. Controllare il lag del gruppo `avl-collector`: se le partizioni sono assegnate ma l'offset non avanza, il consumer è bloccato.\n3. Riavviare i pod di avl-collector (`kubectl rollout restart deploy/avl-collector`).\n4. Verificare che le posizioni tornino aggiornate entro 2 minuti e che le previsioni ripartano.\n5. Se il problema si ripete nella stessa giornata, aprire un ticket per la libreria client.",
    "Non applicabile: il riavvio non perde dati (Kafka conserva 3 giorni).",
    "Reperibile mobilità; reperibile piattaforma per i broker.", {}],
  ["runbooks/legacy-sbe-restart", "it", "Riavvio del legacy SBE (deprecato)", ["services/legacy-sbe"],
    "Procedura storica di riavvio del monolite SBE: non usare, contattare il fornitore.",
    "Non usare. Il sistema è in dismissione (ADR-017): qualsiasi anomalia va segnalata al fornitore.",
    "Nessuno.",
    "1. Contattare il fornitore con il numero di contratto.\n2. Non riavviare i servizi applicativi né il database Oracle.",
    "Non applicabile.",
    "Fornitore; reperibile biglietti solo per informare gli operatori.", { status: "deprecated", stale: "2026-03-31" }],
  ["runbooks/feature-flag-kill-switch", "en", "Use a kill switch flag", [],
    "Turn off a risky feature at runtime through its kill switch flag, with the naming and audit rules.",
    "A feature causes errors or cost and a rollback would take longer than a flag flip.",
    "Unleash admin access (draft adoption, ADR-016); the flag name `kill.<service>.<feature>` from the service's runbook section.",
    "1. Find the flag in Unleash; confirm the service reads it (last seen under 1 minute).\n2. Enable the kill switch for the production environment; the SDK applies it within 30 seconds.\n3. Verify the feature is off (metrics or a synthetic check) and announce in the incident channel.\n4. Leave the flag on until the fix is deployed; remove the flag within 30 days after.",
    "Disable the kill switch; the feature resumes within 30 seconds.",
    "Owning team's on-call; platform on-call if Unleash itself is unavailable (SDKs keep the last known state).", {}],
];
RUNBOOKS.forEach(([id, lang, title, services, description, when, prerequisites, steps, rollback, escalation, extra]) => {
  const x = extra || {};
  const it = lang === "it";
  const prov = provenance("runbook");
  prov.sources = [SRC.wiki(`runbooks/${id.split("/")[1]}`)];
  if (x.status) prov.status = x.status;
  if (x.stale) prov.stale_after = x.stale;
  if (x.status === "deprecated") delete prov.verified;
  const relations = services.map((s) => rel("runbook_for", s)).concat(x.supersedes ? [rel("supersedes", x.supersedes)] : []);
  cat({
    id, type: "Runbook", lang, title, description,
    tags: ["runbook", "operations", ...services.map((s) => s.split("/")[1]), ...(it ? ["procedura"] : [])],
    ...prov, relations,
    body: `# ${title}\n\n${description}${services.length ? `\n\n${it ? "Servizi" : "Services"}: ${services.map((s) => mdlink(s.split("/")[1], s)).join(", ")}` : ""}\n\n## ${it ? "Quando usarlo" : "When to use"}\n${when}\n\n## ${it ? "Prerequisiti" : "Prerequisites"}\n${prerequisites}\n\n## ${it ? "Passi" : "Steps"}\n${steps}\n\n## Rollback\n${rollback}\n\n## ${it ? "Escalation" : "Escalation"}\n${escalation}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Dependencies (16)
// ---------------------------------------------------------------------------------------------
// [id, lang, title, version, kind, description, usage, supportEnd, upgradeNotes, owner team, url, extra]
const DEPENDENCIES = [
  ["dependencies/postgresql-16", "en", "PostgreSQL 16 (managed)", "16.4", "database", "Transactional database for most services; one managed instance per service with a synchronous replica.",
    "wallet event store, ledger (monthly partitions), fare tables, subscriptions, refunds, Keycloak, consents.", "2028-11 (community); managed engine deprecation announced 12 months ahead.",
    "Minor upgrades are applied in the maintenance window monthly; major upgrade to 17 planned for Q2 2027 after the partitioning question is settled.", "team-piattaforma", "https://www.postgresql.org/support/versioning/", {}],
  ["dependencies/apache-kafka", "en", "Apache Kafka (managed, 3 brokers)", "3.8", "messaging", "Event backbone for all asynchronous communication (ADR-002).",
    "every v1/v2 topic in the data contracts; consumer groups per service; topic configuration in Git.", "Managed service; version pinned per environment.",
    "Broker rolling restarts can leave zombie consumers with the old client library (INC-2026-023): upgrade clients first.", "team-piattaforma", "https://kafka.apache.org/", {}],
  ["dependencies/redis", "en", "Redis 7", "7.2", "cache", "De-duplication windows, read caches and rate-limit counters.",
    "validator-gateway de-duplication (72-hour keys), BFF response cache, notification rate limits, planner nearby-stops cache.", "7.2 security fixes until 2026-12; licence change evaluated (Valkey as alternative).",
    "Move to Valkey 8 is a draft proposal; API compatible for our usage.", "team-piattaforma", "https://redis.io/", { stale: "2026-09-30" }],
  ["dependencies/keycloak", "en", "Keycloak 25", "25.0", "identity", "Identity provider for citizens (SPID, CIE, password) and operators (SAML).",
    "identity-service realms, JWT issuance for the API gateway, consent-manager account events.", "Upstream supports the latest major only; 26 released.",
    "Upgrade to 26 blocked by the custom SPID attribute mapper; rewrite scheduled with the identity team.", "team-identita", "https://www.keycloak.org/", {}],
  ["dependencies/clickhouse", "en", "ClickHouse 24", "24.8 LTS", "database", "Analytical warehouse (ADR-006): 3 shards, 2 replicas, Kafka engine ingestion.",
    "reporting-warehouse raw tables and dbt marts; operator portal dashboards.", "LTS supported 12 months from release.",
    "Every raw table must declare a TTL (dbt CI check) since INC-2026-018.", "team-dati", "https://clickhouse.com/", {}],
  ["dependencies/kong-gateway", "en", "Kong Gateway 3.8 (OSS)", "3.8", "gateway", "Edge API gateway (ADR-013) with declarative configuration.",
    "api-gateway: JWT, rate limiting, routing by URL version, TLS termination with cert-manager.", "OSS release line; minor every quarter.",
    "Declarative config validated in CI with deck; plugins limited to four.", "team-piattaforma", "https://konghq.com/", {}],
  ["dependencies/nexi-xpay", "it", "Nexi XPay (PSP primario)", "API v2 (2026)", "vendor", "Gateway di pagamento primario per carte e Bancomat Pay (ADR-018).",
    "payments-orchestrator: autorizzazione, 3-D Secure, incasso, rimborsi; pagina di pagamento ospitata per la tokenizzazione del PAN.", "Contratto fino al 2028-06; rotazione credenziali trimestrale.",
    "Il canale di assistenza è il portale merchant; per i degradi di produzione usare il numero di reperibilità nel contratto. Il PSP di fallback viene provato ogni mese con l'1% del traffico.", "team-pagamenti", "https://developer.nexi.it/", {}],
  ["dependencies/pagopa-platform", "it", "Piattaforma pagoPA (nodo dei pagamenti)", "SANP 3.x", "vendor", "Nodo nazionale dei pagamenti verso la pubblica amministrazione; integrazione diretta (ADR-009).",
    "pagopa-adapter: avvisi, RPT/RT, verifica stato (GPD), riconciliazione per abbonamenti aziendali e sanzioni.", "Specifiche SANP aggiornate dal gestore; certificati client con scadenza annuale.",
    "I degradi del nodo sono comunicati sul portale di assistenza; la nostra riconciliazione non deve dipendere solo dalle RT push (INC-2026-007).", "team-pagamenti", "https://www.pagopa.gov.it/", {}],
  ["dependencies/spid-cie-idp", "it", "Identity provider SPID e CIE", "Regole tecniche AgID 2026", "vendor", "Federazione con gli identity provider SPID accreditati e con CIE id per l'accesso dei cittadini.",
    "identity-service tramite Keycloak: metadati SAML aggiornati ogni ora, livello SPID nel token.", "Gli IdP ruotano i certificati senza preavviso: i metadati vanno ricaricati di frequente (INC-2026-013).",
    "Il login CIE da mobile con app CieID è in valutazione (questione aperta).", "team-identita", "https://www.spid.gov.it/", {}],
  ["dependencies/eclipse-mosquitto-mqtt", "en", "Eclipse Mosquitto (MQTT broker cluster)", "2.0", "messaging", "MQTT 5 broker for validators and on-board units with mutual TLS (ADR-020).",
    "validator-gateway and avl-collector subscriptions; per-device certificates from the fleet CA.", "Community support; clustered through a bridge topology.",
    "Broker certificate chain is monitored end to end since INC-2026-001; capacity 10,000 connections per node.", "team-piattaforma", "https://mosquitto.org/", {}],
  ["dependencies/confluent-schema-registry", "en", "Schema registry (Confluent-compatible)", "7.7", "messaging", "Avro schema registry for every Kafka topic (ADR-011).",
    "CI registration of schemas; BACKWARD default, FULL for commands; rollback runbook.", "Pinned with the Kafka managed service.",
    "Never register schemas at runtime; producers fail fast if the registry is unreachable at startup.", "team-piattaforma", "https://docs.confluent.io/platform/current/schema-registry/", {}],
  ["dependencies/kubernetes-eks", "en", "Kubernetes (managed EKS)", "1.31", "platform", "Container platform for every service; two clusters (production, staging) in eu-south-1.",
    "all deployments; cert-manager; Kong; autoscaling (HPA) with ceilings per service.", "EKS supports each minor for 14 months; 1.31 standard support until 2026-11.",
    "Upgrade to 1.32 scheduled for November 2026; manual kubectl changes are being replaced by GitOps (ADR-021 draft).", "team-piattaforma", "https://kubernetes.io/releases/", { stale: "2026-09-30" }],
  ["dependencies/argocd", "en", "Argo CD", "2.12", "platform", "GitOps controller proposed in ADR-021 (draft); running in staging only.",
    "staging deployments of platform services; production adoption pending the ADR.", "Project release line; minor every 3 months.",
    "Drift correction must be tested against the emergency fast-track path before production.", "team-piattaforma", "https://argo-cd.readthedocs.io/", { status: "draft" }],
  ["dependencies/unleash", "en", "Unleash (self-hosted)", "6.1", "platform", "Feature flag service proposed in ADR-016 (draft); kill switch convention `kill.<service>.<feature>`.",
    "notification-hub marketing kill switch; fraud threshold flag; PSP failover flag.", "Open-source release line.",
    "SDKs cache the last known state, so an Unleash outage freezes flags rather than failing requests.", "team-piattaforma", "https://www.getunleash.io/", { status: "draft" }],
  ["dependencies/firebase-cloud-messaging", "en", "Firebase Cloud Messaging", "HTTP v1 API", "vendor", "Push notification delivery to iOS and Android apps.",
    "notification-hub push channel; per-project quota.", "Legacy API removed in 2024; HTTP v1 only.",
    "Quota warnings were the first external signal of the notification storm (INC-2026-016).", "team-piattaforma", "https://firebase.google.com/docs/cloud-messaging", {}],
  ["dependencies/onnx-runtime", "en", "ONNX Runtime", "1.19", "library", "Inference runtime for the fraud model and the arrival prediction model.",
    "fraud-scoring and realtime-predictions; models exported from the training pipeline in the warehouse.", "Project release line; pin per service.",
    "Model and runtime versions are recorded in every FraudScore and ArrivalPrediction event (model_version).", "team-dati", "https://onnxruntime.ai/", {}],
];
DEPENDENCIES.forEach(([id, lang, title, version, kind, description, usage, supportEnd, upgradeNotes, team, url, extra]) => {
  const x = extra || {};
  const it = lang === "it";
  const prov = provenance("dependency");
  prov.sources = [SRC.vendor(url)];
  if (x.status) prov.status = x.status;
  if (x.stale) prov.stale_after = x.stale;
  cat({
    id, type: "Dependency", lang, title, description,
    tags: ["dependency", kind, team.replace("team-", ""), ...(it ? ["dipendenza"] : [])],
    version, ...prov, relations: [rel("owned_by", `teams/${team}`)],
    body: `# ${title}\n\n${description}\n\n**${it ? "Versione" : "Version"}:** ${version} · **${it ? "Tipo" : "Kind"}:** ${kind} · **Owner:** ${mdlink(team, `teams/${team}`)}\n\n## ${it ? "Dove si usa" : "Where it is used"}\n${usage}\n\n## ${it ? "Fine supporto" : "Support end"}\n${supportEnd}\n\n## ${it ? "Note di aggiornamento" : "Upgrade notes"}\n${upgradeNotes}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 9. SLOs (18)
// ---------------------------------------------------------------------------------------------
// [id, lang, title, service, description, sli, objective, errorBudget, alerting, extra]
const SLOS = [
  ["slos/fare-engine-latency-p99", "en", "SLO: fare-engine quote latency", "services/fare-engine", "99% of fare quotes answered within 80 ms over 28 days.",
    "Server-side latency of GET /v2/fares/quote measured at the gateway, excluding client time.", "p99 under 80 ms; p50 under 15 ms. Window 28 days.", "0.25% of quotes may exceed 80 ms (about 36,000 per 28 days).", "Burn-rate alerts: 14.4x over 1 hour pages; 6x over 6 hours tickets. Dashboard fare-engine/latency.", {}],
  ["slos/validator-gateway-availability", "en", "SLO: validator-gateway availability", "services/validator-gateway", "99.95% of validator MQTT sessions accepted and events acknowledged, 28 days.",
    "Share of 1-minute windows in which at least 99% of connected validators received an acknowledgement for their publishes.", "99.95% of minutes per 28 days (21 minutes of budget).", "21 minutes per 28 days; INC-2026-001 consumed 10 months of budget in one morning.", "Page when 5 consecutive minutes fail; the offline queue hides the impact from riders, not from caps and inspections.", {}],
  ["slos/validator-gateway-ingest-latency", "en", "SLO: validator-gateway ingest latency", "services/validator-gateway", "95% of validations published to Kafka within 2 seconds of receipt (online devices).",
    "received_at to Kafka append time for events with delayed=false.", "p95 under 2 seconds, 28 days; baseline 400 ms.", "5% of online validations may exceed 2 seconds.", "Ticket at p95 over 1 second for 30 minutes; page at 2 seconds for 10 minutes (scale with the runbook).", {}],
  ["slos/wallet-service-consistency", "en", "SLO: wallet balance consistency", "services/wallet-service", "99.99% of wallets reconcile with zero mismatch in the nightly job; projection lag under 1 second p99.",
    "Nightly reconciliation mismatches over total active wallets; projection lag from event store append to read model update.", "99.99% wallets with zero mismatch; lag p99 under 1 second.", "About 120 wallets per night may mismatch before the SLO is at risk.", "Any duplicate-debit mismatch pages payments on-call regardless of count.", {}],
  ["slos/payments-orchestrator-authorization-success", "en", "SLO: card authorization success", "services/payments-orchestrator", "Technical authorization success rate above 99.5% (excluding issuer declines), 7 days.",
    "Authorizations completed at the PSP without a technical error, over attempts, excluding declines by the issuer and 3-D Secure abandonment.", "99.5% over 7 days.", "0.5% technical failures; a PSP incident longer than 50 minutes at peak burns the week.", "Page at 98% over 10 minutes; consider the PSP failover flag (ADR-018).", {}],
  ["slos/pagopa-adapter-rt-delivery", "it", "SLO: riconciliazione delle ricevute pagoPA", "services/pagopa-adapter", "Il 99% degli avvisi pagati risulta riconciliato entro 4 ore, su 28 giorni.",
    "Tempo tra il pagamento (data della RT) e la riconciliazione interna, per gli avvisi pagati.", "99% entro 4 ore; 99,9% entro 24 ore.", "L'1% degli avvisi può superare le 4 ore; un degrado del nodo come INC-2026-007 consuma il budget di due mesi.", "Allarme quando più di 50 avvisi sono in attesa da oltre 4 ore; il job di polling è la prima mitigazione.", {}],
  ["slos/identity-service-login-availability", "en", "SLO: login availability (SPID, CIE, password)", "services/identity-service", "99.9% of login attempts complete without a technical error, per method, 28 days.",
    "Synthetic login every 5 minutes per method plus real-user success rate excluding wrong credentials and user abandonment.", "99.9% per method; SPID measured separately because its providers fail independently.", "43 minutes per 28 days per method.", "Page on 3 consecutive synthetic failures for any method; SAML signature failures page immediately.", {}],
  ["slos/trip-planner-latency", "en", "SLO: trip planner latency", "services/trip-planner", "95% of plans answered within 150 ms; 99.9% availability.",
    "Server-side latency of GET /v1/planner/plan; availability as non-5xx share.", "p95 under 150 ms; availability 99.9% over 28 days.", "5% of plans may exceed 150 ms; 43 minutes of unavailability.", "Page at p95 over 400 ms for 10 minutes or availability under 99% for 5 minutes (the DDoS tripped both).", {}],
  ["slos/gtfs-ingest-freshness", "en", "SLO: GTFS timetable freshness", "services/gtfs-ingest", "The active timetable is never older than 7 days behind an operator's published change.",
    "Age of the active merged release relative to the newest operator release that passed or would pass validation.", "100% of days with age under 7 days over 90 days (hard limit).", "Zero budget: one breach is an incident (INC-2026-009).", "Ticket at 2 days of rejected merges; page at 5 days.", {}],
  ["slos/realtime-predictions-accuracy", "en", "SLO: arrival prediction accuracy (draft)", "services/realtime-predictions", "80% of predictions with confidence above 0.3 within 60 seconds of the actual arrival.",
    "Absolute error between predicted and observed arrival (from AVL) for predictions made 5 minutes ahead.", "80% within 60 seconds; 95% within 180 seconds. Draft: no alerting yet.", "Not enforced while the service is in draft.", "None yet; dashboard predictions/accuracy. Alerting to be defined when the service leaves draft.", { status: "draft" }],
  ["slos/notification-hub-delivery", "en", "SLO: notification delivery", "services/notification-hub", "99% of transactional notifications delivered to the provider within 60 seconds.",
    "requested_at to provider acceptance for category TRANSACTIONAL.", "99% within 60 seconds over 28 days; marketing is best effort.", "1% of transactional notifications may be late.", "Page at 95% for 10 minutes; delivery rate above 5x baseline pages too (storm detection).", {}],
  ["slos/fraud-scoring-latency", "en", "SLO: fraud scoring latency", "services/fraud-scoring", "99% of validations scored within 500 ms so that blocks reach inspectors before the next stop.",
    "TicketValidated receipt to FraudScore publish.", "p99 under 500 ms over 28 days.", "1% of scores may be late; late scores never block retroactively.", "Ticket at p99 over 300 ms; page at 1 second for 10 minutes.", {}],
  ["slos/reporting-warehouse-freshness", "en", "SLO: operator dashboard freshness", "services/reporting-warehouse", "Operator dashboards show data at most 15 minutes old during service hours (05:00-01:00).",
    "Difference between now and the newest validated_at in the ridership mart.", "99% of 5-minute checks under 15 minutes over 28 days.", "About 2 hours of staleness per 28 days.", "Ticket at 30 minutes; page at 60 minutes (INC-2026-018 would have paged at 03:10 instead of 06:00).", {}],
  ["slos/api-gateway-availability", "en", "SLO: API gateway availability", "services/api-gateway", "99.95% of requests not failed by the gateway itself (5xx from Kong, TLS errors), 28 days.",
    "Gateway-originated errors over total requests, per hostname.", "99.95% per public hostname.", "21 minutes per hostname per 28 days; the partner hostname expiry consumed 4 hours.", "Synthetic TLS check per hostname every minute; page on 3 failures.", {}],
  ["slos/mobile-bff-latency", "en", "SLO: mobile BFF latency", "services/mobile-bff", "95% of home-screen aggregations within 300 ms.",
    "Server-side latency of GET /bff/home (tickets, wallet, nearby predictions).", "p95 under 300 ms; p99 under 800 ms over 28 days.", "5% may exceed 300 ms.", "Page at p95 over 600 ms for 10 minutes; check Redis cache hit ratio first.", {}],
  ["slos/subscription-manager-renewal-success", "en", "SLO: subscription renewal correctness", "services/subscription-manager", "100% of due renewals executed exactly once within the renewal day.",
    "Renewals executed per subscription per period compared with renewals due.", "Exactly one renewal per due subscription per period; 99.9% executed within the day.", "Zero budget for duplicates (INC-2026-027); 0.1% may slip a day.", "Any duplicate renewal pages team biglietti; missing renewals ticket at 08:00.", {}],
  ["slos/refund-service-turnaround", "en", "SLO: refund turnaround", "services/refund-service", "95% of refunds completed within 5 working days of the request.",
    "Request creation to PaymentRefunded or wallet credit, in working days; approval queue age tracked separately.", "95% within 5 working days per calendar month.", "5% of refunds may exceed 5 days; September 2026 breached because of the stuck queue.", "Ticket when approval queue age exceeds 1 hour; page at 24 hours.", {}],
  ["slos/inspector-backend-sync-latency", "it", "SLO: latenza di verifica e sincronizzazione dei controllori", "services/inspector-app-backend", "Il 99% delle verifiche online risponde entro 300 ms; gli esiti offline sono sincronizzati entro 30 minuti dal rientro in copertura.",
    "Latenza della verifica online misurata nell'app; tempo tra rientro in copertura e sincronizzazione completa.", "p99 online sotto 300 ms; 99% delle sincronizzazioni entro 30 minuti, su 28 giorni.", "L'1% delle verifiche può superare i 300 ms; l'1% delle sincronizzazioni può superare i 30 minuti.", "Allarme se la risposta 'non trovato' supera il 5% delle verifiche per 10 minuti (segno di lag del ledger); pagina a 10 minuti di lag.", {}],
];
SLOS.forEach(([id, lang, title, service, description, sli, objective, errorBudget, alerting, extra]) => {
  const x = extra || {};
  const it = lang === "it";
  const prov = provenance("slo");
  prov.sources = [SRC.grafana(id.split("/")[1])];
  if (x.status) { prov.status = x.status; delete prov.verified; }
  cat({
    id, type: "SLO", lang, title, description,
    tags: ["slo", "reliability", service.split("/")[1], ...(it ? ["affidabilità"] : [])],
    ...prov, relations: [rel("measures", service)],
    body: `# ${title}\n\n${description}\n\n${it ? "Servizio" : "Service"}: ${mdlink(service.split("/")[1], service)}\n\n## SLI\n${sli}\n\n## ${it ? "Obiettivo" : "Objective"}\n${objective}\n\n## Error budget\n${errorBudget}\n\n## Alerting\n${alerting}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 10. Open questions (10)
// ---------------------------------------------------------------------------------------------
// [id, lang, title, description, question, options, leaning, owner, due, related]
const QUESTIONS = [
  ["questions/q-001-multi-region-active-active", "en", "Open question: do we need a second region (active-active)?",
    "Whether ticketing must survive the loss of eu-south-1, and at what cost.",
    "The Regione's new service contract (2027) may require a recovery time of 30 minutes for validations. Today a region loss means hours. Do we build active-active, active-passive, or negotiate the requirement down?",
    "1. Active-passive with asynchronous PostgreSQL replicas in eu-central-1 (RPO minutes, RTO about 1 hour).\n2. Active-active with CockroachDB for the ledger and the wallet (ADR-003 revisited).\n3. Accept the risk and extend the validator offline window from 72 hours to 7 days.",
    "Option 1 for 2027; option 3 as the real mitigation for riders. Option 2 only if the contract demands RPO zero.", ACTOR.cto, "2026-12-15", ["decisions/adr-003-postgres-over-cockroach", "decisions/adr-010-offline-validation-window"]],
  ["questions/q-002-wallet-emoney-licence", "it", "Questione aperta: il credito prepagato richiede una licenza di moneta elettronica?",
    "Se il wallet prepagato, superata una certa soglia di raccolta, ricade nella disciplina degli istituti di moneta elettronica.",
    "Il wallet raccoglie circa 4 milioni di euro di credito prepagato. Oltre quale soglia e con quali condizioni d'uso (solo biglietti nostri o anche partner) serve una licenza IMEL o un partner autorizzato?",
    "1. Limitare il credito a 150 euro per wallet e all'acquisto di soli titoli di viaggio (esenzione a rete limitata).\n2. Appoggiarsi a un istituto di moneta elettronica partner che custodisce i fondi.\n3. Richiedere l'autorizzazione come IMEL.",
    "Opzione 1 nel breve; parere legale in corso. Impatto tecnico: limite di saldo nel wallet-service e nei top-up.", ACTOR.payments, "2026-11-30", ["services/wallet-service"]],
  ["questions/q-003-gtfs-rt-vendor-quality", "en", "Open question: GTFS and GTFS-RT quality per operator vendor",
    "Three operators use the same scheduling vendor whose GTFS exports fail validation monthly.",
    "Should we fix feeds on their behalf (overrides), require a validation report in the service contract, or build a self-service validator for operators?",
    "1. Keep manual overrides (cost: about 2 days per month of the mobility team).\n2. Contractual requirement: feeds must pass the MobilityData validator.\n3. Self-service validator in the operator portal with blocking upload.",
    "Option 3, with option 2 as backing in the next contract round.", ACTOR.mobility, "2027-01-31", ["services/gtfs-ingest", "incidents/inc-2026-009-gtfs-import-failure"]],
  ["questions/q-004-fraud-model-retraining", "en", "Open question: fraud model retraining cadence and feature store",
    "Monthly retraining misses new QR cloning patterns for weeks.",
    "Move to weekly or event-driven retraining? That needs a feature store and a labelled feedback loop from inspections faster than the current monthly export.",
    "1. Weekly retraining from the warehouse marts (cheap, still batch).\n2. Online features in Redis plus weekly model refresh.\n3. Buy a managed fraud service (rejected for data residency so far).",
    "Option 2; needs the inspection result labels within 24 hours.", ACTOR.data, "2026-12-31", ["services/fraud-scoring", "contracts/inspection-result-v1"]],
  ["questions/q-005-ticket-validated-v3-schema", "en", "Open question: TicketValidated v3 with cap and fare context",
    "Consumers re-join validations with fares and caps; a v3 event could carry them.",
    "Should TicketValidated v3 embed the fare decision and cap state, or should consumers keep joining FareComputed? Embedding couples the gateway to fare-engine timing.",
    "1. Keep v2; publish a derived 'ValidationPriced' event from the ledger.\n2. v3 with embedded fare context produced by the ledger, not the gateway.\n3. Do nothing; consumers join in the warehouse.",
    "Option 1 (derived event keeps the gateway dumb and fast).", ACTOR.ticketing, "2027-02-28", ["contracts/ticket-validated-v2", "contracts/fare-computed-v1"]],
  ["questions/q-006-postgres-partitioning-validations", "en", "Open question: ledger partitioning beyond monthly",
    "Monthly partitions reached 180 GB; vacuum and index builds take hours.",
    "Weekly partitions, hash sub-partitioning by device, or move raw validations older than 3 months to ClickHouse and keep PostgreSQL for the hot window?",
    "1. Weekly partitions (simple, more partitions to manage).\n2. Monthly partitions sub-partitioned by hash(device_id) into 8.\n3. Hot window of 3 months in PostgreSQL, the rest in ClickHouse, inspector queries routed by age.",
    "Option 3 is the long-term direction; option 1 as a stopgap before the PostgreSQL 17 upgrade.", ACTOR.ticketing, "2026-11-30", ["services/validation-ledger", "dependencies/postgresql-16", "decisions/adr-019-data-retention-validations"]],
  ["questions/q-007-on-call-compensation", "it", "Questione aperta: reperibilità del team dati fuori orario",
    "Il team dati copre solo l'orario d'ufficio; gli incidenti notturni sul warehouse aspettano fino alle 6.",
    "Introdurre una reperibilità 24/7 per il team dati (4 persone, turni pesanti), far coprire il warehouse al team piattaforma, o accettare un SLO più lasco per i cruscotti degli operatori di notte?",
    "1. Reperibilità 24/7 del team dati con indennità.\n2. Il team piattaforma copre i soli allarmi di infrastruttura (disco, nodi) del warehouse.\n3. SLO dei cruscotti valido solo in orario di servizio (05:00-01:00) e nessuna pagina notturna.",
    "Opzione 2 più opzione 3: l'SLO di freschezza è già definito sull'orario di servizio.", ACTOR.sre, "2026-11-15", ["slos/reporting-warehouse-freshness", "incidents/inc-2026-018-clickhouse-disk-full"]],
  ["questions/q-008-cie-mobile-login", "it", "Questione aperta: login con CIE da mobile (app CieID)",
    "Il login CIE funziona da desktop con lettore o da mobile con NFC tramite CieID; l'integrazione in app non è ancora fatta.",
    "Integrare il flusso CieID nelle app (deep link e ritorno) come alternativa a SPID, visto che SPID dipende da IdP esterni e la CIE è ormai diffusa? Quanto costa e quali livelli di sicurezza copre?",
    "1. Integrare CieID livello 2 nelle app entro il 2027.\n2. Solo web mobile con CieID, nessuna integrazione nativa.\n3. Attendere l'IT Wallet nazionale.",
    "Opzione 1; dipende dalla migrazione a Keycloak 26.", ACTOR.identity, "2027-03-31", ["services/identity-service", "dependencies/spid-cie-idp", "dependencies/keycloak"]],
  ["questions/q-009-storefront-ssr-cost", "en", "Open question: server-side rendering cost of the storefront",
    "SSR costs 11 cents per thousand requests and was the DDoS surface; which routes really need it?",
    "Keep SSR for SEO-relevant pages only (fares, subscriptions) and move the planner and account pages to client rendering with a static shell? Or move the whole storefront to static with islands?",
    "1. SSR only for public content pages; client rendering for planner and account.\n2. Fully static shell with islands and edge caching.\n3. Keep SSR, scale and protect with WAF (current state).",
    "Option 1 before the 2027 season.", ACTOR.sre, "2026-12-31", ["services/web-storefront", "incidents/inc-2026-029-storefront-ddos"]],
  ["questions/q-010-legacy-sbe-data-archive", "it", "Questione aperta: archiviazione dei dati storici del legacy SBE",
    "Prima dello spegnimento di marzo 2027 vanno conservati 12 anni di dati Oracle con obblighi fiscali.",
    "Esportare in Parquet nel warehouse (ClickHouse) con conservazione 10 anni, mantenere un'istanza Oracle in sola lettura, o affidare l'archivio al fornitore?",
    "1. Export in Parquet verso l'object storage e tabelle esterne in ClickHouse.\n2. Oracle in sola lettura per 10 anni (licenza ridotta).\n3. Archivio presso il fornitore con accesso su richiesta.",
    "Opzione 1; verifica legale sul formato per le ispezioni fiscali in corso.", ACTOR.data, "2026-12-31", ["services/legacy-sbe", "decisions/adr-017-retire-legacy-sbe"]],
];
QUESTIONS.forEach(([id, lang, title, description, question, options, leaning, owner, due, related]) => {
  const it = lang === "it";
  const prov = provenance("question");
  cat({
    id, type: "Open Question", lang, title, description,
    tags: ["open-question", "architecture", ...(it ? ["questione-aperta"] : ["question"])],
    owner, due, ...prov, relations: related.map((r) => rel("related_to", r)),
    body: `# ${title}\n\n${description}\n\n## ${it ? "Domanda" : "Question"}\n${question}\n\n## ${it ? "Opzioni" : "Options"}\n${options}\n\n## ${it ? "Orientamento attuale" : "Current leaning"}\n${leaning}\n\n## ${it ? "Owner e scadenza" : "Owner and due date"}\n\`${owner}\` · ${due}\n\n## ${it ? "Collegamenti" : "Related"}\n${related.map((r) => `- ${mdlink(r.split("/")[1], r)}`).join("\n")}\n`,
  });
});

// ---------------------------------------------------------------------------------------------
// 11. Shared standards bundle (8)
// ---------------------------------------------------------------------------------------------
const STANDARD_DOCS = [
  ["standards/adr-template", "ADR template and process", "How an architecture decision record is written, numbered, reviewed and superseded.",
    "Every architecturally significant decision gets an ADR numbered sequentially (ADR-NNN) in the architecture repository. Sections: Context, Decision, Consequences, Related. Status is proposed, accepted, deprecated or superseded; a superseding ADR names the one it replaces and the old one is marked, never deleted. ADRs are reviewed in the weekly architecture meeting with the CTO; a proposed ADR older than 60 days is closed as rejected. The catalog mirrors ADRs as Decision concepts with the same number."],
  ["standards/slo-policy", "SLO policy", "Every customer-facing service has at least one SLO with an SLI, an objective, an error budget and burn-rate alerts.",
    "Each service owner defines SLOs on user-visible behaviour (latency, availability, correctness, freshness), measured over 28 days unless the business cycle says otherwise. Alerts are multi-window burn-rate alerts: 14.4x over 1 hour pages, 6x over 6 hours opens a ticket. When the error budget is exhausted, the team freezes feature work on that service until the budget recovers or the CTO grants an exception. SLOs are reviewed quarterly and after every SEV1 or SEV2 incident."],
  ["standards/incident-severity-levels", "Incident severity levels", "Definitions of SEV1 to SEV4 and the response each requires.",
    "SEV1: all customers cannot pay or validate, or data is being corrupted; page the owning team, platform on-call and, after 30 minutes, the CTO; status updates every 30 minutes; post-mortem mandatory within 5 working days. SEV2: a whole function, region or a large group of customers affected, or money wrong for many; page owning team and platform; updates hourly; post-mortem mandatory. SEV3: degradation with a workaround or partner-only impact; ticket, fix in business hours; post-mortem optional. SEV4: internal impact only; no page. Severity can be raised at any time and lowered only with a written rationale."],
  ["standards/on-call-policy", "On-call policy", "Rotations, response times, compensation and handover rules for on-call engineers.",
    "Every product team runs a weekly rotation with a primary and a secondary; platform runs 24/7; data runs business hours (an open question tracks the gap). Response time: acknowledge within 5 minutes, first update within 15. On-call engineers do not deploy outside the fast-track path during their shift. Handover is written: open incidents, risky changes, upcoming events. Compensation follows the company agreement: a flat weekly allowance plus hourly pay for interventions and time off in lieu after night interventions."],
  ["standards/data-contract-versioning", "Data contract versioning", "Rules for evolving Kafka topics and REST APIs without breaking consumers.",
    "Kafka: Avro schemas in the registry; BACKWARD compatibility by default, FULL for commands; a breaking change is a new topic with the next major (v1 to v2) and the old topic is kept for 6 months with a migration owner. REST: major version in the URL path; additive changes only within a major; a deprecated major carries a Sunset header and lives 12 months. Every contract has an owner team, a documented retention and a personal data section. Schemas are registered from CI, never by hand."],
  ["standards/service-naming", "Service and topic naming", "Naming conventions for services, repositories, topics, flags and dashboards.",
    "Services are lower-case hyphenated nouns describing the capability (fare-engine, not pricing-svc). Repositories: <team>/<service>. Topics: <domain>.<entity>.<version>, domains: ticketing, payments, identity, mobility, risk, platform. Feature flags: <service>.<feature>; kill switches: kill.<service>.<feature>. Dashboards: <service>/<aspect>. PagerDuty rotations: <team>-oncall."],
  ["standards/security-baseline", "Security baseline", "Minimum security controls for every service: identity, secrets, transport, data, supply chain.",
    "All service-to-service calls carry a workload identity; no shared API keys. Secrets live in the secrets manager with rotation schedules (PSP quarterly, database annually, fleet CA every three years with an exercise annually). TLS everywhere, mutual TLS for devices. Personal data is minimised on the bus: account ids only, fiscal codes and names stay in identity-service. Dependencies are scanned daily; critical vulnerabilities patched within 7 days. PCI DSS scope is limited to the hosted payment page and validator firmware."],
  ["standards/deprecation-policy", "Deprecation policy", "How services, contracts and runbooks are deprecated and removed from the catalog.",
    "A deprecated concept keeps its page with status deprecated, a stale_after date and a pointer to its replacement; it is removed only after the replacement has run for one full quarter. Deprecated runbooks state in the first line what to do instead. Deprecated topics keep a bridge for at most 6 months. The catalog report lists deprecated concepts older than their stale_after date for the architecture meeting."],
];
STANDARD_DOCS.forEach(([id, title, description, body]) => {
  concept(STANDARDS, Object.assign({ id, type: "Standard", title, description, lang: "en", tags: ["standard", "engineering", id.split("/")[1]] }, provenance("standard"), {
    sources: [SRC.wiki(id)],
    body: `# ${title}\n\n${body}\n`,
  }));
});

// ---------------------------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------------------------
function frontmatterFor(c) {
  const fm = { type: c.type, title: c.title, description: c.description, tags: c.tags };
  if (c.aliases && c.aliases.length) fm.aliases = c.aliases;
  fm.lang = c.lang;
  ["runtime", "channel", "format", "decided_on", "severity", "occurred_on", "version", "owner", "due"].forEach((k) => {
    if (c[k] !== undefined && c[k] !== null) fm[k] = c[k];
  });
  if (c.relations && c.relations.length) fm.relations = c.relations;
  if (c.sources && c.sources.length) fm.sources = c.sources;
  if (c.generated) fm.generated = c.generated;
  if (c.verified) fm.verified = c.verified;
  if (c.status) fm.status = c.status;
  if (c.stale_after) fm.stale_after = c.stale_after;
  return fm;
}

function writeBundle(bundleId, concepts) {
  const root = path.join(OUT, "bundles", bundleId);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const byType = new Map();
  concepts.forEach((c) => {
    const file = path.join(root, `${c.id}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = ["---", ...yamlLines(frontmatterFor(c), 0), "---", "", c.body.trimEnd(), ""].join("\n");
    fs.writeFileSync(file, text, "utf8");
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type).push(c);
  });
  const indexLines = ["---", 'okf_version: "0.2"', "---", "", `# ${bundleId === CATALOG ? "Atlas — architecture catalog of Tessera Mobilità S.p.A." : "Tessera engineering standards (shared, read-only)"}`, ""];
  if (bundleId === CATALOG) {
    indexLines.push("Services, data contracts, decisions, incidents, post-mortems, runbooks, dependencies, SLOs and open questions of the Tessera ticketing and mobility platform (Bologna). Generated by generate.js (seed 7); do not edit by hand.", "");
  } else {
    indexLines.push("Company-wide engineering standards referenced by every team's catalog. Read-only for product teams.", "");
  }
  Array.from(byType.keys()).sort().forEach((type) => {
    indexLines.push(`## ${type}`, "");
    byType.get(type).sort((a, b) => a.id.localeCompare(b.id)).forEach((c) => indexLines.push(`- [${c.title}](${c.id}.md)`));
    indexLines.push("");
  });
  fs.writeFileSync(path.join(root, "index.md"), indexLines.join("\n"), "utf8");
  return { root, count: concepts.length, byType: Object.fromEntries(Array.from(byType.entries()).map(([k, v]) => [k, v.length])) };
}

const RELATION_TYPES = ["implements", "affects", "resolved_by", "measured_by", "measures", "documents", "documented_in", "runbook_for"];

function writeProject() {
  const text = [
    "project: tessera-atlas",
    "bundles:",
    `  - id: ${CATALOG}`,
    `    root: bundles/${CATALOG}`,
    '    include: ["*.md", "**/*.md"]',
    `  - id: ${STANDARDS}`,
    `    root: bundles/${STANDARDS}`,
    '    include: ["*.md", "**/*.md"]',
    "relationTypes:",
    ...RELATION_TYPES.map((t) => `  - ${t}`),
    "strictLinks: true",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "okf.project.yaml"), text, "utf8");
}

function summarizeProvenance(all) {
  const s = { total: all.length, status: {}, verified: 0, humanVerified: 0, withSources: 0, staleAfter: 0, stalePast: 0, lang: {} };
  all.forEach((c) => {
    const st = c.status || "stable";
    s.status[st] = (s.status[st] || 0) + 1;
    if (c.verified) { s.verified += 1; if (String(c.verified.by).startsWith("human:")) s.humanVerified += 1; }
    if (c.sources && c.sources.length) s.withSources += 1;
    if (c.stale_after) { s.staleAfter += 1; if (c.stale_after < TODAY) s.stalePast += 1; }
    s.lang[c.lang] = (s.lang[c.lang] || 0) + 1;
  });
  return s;
}

const summary = {
  out: OUT,
  seed: SEED,
  bundles: {
    [CATALOG]: writeBundle(CATALOG, bundles[CATALOG]),
    [STANDARDS]: writeBundle(STANDARDS, bundles[STANDARDS]),
  },
  provenance: summarizeProvenance(bundles[CATALOG].concat(bundles[STANDARDS])),
};
writeProject();
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
