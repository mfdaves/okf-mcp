"use strict";

// The embedding runtime behind hybrid search (docs/plan-1.0.md R-8 to R-10,
// O-2, O-3): one embedder, one vector cache, the fusion weight and the unit
// function, plus the lifecycle around them. Opening never throws: a missing
// key, an unreachable endpoint or an unusable cache directory leaves a
// degraded runtime whose searches run lexical-only and say why with a fixed
// code (B-6: no server-supplied text is ever carried). Queries are encoded
// through a small LRU; documents are embedded in the background (startup and
// after rebuilds) or right after a write batch (only the changed units).

const { performance } = require("node:perf_hooks");

const { openVectorCache, resolveCacheDir } = require("../cache/store");
const { EmbedderError, describeEmbedder, validateEmbedder } = require("../embed/interface");
const { OPENAI_SERVER_CODES, createOpenAiEmbedder } = require("../embed/openai");
const { prepareEmbeddings } = require("../embed/prepare");
const { DEFAULT_EMBED_UNITS, denseCoverage, resolveUnits, unitMemo } = require("./dense");
const {
  ADAPTIVE_ALPHA,
  adaptiveWeights,
  fusionAlphaSetting,
  fusionNormalization,
} = require("./fusion");
const { searchConcepts } = require("./query");

const QUERY_CACHE_SIZE = 256;
// A search must not hang on a slow endpoint: query encoding gets its own
// short deadline and one retry; after a failure, searches stay lexical-only
// for a cooldown instead of paying the deadline again on every call.
const QUERY_TIMEOUT_MS = 10000;
const QUERY_MAX_RETRIES = 1;
const PROBE_TIMEOUT_MS = 15000;
const FAILURE_COOLDOWN_MS = 30000;
const SYNC_RETRY_MS = 60000;
// Receipts list this many skipped unit ids; the count is always complete.
const SKIPPED_IDS_SHOWN = 5;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
// Options a caller of search() may not smuggle in: the runtime supplies them.
const RUNTIME_OPTIONS = ["queryVector", "vectorCache", "embedUnits"];

// Only our own constant codes and the enumerated server code survive.
function failureOf(error, fallback) {
  const code = typeof error?.code === "string" && CODE_PATTERN.test(error.code) ? error.code : null;
  const serverCode = error?.details?.serverCode;
  return {
    code: code || fallback || "embedder_failed",
    ...(OPENAI_SERVER_CODES.includes(serverCode) ? { serverCode } : {}),
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

// R-9: remote bundles stay lexical-only in 1.0, so their text is never sent
// to an embedder. One wrapper per runtime keeps the unit memo stable.
function localUnits(unitsOf) {
  return (index) => {
    const units = unitsOf(index);
    const remote = new Set(
      (index.bundles || []).filter((bundle) => bundle.remote).map((bundle) => bundle.id),
    );
    if (!remote.size) return units;
    return units.filter((unit) => {
      const anchor = unit.id.indexOf("#");
      const doc =
        index.byUri?.get(unit.id) ||
        (anchor === -1 ? null : index.byUri?.get(unit.id.slice(0, anchor)));
      return !doc || !remote.has(doc.bundle);
    });
  };
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new EmbedderError("Embedder probe timed out.", "embedder_timeout")),
      ms,
    );
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A query vector must match the cache before it is used or kept: same
// length, every value finite (a client that discovered another dimension,
// or a broken server, must not poison the query LRU).
function checkQueryVector(vector, dimension) {
  const length = vector && typeof vector.length === "number" ? vector.length : null;
  let finite = length !== null;
  for (let index = 0; finite && index < length; index += 1) {
    finite = Number.isFinite(vector[index]);
  }
  if (length !== dimension || !finite) {
    throw new EmbedderError(
      "The query vector does not match the vector cache.",
      "embedder_invalid_vector",
      { expected: dimension, received: length },
    );
  }
  return vector;
}

// { count, ids }: how many units the provider rejected (prepareEmbeddings
// `skipped`) and the first few of their ids, in id order.
function skippedSummary(skipped) {
  const list = Array.isArray(skipped) ? skipped : [];
  return { count: list.length, ids: list.slice(0, SKIPPED_IDS_SHOWN).map((entry) => entry.id) };
}

function usageOf(embedder) {
  const usage = typeof embedder?.usage === "function" ? embedder.usage() : null;
  return {
    promptTokens: Number.isFinite(usage?.promptTokens) ? usage.promptTokens : 0,
    requests: Number.isFinite(usage?.requests) ? usage.requests : 0,
  };
}

function usageDelta(before, after) {
  return {
    promptTokens: Math.max(0, after.promptTokens - before.promptTokens),
    requests: Math.max(0, after.requests - before.requests),
  };
}

// Embedders for the three roles. A configuration object builds three OpenAI
// clients (separate usage counters; queries get the short deadline); an
// embedder instance passed by a library caller serves all three.
function embeddersFor(spec, context) {
  if (spec && typeof spec.embed === "function") {
    return { documents: spec, writes: spec, queries: spec };
  }
  const options = Object.assign({}, spec || {});
  delete options.type;
  if (context.env) options.env = context.env;
  if (context.fetch) options.fetch = context.fetch;
  const timeoutMs = options.timeoutMs === undefined ? 60000 : options.timeoutMs;
  const maxRetries = options.maxRetries === undefined ? 5 : options.maxRetries;
  return {
    documents: createOpenAiEmbedder(options),
    writes: createOpenAiEmbedder(options),
    queries: createOpenAiEmbedder(
      Object.assign({}, options, {
        timeoutMs: Math.min(timeoutMs, QUERY_TIMEOUT_MS),
        maxRetries: Math.min(maxRetries, QUERY_MAX_RETRIES),
      }),
    ),
  };
}

class EmbeddingRuntime {
  constructor(settings, context) {
    const config = settings || {};
    this.context = context || {};
    this.alpha = fusionAlphaSetting(config.fusion?.alpha);
    this.adaptive = adaptiveWeights(config.fusion?.adaptive);
    this.normalization = fusionNormalization(config.fusion?.normalization);
    this.embedUnits =
      typeof config.embedUnits === "string" ? config.embedUnits : DEFAULT_EMBED_UNITS;
    this.units = null;
    this.embedders = null;
    this.cache = null;
    // openFailure is permanent for the process; queryFailure cools down.
    this.openFailure = null;
    this.queryFailure = null;
    this.queryFailedAt = 0;
    this.queryVectors = new Map();
    this.syncedIndex = null;
    this.syncing = null;
    this.syncingIndex = null;
    this.latestIndex = null;
    this.syncQueue = Promise.resolve();
    this.lastSync = null;
    this.syncError = null;
    this.syncFailedAt = 0;
    this.startup = null;
    this.now = this.context.now || Date.now;
  }

  // Builds the embedders, discovers the dimension when it is not configured,
  // validates the implementation and opens the cache outside the root.
  async open(settings) {
    const config = settings || {};
    try {
      this.units = localUnits(resolveUnits(config.embedUnits));
      this.embedders = embeddersFor(config.embedder, this.context);
      const documents = this.embedders.documents;
      if (!Number.isSafeInteger(documents.dimension)) {
        // The interface's order: probe() discovers the dimension before any
        // embed(). It takes no signal, so the wait is bounded here.
        if (typeof documents.probe === "function") {
          await withTimeout(documents.probe(), PROBE_TIMEOUT_MS);
        } else {
          await documents.embed(["okf-mcp"], { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        }
      }
      validateEmbedder(documents);
      const dir = resolveCacheDir({
        root: this.context.root,
        cacheDir: config.cacheDir,
        env: this.context.env,
      });
      this.cache = openVectorCache(dir, {
        embedderId: documents.id,
        dimension: documents.dimension,
        root: this.context.root,
      });
    } catch (error) {
      this.openFailure = failureOf(error, "embedder_unavailable");
    }
    return this;
  }

  get ready() {
    return Boolean(this.cache && this.embedders && !this.openFailure);
  }

  describe(failure) {
    const documents = this.embedders?.documents;
    const base = documents
      ? describeEmbedder(documents)
      : { id: null, remote: null, dimension: null };
    return Object.assign(base, { degraded: Boolean(failure) }, failure || {});
  }

  cacheReceipt() {
    const receipt = { rows: this.cache ? this.cache.size : 0 };
    // Local paths are an operator's concern: shown only to a writing server.
    if (this.context.write && this.cache) receipt.dir = this.cache.dir;
    return receipt;
  }

  usage() {
    const total = { promptTokens: 0, requests: 0 };
    const seen = new Set();
    Object.values(this.embedders || {}).forEach((embedder) => {
      if (seen.has(embedder)) return;
      seen.add(embedder);
      const usage = usageOf(embedder);
      total.promptTokens += usage.promptTokens;
      total.requests += usage.requests;
    });
    return total;
  }

  // The failure searches currently report, if any: a failed open, or a
  // query-encoding failure still inside its cooldown.
  currentFailure() {
    if (!this.ready) return this.openFailure || { code: "embedder_unavailable" };
    if (this.queryFailure && this.now() - this.queryFailedAt < FAILURE_COOLDOWN_MS) {
      return this.queryFailure;
    }
    return null;
  }

  async encodeQuery(text) {
    const key = String(text);
    const cached = this.queryVectors.get(key);
    if (cached) {
      this.queryVectors.delete(key);
      this.queryVectors.set(key, cached);
      return { vector: cached, cached: true };
    }
    const [raw] = await this.embedders.queries.embed([key], {
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      concurrency: 1,
    });
    const vector = checkQueryVector(raw, this.cache.dimension);
    this.queryVectors.set(key, vector);
    if (this.queryVectors.size > QUERY_CACHE_SIZE) {
      this.queryVectors.delete(this.queryVectors.keys().next().value);
    }
    return { vector, cached: false };
  }

  // searchConcepts with the dense side when it can run, lexical otherwise;
  // either way the response says which ran and why (O-2).
  async search(index, options) {
    const config = Object.assign({}, options || {});
    RUNTIME_OPTIONS.forEach((key) => {
      delete config[key];
    });
    const started = performance.now();
    const query = String(config.query || "").trim();
    let failure = null;
    let encoded = null;
    let encodingMs = 0;
    const usageBefore = this.embedders ? usageOf(this.embedders.queries) : null;
    const wanted = config.hybrid !== false && query !== "";
    if (wanted) {
      const current = this.currentFailure();
      if (current) {
        failure = this.ready ? Object.assign({}, current, { cooldown: true }) : current;
      } else if (!this.cache.size || !denseCoverage(index, this.cache, this.units).present) {
        failure = { code: "cache_empty" };
        this.scheduleSync(index);
      } else {
        this.scheduleSync(index);
        const encodeStarted = performance.now();
        try {
          encoded = await this.encodeQuery(query);
          this.queryFailure = null;
        } catch (error) {
          failure = failureOf(error);
          this.queryFailure = failure;
          this.queryFailedAt = this.now();
        }
        encodingMs = performance.now() - encodeStarted;
      }
    }
    const searchStarted = performance.now();
    const lexical = () => searchConcepts(index, Object.assign({}, config, { hybrid: false }));
    let response;
    if (encoded) {
      const hybridConfig = Object.assign({}, config, {
        hybrid: true,
        queryVector: encoded.vector,
        vectorCache: this.cache,
        embedUnits: this.units,
        alpha: config.alpha === undefined ? this.alpha : config.alpha,
        adaptiveAlpha: config.adaptiveAlpha || this.adaptive,
        fusionNormalization: config.fusionNormalization || this.normalization,
      });
      try {
        response = searchConcepts(index, hybridConfig);
      } catch (error) {
        // Any failure of the dense stage degrades to lexical; a problem with
        // the caller's own options throws again from the lexical run.
        failure = failureOf(error, "dense_failed");
        response = lexical();
      }
    } else {
      response = lexical();
    }
    const searchMs = performance.now() - searchStarted;
    const results = response.results;
    delete response.results;
    return Object.assign(response, {
      hybrid: response.hybrid === true,
      embedder: this.describe(failure),
      cache: this.cacheReceipt(),
      usage: usageBefore ? usageDelta(usageBefore, usageOf(this.embedders.queries)) : null,
      timings: {
        queryEncodingMs: round(encodingMs),
        searchMs: round(searchMs),
        totalMs: round(performance.now() - started),
      },
      results,
    });
  }

  // Embeds every unit of `index` the cache lacks and prunes rows no unit
  // uses (prepareEmbeddings). Runs one at a time; the receipt is kept.
  // Startup and background preparation and the incremental embedding of a
  // write batch share one queue, so a slow preparation never prunes rows a
  // later batch added. A preparation always works on the newest index the
  // runtime has seen when it starts: its prune keeps exactly that unit set.
  enqueue(task) {
    const run = this.syncQueue.then(task);
    this.syncQueue = run.catch(() => null);
    return run;
  }

  noteIndex(index) {
    if (index) this.latestIndex = index;
  }

  sync(index) {
    this.noteIndex(index);
    return this.enqueue(async () => {
      if (!this.ready) return null;
      const target = this.latestIndex || index;
      try {
        const receipt = await prepareEmbeddings(target, this.embedders.documents, this.cache, {
          units: (current) => unitMemo(current, this.units).units,
        });
        this.syncedIndex = target;
        this.syncError = null;
        this.syncFailedAt = 0;
        // WP3c-2: which unit set was prepared; after a switch of embedUnits the first
        // preparation embeds the new units once and prunes the old ones (embedded, pruned).
        this.lastSync = Object.assign(this.sanitize(receipt), { embedUnits: this.embedUnits });
        if (!this.startup) this.startup = this.lastSync;
        return this.lastSync;
      } catch (error) {
        this.syncError = failureOf(error, "embedding_sync_failed");
        this.syncFailedAt = this.now();
        if (!this.startup) this.startup = { failed: true, error: this.syncError };
        return null;
      }
    });
  }

  // Background sync for an index this runtime has not prepared yet, at most
  // once per index object and never while a failed sync is cooling down.
  scheduleSync(index) {
    if (!this.ready || index === this.syncedIndex || index === this.syncingIndex) return null;
    if (this.syncFailedAt > 0 && this.now() - this.syncFailedAt < SYNC_RETRY_MS) return null;
    this.syncingIndex = index;
    this.syncing = this.sync(index).finally(() => {
      if (this.syncingIndex === index) this.syncingIndex = null;
    });
    return this.syncing;
  }

  // After a write batch: embed only the units whose text is new relative to
  // the index before the batch and absent from the cache; one request per
  // batch when the inputs fit. Superseded rows are pruned by the next sync.
  embedChanged(previousIndex, index) {
    this.noteIndex(index);
    return this.enqueue(() => this.embedChangedNow(previousIndex, index));
  }

  async embedChangedNow(previousIndex, index) {
    if (!this.ready) {
      return {
        embedder: this.describe(this.currentFailure()),
        cache: this.cacheReceipt(),
        skipped: true,
      };
    }
    const started = performance.now();
    const writes = this.embedders.writes;
    const before = usageOf(writes);
    const previous = previousIndex ? unitMemo(previousIndex, this.units).hashes : new Set();
    const pending = new Map();
    unitMemo(index, this.units).units.forEach((unit) => {
      if (!previous.has(unit.hash) && !this.cache.has(unit.hash) && !pending.has(unit.hash)) {
        pending.set(unit.hash, unit);
      }
    });
    const queue = Array.from(pending.values());
    let embedded = 0;
    let failure = null;
    const skipped = [];
    try {
      for (let offset = 0; offset < queue.length; offset += writes.maxBatch) {
        const batch = queue.slice(offset, offset + writes.maxBatch);
        const vectors = await writes.embed(
          batch.map((unit) => unit.text),
          { concurrency: 1, skipRejected: true },
        );
        const rows = [];
        batch.forEach((unit, position) => {
          if (vectors[position] === null) {
            skipped.push({ id: unit.id, reason: "input_rejected" });
          } else {
            rows.push({ id: unit.id, hash: unit.hash, vector: vectors[position] });
          }
        });
        if (rows.length) await this.cache.putMany(rows);
        embedded += rows.length;
      }
    } catch (error) {
      failure = failureOf(error, "embedding_write_failed");
    }
    return {
      units: queue.length,
      embedded,
      skipped: skippedSummary(skipped),
      embedder: this.describe(failure),
      cache: this.cacheReceipt(),
      usage: usageDelta(before, usageOf(writes)),
      durationMs: round(performance.now() - started),
    };
  }

  sanitize(receipt) {
    const copy = Object.assign({}, receipt, {
      cache: Object.assign({}, receipt.cache),
      skipped: skippedSummary(receipt.skipped),
    });
    if (!this.context.write) delete copy.cache.dir;
    return copy;
  }

  status() {
    const failure = this.currentFailure();
    return {
      configured: true,
      available: this.ready && Boolean(this.cache?.size),
      alpha: this.alpha,
      ...(this.alpha === ADAPTIVE_ALPHA ? { adaptive: this.adaptive } : {}),
      normalization: this.normalization,
      embedUnits: this.embedUnits,
      embedder: this.describe(failure),
      cache: this.cacheReceipt(),
      // Units the provider rejected in the last preparation (count, first ids).
      skipped: this.lastSync?.skipped || skippedSummary([]),
      startup: this.startup,
      sync: {
        state: this.syncingIndex ? "running" : this.syncError ? "failed" : "idle",
        ...(this.syncError ? { error: this.syncError } : {}),
        last: this.lastSync,
      },
      usage: this.usage(),
    };
  }

  // Resolves once no background sync is pending (tests, orderly shutdown).
  async idle() {
    await this.syncQueue;
  }
}

// settings: { embedder, cacheDir, fusion: { alpha }, embedUnits } as parsed
// from trusted configuration (src/search/embedding-config.js), or with an
// embedder instance in place of the configuration object. context: { root,
// write, env, fetch, now }.
async function openEmbeddingRuntime(settings, context) {
  const runtime = new EmbeddingRuntime(settings, context);
  return runtime.open(settings);
}

module.exports = {
  EmbeddingRuntime,
  FAILURE_COOLDOWN_MS,
  QUERY_CACHE_SIZE,
  openEmbeddingRuntime,
};
