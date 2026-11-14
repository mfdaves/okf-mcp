"use strict";

const { isDeepStrictEqual } = require("node:util");

const { isConfiguredGeneratorOutput } = require("../authoring");
const {
  conceptIsGeneratedFile,
  conceptMatchSummary,
  normalizeConceptTitle,
  recoverConceptLocator,
  resolveConcept,
} = require("../indexer");
const { validActor } = require("../v02");
const { hasOwn, isPlainObject } = require("./shared");

const MANAGED_METADATA_KEYS = new Set([
  "id",
  "type",
  "title",
  "description",
  "tags",
  "sources",
  "relations",
  "generated",
  "generated_file",
  "generatedFile",
  "runtime",
  "parameters",
  "computation",
  "executor",
  "attester",
]);

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeBody(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function exactKey(value) {
  return JSON.stringify(canonicalValue(value));
}

function uniqueStrings(values, field) {
  if (values === undefined) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error(`${field} must be an array.`);
  }
  const seen = new Set();
  const normalized = [];
  values.forEach((value, index) => {
    const item = nonEmptyString(value, `${field}[${index}]`);
    if (!seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  });
  return normalized;
}

function normalizeSource(value, field) {
  if (typeof value === "string") {
    return { resource: nonEmptyString(value, field) };
  }
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be a resource string or source object.`);
  }
  return Object.assign({}, value);
}

function sourceIdentity(source) {
  if (typeof source === "string" && source.trim()) {
    return `resource:${source.trim()}`;
  }
  if (isPlainObject(source) && typeof source.id === "string" && source.id.trim()) {
    return `id:${source.id.trim()}`;
  }
  if (isPlainObject(source) && typeof source.resource === "string" && source.resource.trim()) {
    return `resource:${source.resource.trim()}`;
  }
  return `exact:${exactKey(source)}`;
}

function sourceMatches(source, selector) {
  const sourceId = isPlainObject(source) && typeof source.id === "string" ? source.id.trim() : "";
  const sourceResource =
    typeof source === "string"
      ? source.trim()
      : isPlainObject(source) && typeof source.resource === "string"
        ? source.resource.trim()
        : "";
  if (typeof selector === "string") {
    const value = selector.trim();
    return sourceId === value || sourceResource === value;
  }
  if (!isPlainObject(selector)) {
    return false;
  }
  if (typeof selector.id === "string" && selector.id.trim()) {
    return sourceId === selector.id.trim();
  }
  if (typeof selector.resource === "string" && selector.resource.trim()) {
    return sourceResource === selector.resource.trim();
  }
  return false;
}

function validateSourceSelector(selector, field) {
  if (typeof selector === "string") {
    nonEmptyString(selector, field);
    return;
  }
  if (!isPlainObject(selector)) {
    throw new Error(`${field} must select a source by id or resource.`);
  }
  const hasId = typeof selector.id === "string" && selector.id.trim();
  const hasResource = typeof selector.resource === "string" && selector.resource.trim();
  if (!hasId && !hasResource) {
    throw new Error(`${field} must select a source by id or resource.`);
  }
}

function applySourcePatch(existing, patch, field) {
  if (!isPlainObject(patch)) {
    throw new Error(`${field} must be an object containing add and/or remove arrays.`);
  }
  const remove = patch.remove === undefined ? [] : patch.remove;
  if (!Array.isArray(remove)) {
    throw new Error(`${field}.remove must be an array.`);
  }
  remove.forEach((selector, index) =>
    validateSourceSelector(selector, `${field}.remove[${index}]`),
  );
  let result = Array.isArray(existing) ? existing.slice() : [];
  result = result.filter((source) => !remove.some((selector) => sourceMatches(source, selector)));
  const additions = patch.add === undefined ? [] : patch.add;
  if (!Array.isArray(additions)) {
    throw new Error(`${field}.add must be an array.`);
  }
  additions
    .map((source, index) => normalizeSource(source, `${field}.add[${index}]`))
    .forEach((source) => {
      const identity = sourceIdentity(source);
      const existingIndex = result.findIndex((candidate) => sourceIdentity(candidate) === identity);
      if (existingIndex === -1) {
        result.push(source);
      } else if (!isDeepStrictEqual(result[existingIndex], source)) {
        result[existingIndex] = source;
      }
    });
  const seen = new Set();
  return result.filter((source) => {
    const identity = sourceIdentity(source);
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

function relationParts(value) {
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/);
    return {
      type: parts.length > 1 ? parts.shift() : "related_to",
      target: parts.join(" ") || value.trim(),
    };
  }
  if (isPlainObject(value)) {
    return {
      type: String(value.type || value.kind || "related_to").trim(),
      target: String(value.target || value.to || "").trim(),
    };
  }
  return { type: "", target: "" };
}

function relationKey(value) {
  const relation = relationParts(value);
  return `${relation.type}\u0000${relation.target}`;
}

function normalizeRelation(value, field) {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const type = nonEmptyString(value.type, `${field}.type`);
  const target = nonEmptyString(value.target, `${field}.target`);
  const relation = { type, target };
  if (hasOwn(value, "label")) {
    relation.label = String(value.label);
  }
  if (hasOwn(value, "description")) {
    relation.description = String(value.description);
  }
  return relation;
}

function applyRelationPatch(existing, patch, field) {
  if (!isPlainObject(patch)) {
    throw new Error(`${field} must be an object containing add and/or remove arrays.`);
  }
  const remove = patch.remove === undefined ? [] : patch.remove;
  if (!Array.isArray(remove)) {
    throw new Error(`${field}.remove must be an array.`);
  }
  const removeKeys = new Set(
    remove.map((relation, index) =>
      relationKey(normalizeRelation(relation, `${field}.remove[${index}]`)),
    ),
  );
  let result = (Array.isArray(existing) ? existing : []).filter(
    (relation) => !removeKeys.has(relationKey(relation)),
  );
  const additions = patch.add === undefined ? [] : patch.add;
  if (!Array.isArray(additions)) {
    throw new Error(`${field}.add must be an array.`);
  }
  additions
    .map((relation, index) => normalizeRelation(relation, `${field}.add[${index}]`))
    .forEach((relation) => {
      const key = relationKey(relation);
      const existingIndex = result.findIndex((candidate) => relationKey(candidate) === key);
      if (existingIndex === -1) {
        result.push(relation);
      } else if (!isDeepStrictEqual(result[existingIndex], relation)) {
        result[existingIndex] = relation;
      }
    });
  const seen = new Set();
  return result.filter((relation) => {
    const key = relationKey(relation);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function applyTagPatch(existing, patch, field) {
  if (!isPlainObject(patch)) {
    throw new Error(`${field} must be an object containing add and/or remove arrays.`);
  }
  const additions = uniqueStrings(patch.add, `${field}.add`);
  const removals = new Set(uniqueStrings(patch.remove, `${field}.remove`));
  const seen = new Set();
  return (Array.isArray(existing) ? existing : [])
    .filter((tag) => !removals.has(tag))
    .concat(additions)
    .filter((tag) => {
      if (seen.has(tag)) {
        return false;
      }
      seen.add(tag);
      return true;
    });
}

function validateMetadata(metadata, field) {
  if (metadata === undefined) {
    return {};
  }
  if (!isPlainObject(metadata)) {
    throw new Error(`${field} must be an object.`);
  }
  Object.keys(metadata).forEach((key) => {
    if (MANAGED_METADATA_KEYS.has(key)) {
      throw new Error(`${field}.${key} is server-managed; use its dedicated field instead.`);
    }
  });
  return Object.assign({}, metadata);
}

function validateRemovalKeys(keys, field) {
  const values = uniqueStrings(keys, field);
  values.forEach((key) => {
    if (MANAGED_METADATA_KEYS.has(key)) {
      throw new Error(`${field} cannot remove server-managed field: ${key}`);
    }
  });
  return values;
}

function actorValue(value) {
  const actor = nonEmptyString(value, "actor");
  if (!validActor(actor)) {
    throw new Error("actor must use human:<id>, process:<id>, or provider/model syntax.");
  }
  return actor;
}

// Characters git trims from both ends of an ident and refuses an ident made
// only of: whitespace, control characters and . , : ; < > " \ '.
const GIT_IDENT_CRUD = /^[\s\p{Cc}.,:;<>"\\']*$/u;
const AUTHOR_EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

// Author data comes from a principal and must never fail or block a write:
// angle brackets and control characters are removed and surrounding
// whitespace trimmed; a name made only of what git refuses is dropped.
function authorName(value) {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[<>\p{Cc}]/gu, "")
    .trim()
    .slice(0, 256)
    .trim();
  return text && !GIT_IDENT_CRUD.test(text) ? text : null;
}

// The same cleaning for an email, kept only when it is a plausible address.
function authorEmail(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[<>\p{Cc}]/gu, "").trim();
  return text.length <= 256 && AUTHOR_EMAIL.test(text) ? text : null;
}

// The git author a batch is committed for: the cleaned `name` and `email`,
// each kept only when usable (a missing one falls back to the repository's
// configured identity), or null when neither is.
function authorValue(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const author = {};
  const name = authorName(value.name);
  const email = authorEmail(value.email);
  if (name) author.name = name;
  if (email) author.email = email;
  return Object.keys(author).length ? author : null;
}

function generatedOwners(document) {
  const owners = [];
  const generated = document && document.frontmatter && document.frontmatter.generated;
  if (isPlainObject(generated) && typeof generated.by === "string") {
    owners.push(generated.by);
  }
  const normalized = document && document.signals && document.signals.generated;
  if (isPlainObject(normalized) && typeof normalized.by === "string") {
    owners.push(normalized.by);
  }
  return owners;
}

function semanticConceptKey(type, title) {
  return `${String(type || "")}\u0000${normalizeConceptTitle(title)}`;
}

function conceptIsManaged(doc, project) {
  return (
    conceptIsGeneratedFile(doc) ||
    generatedOwners(doc).some((owner) => owner.startsWith("process:")) ||
    isConfiguredGeneratorOutput(project, doc && doc.absolutePath)
  );
}

function conceptConflictDetails(matches, project) {
  const candidates = matches.slice(0, 5).map((doc) => conceptMatchSummary(doc));
  const only = candidates.length === 1 ? candidates[0] : null;
  const generated = matches.length === 1 && conceptIsManaged(matches[0], project);
  const updateable = only && !generated && only.type !== "Attested Computation";
  return {
    reason: "same_type_title",
    candidates,
    omitted: Math.max(0, matches.length - candidates.length),
    recommendedOperation: updateable ? "update" : generated ? "change_generator" : "review",
    ...(updateable ? { retryWith: { op: "update", uri: only.uri } } : {}),
  };
}

function staleUpdateDetails(index, uri, bundle, project) {
  const recovery = recoverConceptLocator(index, uri, { bundle, limit: 5 });
  const only = recovery.candidates.length === 1 ? recovery.candidates[0] : null;
  const matched = only && resolveConcept(index, only.uri);
  if (only && (conceptIsManaged(matched, project) || only.type === "Attested Computation")) {
    delete recovery.retryWith;
    recovery.recommendedOperation =
      only.type === "Attested Computation" ? "review_computation_owner" : "change_generator";
  } else if (recovery.retryWith) {
    recovery.retryWith.op = "update";
    recovery.recommendedOperation = "update";
  }
  return { recovery };
}

module.exports = {
  MANAGED_METADATA_KEYS,
  actorValue,
  authorEmail,
  authorName,
  authorValue,
  applyRelationPatch,
  applySourcePatch,
  applyTagPatch,
  conceptConflictDetails,
  conceptIsManaged,
  nonEmptyString,
  normalizeBody,
  normalizeRelation,
  normalizeSource,
  relationKey,
  relationParts,
  semanticConceptKey,
  sourceIdentity,
  staleUpdateDetails,
  uniqueStrings,
  validateMetadata,
  validateRemovalKeys,
};
