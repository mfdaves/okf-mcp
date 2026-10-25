"use strict";

const crypto = require("node:crypto");

// A retrieval unit is the piece of text one vector stands for:
// { id, text, hash }. `id` is the locator a search result cites (a concept URI
// today, `uri#heading-slug` once WP3a lands sections), `text` is what gets
// embedded, and `hash` is the SHA-256 of `text` that keys the vector cache
// (R-9). prepareEmbeddings() takes the unit function as an option so the
// section-level units can replace these without touching the cache or the
// client.

const UNIT_HASH_PATTERN = /^[a-f0-9]{64}$/;

function hashUnitText(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

// Title, description and body joined by newlines. Reserved documents
// (index.md, log.md) are navigation, not knowledge, and stay out.
function conceptUnitText(doc) {
  return [doc.title, doc.description, doc.body]
    .map((part) => (typeof part === "string" ? part : ""))
    .join("\n");
}

function conceptUnits(index) {
  const documents = index?.documents || [];
  return documents
    .filter((doc) => doc?.kind === "concept" && !doc.reserved)
    .map((doc) => {
      const text = conceptUnitText(doc);
      return { id: doc.uri, text, hash: hashUnitText(text) };
    });
}

// Contextual units (WP3c-2): a bounded one-line prefix naming where a text sits in the catalog,
// "part · part · part", put before the text that is embedded. A bare section ("Steps", "Limits")
// carries no system context of its own; the prefix gives it its concept's title, type and path.
// Empty parts are dropped and whitespace runs collapse to one space. Longer than
// CONTEXT_PREFIX_MAX characters, the first part is shortened with "…" so the later ones (type
// and path) stay whole; if they alone do not fit, the whole prefix is cut. The contextual text
// has its own hash, so switching unit functions re-embeds once and plain units keep theirs.
const CONTEXT_PREFIX_MAX = 160;
const CONTEXT_SEPARATOR = " · ";
// Below this many characters a shortened first part says nothing; cut the whole prefix instead.
const MIN_FIRST_PART = 12;

// The first `length` UTF-16 units of `text`, never ending on half a surrogate pair.
function cut(text, length) {
  const end = Math.max(0, length);
  const code = text.charCodeAt(end - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end);
}

function contextPrefix(parts, max) {
  const limit = Number.isSafeInteger(max) && max > 1 ? max : CONTEXT_PREFIX_MAX;
  const clean = (parts || [])
    .map((part) =>
      String(part ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const whole = clean.join(CONTEXT_SEPARATOR);
  if (whole.length <= limit) return whole;
  if (clean.length > 1) {
    const rest = `${CONTEXT_SEPARATOR}${clean.slice(1).join(CONTEXT_SEPARATOR)}`;
    const room = limit - rest.length - 1;
    if (room >= MIN_FIRST_PART) return `${cut(clean[0], room).trimEnd()}…${rest}`;
  }
  return `${cut(whole, limit - 1).trimEnd()}…`;
}

// The concept text after a `type · path` prefix (the title already leads the concept text).
function contextualConceptUnits(index) {
  const documents = index?.documents || [];
  return documents
    .filter((doc) => doc?.kind === "concept" && !doc.reserved)
    .map((doc) => {
      const prefix = contextPrefix([doc.type, doc.path]);
      const body = conceptUnitText(doc);
      const text = prefix ? `${prefix}\n${body}` : body;
      return { id: doc.uri, text, hash: hashUnitText(text) };
    });
}

module.exports = {
  CONTEXT_PREFIX_MAX,
  UNIT_HASH_PATTERN,
  conceptUnitText,
  conceptUnits,
  contextPrefix,
  contextualConceptUnits,
  hashUnitText,
};
