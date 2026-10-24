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

module.exports = {
  UNIT_HASH_PATTERN,
  conceptUnitText,
  conceptUnits,
  hashUnitText,
};
