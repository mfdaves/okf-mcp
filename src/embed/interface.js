"use strict";

// The embedder contract (docs/plan-1.0.md R-8). An embedder turns texts into
// fixed-size float vectors. Core ships one implementation (./openai.js); further
// implementations are separate packages loaded like producers and must pass
// validateEmbedder() before the host uses them. The contract is deliberately
// small: everything the cache and the receipts need, nothing vendor-specific.
//
// Required fields:
//
//   id             string   stable identity of the model as seen by the cache;
//                           a different id rebuilds every stored vector. It
//                           must cover everything that changes what a stored
//                           vector means: for the OpenAI client
//                           "openai:<endpoint>:<model>:<dimension>:<maxInputChars>".
//   dimension      integer  length of every vector returned by embed().
//   languages      string[] ISO 639-1 codes the model is known to cover; an
//                           empty array means "not declared" and disables
//                           language checks. Never used to pick a model.
//   remote         boolean  true whenever text leaves the machine (O-2). Only a
//                           loopback endpoint or an in-process model is local.
//   maxBatch       integer  largest number of texts one embed() call accepts
//                           (the host splits larger inputs at this size).
//   maxInputChars  integer  per-text truncation point the implementation applies
//                           before encoding, so callers can report truncation.
//   embed(texts, options?)  async; texts: string[] -> Promise<Float32Array[]>,
//                           same length and order as texts; every vector has
//                           `dimension` entries, all finite. Must never log or
//                           echo texts. options.signal aborts the call;
//                           options.concurrency caps the requests in flight
//                           inside the call (never above the implementation's
//                           own bound). One rule keeps the request count
//                           predictable: a host that runs several calls at
//                           once passes concurrency: 1, so the requests in
//                           flight equal the host's bound, never the product.
//                           options.skipRejected: true lets an implementation
//                           return null in place of the vector of an input
//                           the provider refuses (after any recovery of its
//                           own); a host that passes it records the unit as
//                           skipped. Without it, a refused input fails the call.
//
// Optional members:
//
//   concurrency    integer  parallel requests the implementation issues inside
//                           one embed() call (default 1); the host uses it to
//                           size the chunks it persists between calls.
//   usage()        sync     -> { requests, retries, promptTokens, totalTokens }
//                           cumulative counters since construction; the host
//                           reports the difference per run.
//   probe()        async    discovers `dimension` with one minimal request when
//                           the implementation cannot know it from configuration;
//                           a no-op once known. Callers must await it before
//                           opening a cache when `dimension` is null.
//
// Errors thrown by an implementation carry a short `code` and never contain
// input text, credentials, or URLs with credentials (B-6, S-2).

const EMBEDDER_INTERFACE_VERSION = 1;

const MAX_ID_LENGTH = 256;
const MAX_DIMENSION = 65536;
const MAX_LANGUAGE_LENGTH = 16;

class EmbedderError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "EmbedderError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function invalid(field, message) {
  return new EmbedderError(`Embedder ${field} ${message}.`, "invalid_embedder", { field });
}

function isPositiveInteger(value, max) {
  return Number.isSafeInteger(value) && value > 0 && value <= max;
}

function hasWhitespaceOrControl(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

// Checks the shape of a candidate implementation and returns it unchanged.
// Throws EmbedderError with code "invalid_embedder" and the offending field.
function validateEmbedder(candidate) {
  if (!candidate || typeof candidate !== "object") {
    throw new EmbedderError("Embedder must be an object.", "invalid_embedder", { field: null });
  }
  const { id, dimension, languages, remote, maxBatch, maxInputChars } = candidate;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    id.length > MAX_ID_LENGTH ||
    hasWhitespaceOrControl(id)
  ) {
    throw invalid("id", "must be a non-empty string without whitespace or control characters");
  }
  if (!isPositiveInteger(dimension, MAX_DIMENSION)) {
    throw invalid("dimension", `must be a positive integer up to ${MAX_DIMENSION}`);
  }
  if (
    !Array.isArray(languages) ||
    languages.some(
      (code) =>
        typeof code !== "string" ||
        !code ||
        code.length > MAX_LANGUAGE_LENGTH ||
        !/^[A-Za-z*][A-Za-z0-9-]*$/.test(code),
    )
  ) {
    throw invalid("languages", "must be an array of language codes");
  }
  if (typeof remote !== "boolean") {
    throw invalid("remote", "must be a boolean");
  }
  if (!isPositiveInteger(maxBatch, Number.MAX_SAFE_INTEGER)) {
    throw invalid("maxBatch", "must be a positive integer");
  }
  if (!isPositiveInteger(maxInputChars, Number.MAX_SAFE_INTEGER)) {
    throw invalid("maxInputChars", "must be a positive integer");
  }
  if (typeof candidate.embed !== "function") {
    throw invalid("embed", "must be a function");
  }
  if (
    candidate.concurrency !== undefined &&
    !isPositiveInteger(candidate.concurrency, Number.MAX_SAFE_INTEGER)
  ) {
    throw invalid("concurrency", "must be a positive integer when present");
  }
  for (const optional of ["usage", "probe"]) {
    if (candidate[optional] !== undefined && typeof candidate[optional] !== "function") {
      throw invalid(optional, "must be a function when present");
    }
  }
  return candidate;
}

// The part of an embedder that belongs in receipts (O-2): enough to explain
// where text went and which cache it keys, nothing that could hold a secret.
function describeEmbedder(embedder) {
  return {
    id: embedder.id,
    remote: embedder.remote === true,
    dimension: embedder.dimension,
  };
}

module.exports = {
  EMBEDDER_INTERFACE_VERSION,
  EmbedderError,
  describeEmbedder,
  validateEmbedder,
};
