"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync: nodeSpawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");

const {
  deriveConceptPathSuggestion,
  isConfiguredGeneratorOutput,
  normalizeConceptPath,
  renderConceptMarkdown,
} = require("./authoring");
const {
  attachProject,
  buildIndex,
  bundleAllowsPath,
  conceptIsGeneratedFile,
  conceptMatchSummary,
  normalizeConceptTitle,
  recoverConceptLocator,
  resolveConcept,
  validateIndex,
} = require("./indexer");
const { validActor } = require("./v02");

const MAX_CHANGES = 100;
const MAX_COMMIT_MESSAGE_BYTES = 1024;
const MAX_EFFECT_ITEMS = 20;
const MAX_EFFECT_TEXT = 240;
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

class AuthoringPolicyError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "AuthoringPolicyError";
    if (code) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

class AuthoringOperationalError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthoringOperationalError";
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeBody(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
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
  const sourceId = isPlainObject(source) && typeof source.id === "string"
    ? source.id.trim()
    : "";
  const sourceResource = typeof source === "string"
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
  remove.forEach((selector, index) => validateSourceSelector(selector, `${field}.remove[${index}]`));
  let result = Array.isArray(existing) ? existing.slice() : [];
  result = result.filter((source) => !remove.some((selector) => sourceMatches(source, selector)));
  const additions = patch.add === undefined ? [] : patch.add;
  if (!Array.isArray(additions)) {
    throw new Error(`${field}.add must be an array.`);
  }
  additions.map((source, index) => normalizeSource(source, `${field}.add[${index}]`)).forEach((source) => {
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
  const removeKeys = new Set(remove.map((relation, index) => (
    relationKey(normalizeRelation(relation, `${field}.remove[${index}]`))
  )));
  let result = (Array.isArray(existing) ? existing : [])
    .filter((relation) => !removeKeys.has(relationKey(relation)));
  const additions = patch.add === undefined ? [] : patch.add;
  if (!Array.isArray(additions)) {
    throw new Error(`${field}.add must be an array.`);
  }
  additions.map((relation, index) => normalizeRelation(relation, `${field}.add[${index}]`)).forEach((relation) => {
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

function commandOutput(result) {
  return String((result && (result.stderr || result.stdout)) || "").trim().slice(0, 4000);
}

function commandFailure(result, fallback) {
  return commandOutput(result)
    || (result && result.error && result.error.message)
    || fallback;
}

function commandSucceeded(result) {
  return Boolean(result && !result.error && result.status === 0);
}

function revisionFor(text) {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function byteLength(text) {
  return Buffer.byteLength(String(text || ""), "utf8");
}

function sortedUnique(values) {
  return Array.from(new Set(values)).sort();
}

function boundedEffectList(values, project) {
  const normalized = project
    ? values.map(project)
    : sortedUnique(values).map(boundedEffectText);
  return {
    values: normalized.slice(0, MAX_EFFECT_ITEMS),
    omitted: Math.max(0, normalized.length - MAX_EFFECT_ITEMS),
  };
}

function boundedEffectText(value) {
  const text = String(value || "");
  return text.length > MAX_EFFECT_TEXT ? `${text.slice(0, MAX_EFFECT_TEXT - 1)}…` : text;
}

function relationEffectValue(value) {
  const parts = relationParts(value);
  const result = {
    type: boundedEffectText(parts.type),
    target: boundedEffectText(parts.target),
  };
  if (isPlainObject(value) && hasOwn(value, "label")) {
    result.label = boundedEffectText(value.label);
  }
  if (isPlainObject(value) && hasOwn(value, "description")) {
    result.description = boundedEffectText(value.description);
  }
  return result;
}

function collectionEffects(before, after, identity, project) {
  const previous = new Map((before || []).map((value) => [identity(value), value]));
  const next = new Map((after || []).map((value) => [identity(value), value]));
  const added = Array.from(next.keys()).filter((key) => !previous.has(key)).sort();
  const removed = Array.from(previous.keys()).filter((key) => !next.has(key)).sort();
  const updated = Array.from(next.keys()).filter((key) => (
      previous.has(key) && !isDeepStrictEqual(previous.get(key), next.get(key))
  )).sort();
  const effectList = (keys, values) => boundedEffectList(
    project ? keys.map((key) => values.get(key)) : keys,
    project,
  );
  return {
    added: effectList(added, next),
    removed: effectList(removed, previous),
    updated: effectList(updated, next),
  };
}

function metadataEffects(before, after) {
  const excluded = new Set(["tags", "sources", "relations", "generated"]);
  const keys = sortedUnique(Object.keys(before || {}).concat(Object.keys(after || {})))
    .filter((key) => !excluded.has(key));
  return {
    set: boundedEffectList(keys.filter((key) => hasOwn(after, key) && !isDeepStrictEqual(before[key], after[key]))),
    removed: boundedEffectList(keys.filter((key) => hasOwn(before, key) && !hasOwn(after, key))),
  };
}

function effectsForCandidate(candidate) {
  const before = candidate.op === "update" ? candidate.originalFrontmatter : {};
  const after = candidate.frontmatter;
  const tags = collectionEffects(before.tags, after.tags, (value) => String(value));
  const sources = collectionEffects(before.sources, after.sources, sourceIdentity);
  const relations = collectionEffects(before.relations, after.relations, relationKey, relationEffectValue);
  const metadata = metadataEffects(before, after);
  const bodyChanged = candidate.op === "create"
    ? true
    : normalizeBody(candidate.originalBody) !== normalizeBody(candidate.body);
  const changedFields = [];
  if (bodyChanged) changedFields.push("body");
  const hasEffect = (group) => group.values.length || group.omitted;
  if (hasEffect(tags.added) || hasEffect(tags.removed) || hasEffect(tags.updated)) changedFields.push("tags");
  if (hasEffect(sources.added) || hasEffect(sources.removed) || hasEffect(sources.updated)) changedFields.push("sources");
  if (hasEffect(relations.added) || hasEffect(relations.removed) || hasEffect(relations.updated)) changedFields.push("relations");
  if (hasEffect(metadata.set) || hasEffect(metadata.removed)) changedFields.push("metadata");
  return {
    changedFields,
    bodyChanged,
    tags,
    sources,
    relations,
    metadata,
    beforeRevision: candidate.baseRevision,
    afterRevision: candidate.publishedRevision,
    bytesBefore: candidate.originalText === undefined ? 0 : byteLength(candidate.originalText),
    bytesAfter: byteLength(candidate.markdown),
  };
}

function semanticConceptKey(type, title) {
  return `${String(type || "")}\u0000${normalizeConceptTitle(title)}`;
}

function conceptIsManaged(doc, project) {
  return conceptIsGeneratedFile(doc)
    || generatedOwners(doc).some((owner) => owner.startsWith("process:"))
    || isConfiguredGeneratorOutput(project, doc && doc.absolutePath);
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
  if (only && (conceptIsManaged(matched, project)
    || only.type === "Attested Computation")) {
    delete recovery.retryWith;
    recovery.recommendedOperation = only.type === "Attested Computation"
      ? "review_computation_owner"
      : "change_generator";
  } else if (recovery.retryWith) {
    recovery.retryWith.op = "update";
    recovery.recommendedOperation = "update";
  }
  return { recovery };
}

function policyCode(message) {
  const text = String(message || "");
  if (/generated|generator/i.test(text)) return "generated_owner_protected";
  if (/Attested Computation|computation contract/i.test(text)) return "computation_authoring_prohibited";
  if (/excluded by the bundle policy/i.test(text)) return "excluded_target";
  if (/no effective changes/i.test(text)) return "no_effective_changes";
  if (/same concept more than once/i.test(text)) return "duplicate_batch_target";
  if (/already exists/i.test(text)) return "target_exists";
  if (/unknown valid OKF concept/i.test(text)) return "concept_not_found";
  if (/server-managed/i.test(text)) return "managed_metadata_protected";
  if (/1 through \d+ operations/i.test(text)) return "invalid_batch_size";
  if (/outside|travers|safe relative|unsafe segment|reserved index|reserved .*file|Markdown file|Markdown path/i.test(text)) return "unsafe_target_path";
  if (/worktree must be completely clean/i.test(text)) return "git_worktree_dirty";
  if (/Git filter attributes|repository-configured filters/i.test(text)) return "git_filter_attribute_unsupported";
  if (/assume-unchanged|skip-worktree|Git index flags/i.test(text)) return "git_index_flag_unsupported";
  if (/detached HEAD|symbolic branch|checked-out Git ref/i.test(text)) return "git_head_ref_unsupported";
  if (/Git user\.(name|email)/i.test(text)) return "git_identity_missing";
  if (/must have an existing HEAD/i.test(text)) return "git_head_missing";
  if (/commit message/i.test(text)) return "invalid_commit_message";
  return "authoring_policy_rejected";
}

function policyValidation(error) {
  const message = error && error.message ? error.message : String(error);
  const code = error && error.code || policyCode(message);
  const details = error && error.details;
  const diagnostic = {
    code,
    severity: "error",
    layer: "authoring",
    message,
    ...(details !== undefined ? { details } : {}),
  };
  return {
    valid: false,
    conformant: false,
    validForProject: false,
    diagnostics: [diagnostic],
    errors: [{ code, message, ...(details !== undefined ? { details } : {}) }],
    warnings: [],
  };
}

function temporaryPath(target) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
}

function restoreFile(target, text, mode) {
  const temporary = temporaryPath(target);
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    if (mode !== null && mode !== undefined) {
      fs.chmodSync(temporary, mode);
    }
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

class LiveAuthoringService {
  constructor(store, options) {
    const config = options || {};
    this.store = store;
    this.actor = actorValue(config.actor);
    this.gitCommit = Boolean(config.gitCommit);
    this.spawnSync = config.spawnSync || nodeSpawnSync;
    this.now = config.now || (() => new Date());
  }

  getBundle(id) {
    const bundles = this.store.getBundles();
    const bundle = id
      ? bundles.find((entry) => entry.id === id)
      : bundles.length === 1
        ? bundles[0]
        : null;
    if (!bundle) {
      throw new Error(id
        ? `Unknown writable OKF bundle: ${id}`
        : "A bundle id is required unless exactly one writable OKF root is configured.");
    }
    return bundle;
  }

  buildIndex(additionalBundles, documentOverrides) {
    const index = buildIndex(this.store.getBundles().concat(additionalBundles || []), {
      relationTypes: this.store.getRelationTypes(),
      strictLinks: this.store.strictLinks,
      allowCustomRelationTypes: this.store.allowCustomRelationTypes,
      documentOverrides,
    });
    return this.store.project ? attachProject(index, this.store.project) : index;
  }

  assertWritableTarget(bundle, conceptPath, existing) {
    const target = this.store.resolveConceptFile(bundle.id, conceptPath);
    if (isConfiguredGeneratorOutput(this.store.project, target.absolutePath)) {
      throw new Error(`Concept is inside a configured generator output and must be changed through its generator: ${conceptPath}`);
    }
    if (existing && conceptIsManaged(existing, this.store.project)) {
      throw new Error(`Generated concept must be changed through its generator: ${existing.uri}`);
    }
    return target;
  }

  createCandidate(change, bundle, currentIndex, generated) {
    const type = nonEmptyString(change.type, "changes[].type");
    if (type === "Attested Computation") {
      throw new Error("Live concept authoring cannot create Attested Computation contracts.");
    }
    const title = nonEmptyString(change.title, "changes[].title");
    const conceptPath = normalizeConceptPath(
      change.path || deriveConceptPathSuggestion(currentIndex, bundle, { type, title }).path,
    );
    if (!bundleAllowsPath(bundle, conceptPath)) {
      throw new Error(`Concept path is excluded by the bundle policy: ${conceptPath}`);
    }
    const target = this.assertWritableTarget(bundle, conceptPath, null);
    if (fs.existsSync(target.absolutePath)) {
      throw new Error(`Concept file already exists: ${conceptPath}`);
    }
    const metadata = validateMetadata(change.metadata, "changes[].metadata");
    const frontmatter = Object.assign({ type, title }, metadata);
    if (hasOwn(change, "description")) {
      frontmatter.description = String(change.description);
    }
    const tags = uniqueStrings(change.tags, "changes[].tags");
    if (change.sources !== undefined && !Array.isArray(change.sources)) {
      throw new Error("changes[].sources must be an array.");
    }
    if (change.relations !== undefined && !Array.isArray(change.relations)) {
      throw new Error("changes[].relations must be an array.");
    }
    const sources = (change.sources || [])
      .map((source, index) => normalizeSource(source, `changes[].sources[${index}]`));
    const relations = (change.relations || [])
      .map((relation, index) => normalizeRelation(relation, `changes[].relations[${index}]`));
    if (tags.length) frontmatter.tags = tags;
    if (sources.length) frontmatter.sources = applySourcePatch([], { add: sources }, "changes[].sources");
    if (relations.length) frontmatter.relations = applyRelationPatch([], { add: relations }, "changes[].relations");
    frontmatter.generated = generated;
    const body = hasOwn(change, "body") ? String(change.body || "") : `# ${title}`;
    const markdown = renderConceptMarkdown({ path: conceptPath, frontmatter, body });
    return {
      op: "create",
      bundle: bundle.id,
      path: conceptPath,
      uri: `okf://${bundle.id}/${conceptPath.replace(/\.md$/i, "")}`,
      title,
      frontmatter,
      body,
      markdown,
      target,
      baseRevision: null,
      publishedRevision: revisionFor(markdown),
      originalFrontmatter: {},
      originalBody: "",
    };
  }

  updateCandidate(change, bundle, currentIndex, generated) {
    const uri = nonEmptyString(change.uri, "changes[].uri");
    const existing = resolveConcept(currentIndex, uri);
    if (!existing || !existing.valid || existing.reserved) {
      const details = staleUpdateDetails(currentIndex, uri, bundle.id, this.store.project);
      throw new AuthoringPolicyError(
        `Unknown valid OKF concept: ${uri}`,
        details.recovery.status === "ambiguous" ? "concept_locator_ambiguous" : "concept_not_found",
        details,
      );
    }
    if (existing.bundle !== bundle.id) {
      throw new Error(`All changes must target writable bundle ${bundle.id}: ${uri}`);
    }
    if (existing.type === "Attested Computation") {
      throw new Error("Live concept authoring cannot modify Attested Computation contracts or code.");
    }
    const target = this.assertWritableTarget(bundle, existing.path, existing);
    const originalText = fs.readFileSync(target.absolutePath, "utf8");
    const originalMode = fs.statSync(target.absolutePath).mode;
    const indexedRevision = revisionFor(existing.text);
    const diskRevision = revisionFor(originalText);
    if (indexedRevision !== diskRevision) {
      throw new Error(`Concept changed after it was indexed; retry the update: ${existing.uri}`);
    }
    const frontmatter = Object.assign({}, existing.frontmatter);
    Object.assign(frontmatter, validateMetadata(change.metadata, "changes[].metadata"));
    validateRemovalKeys(change.removeMetadataKeys, "changes[].removeMetadataKeys").forEach((key) => {
      delete frontmatter[key];
    });
    if (hasOwn(change, "title")) {
      frontmatter.title = nonEmptyString(change.title, "changes[].title");
    }
    if (hasOwn(change, "description")) {
      frontmatter.description = String(change.description);
    }
    if (hasOwn(change, "tags")) {
      frontmatter.tags = applyTagPatch(frontmatter.tags, change.tags, "changes[].tags");
    }
    if (hasOwn(change, "sources")) {
      frontmatter.sources = applySourcePatch(frontmatter.sources, change.sources, "changes[].sources");
    }
    if (hasOwn(change, "relations")) {
      frontmatter.relations = applyRelationPatch(frontmatter.relations, change.relations, "changes[].relations");
    }
    const body = hasOwn(change, "body") ? String(change.body || "") : existing.body;
    if (isDeepStrictEqual(frontmatter, existing.frontmatter)
      && normalizeBody(body) === normalizeBody(existing.body)) {
      throw new Error(`Update has no effective changes: ${existing.uri}`);
    }
    frontmatter.generated = Object.assign(
      {},
      isPlainObject(existing.frontmatter.generated) ? existing.frontmatter.generated : {},
      generated,
    );
    const markdown = renderConceptMarkdown({ path: existing.path, frontmatter, body });
    return {
      op: "update",
      bundle: bundle.id,
      path: existing.path,
      uri: existing.uri,
      title: frontmatter.title || existing.title,
      frontmatter,
      body,
      markdown,
      target,
      baseRevision: diskRevision,
      publishedRevision: revisionFor(markdown),
      originalText,
      originalMode,
      originalFrontmatter: Object.assign({}, existing.frontmatter),
      originalBody: existing.body,
    };
  }

  validationResult(index, candidates) {
    const validation = validateIndex(index);
    const candidateDiagnostics = [];
    candidates.forEach((candidate) => {
      const document = index.byPathUri.get(`okf://${candidate.bundle}/${candidate.path}`);
      if (!document || document.reserved || !document.valid) {
        candidateDiagnostics.push({
          code: "candidate_not_indexed",
          severity: "error",
          layer: "project",
          bundle: candidate.bundle,
          path: candidate.path,
          message: "Candidate did not become a valid concept in the future graph.",
        });
        return;
      }
      (document.warnings || []).filter((entry) => entry.layer === "v0.2").forEach((entry) => {
        candidateDiagnostics.push(Object.assign({}, entry, {
          severity: "error",
          bundle: candidate.bundle,
          path: candidate.path,
        }));
      });
    });
    const diagnostics = validation.diagnostics.concat(candidateDiagnostics);
    return {
      valid: validation.valid && candidateDiagnostics.length === 0,
      conformant: validation.conformant,
      validForProject: validation.validForProject && candidateDiagnostics.length === 0,
      diagnostics,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  runGit(directory, args, options) {
    const environment = Object.assign({}, process.env);
    Object.keys(environment).filter((key) => key.startsWith("GIT_")).forEach((key) => {
      delete environment[key];
    });
    if (options && options.environment) {
      Object.assign(environment, options.environment);
    }
    environment.GIT_LITERAL_PATHSPECS = "1";
    environment.GIT_TERMINAL_PROMPT = "0";
    environment.GIT_PAGER = "cat";
    environment.GIT_NO_REPLACE_OBJECTS = "1";
    if (options && options.readOnly) {
      environment.GIT_OPTIONAL_LOCKS = "0";
    }
    const spawnOptions = {
      encoding: "utf8",
      shell: false,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15000,
      env: environment,
    };
    if (options && hasOwn(options, "input")) {
      spawnOptions.input = options.input;
    }
    try {
      return this.spawnSync("git", [
        "-C",
        directory,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "diff.external=",
      ].concat(args), spawnOptions);
    } catch (error) {
      return { status: null, stdout: "", stderr: "", error };
    }
  }

  readGitValue(repository, args, options) {
    const result = this.runGit(repository, args, options);
    return commandSucceeded(result) ? String(result.stdout || "").trim() : null;
  }

  activeGitFilterAttributes(repository, candidates) {
    const tracked = this.runGit(repository, ["ls-files", "-z"], { readOnly: true });
    if (!commandSucceeded(tracked)) {
      throw new AuthoringOperationalError(
        `Could not inspect tracked Git paths: ${commandFailure(tracked, "git ls-files failed")}`,
      );
    }
    const paths = sortedUnique(
      String(tracked.stdout || "").split("\0").filter(Boolean)
        .concat(this.repositoryFiles({ repository }, candidates)),
    );
    const active = [];
    for (let offset = 0; offset < paths.length; offset += 200) {
      const chunk = paths.slice(offset, offset + 200);
      const inspected = this.runGit(
        repository,
        ["check-attr", "-z", "--all", "--"].concat(chunk),
        { readOnly: true },
      );
      if (!commandSucceeded(inspected)) {
        throw new AuthoringOperationalError(
          `Could not inspect Git filter attributes: ${commandFailure(inspected, "git check-attr failed")}`,
        );
      }
      const values = String(inspected.stdout || "").split("\0");
      for (let index = 0; index + 2 < values.length; index += 3) {
        const attribute = values[index + 1];
        if (attribute === "filter") {
          active.push({ path: values[index], filter: values[index + 2] || "set" });
        }
      }
    }
    return active;
  }

  unsupportedGitIndexFlags(repository) {
    const inspected = this.runGit(repository, ["ls-files", "-v", "-z"], { readOnly: true });
    if (!commandSucceeded(inspected)) {
      throw new AuthoringOperationalError(
        `Could not inspect Git index flags: ${commandFailure(inspected, "git ls-files failed")}`,
      );
    }
    return String(inspected.stdout || "").split("\0").filter(Boolean).flatMap((entry) => {
      const tag = entry[0] || "";
      const flagged = tag === "S" || (/[a-z]/.test(tag) && tag === tag.toLowerCase());
      if (!flagged) {
        return [];
      }
      return [{
        path: entry.slice(2),
        flag: tag === "S" ? "skip-worktree" : "assume-unchanged",
      }];
    });
  }

  prepareGit(bundle, candidates) {
    const preflight = {
      enabled: this.gitCommit,
      repository: null,
      repositoryStatus: this.gitCommit ? "not_git_repository" : "not_inspected",
      repositoryRoot: null,
      headBefore: null,
      headRef: null,
      worktreeClean: null,
      identityConfigured: null,
      ready: !this.gitCommit,
      diagnostics: [],
    };
    if (!this.gitCommit) {
      return preflight;
    }
    const discovered = this.runGit(bundle.root, ["rev-parse", "--show-toplevel"], { readOnly: true });
    if (discovered.error) {
      if (this.gitCommit) {
        throw new AuthoringOperationalError(`Git executable is unavailable: ${discovered.error.message}`);
      }
      return Object.assign(preflight, {
        repositoryStatus: "unavailable",
        inspectionError: discovered.error.message,
      });
    }
    if (discovered.status !== 0) {
      const detail = commandOutput(discovered);
      if (/not a git repository/i.test(detail)) {
        preflight.ready = true;
        return preflight;
      }
      if (this.gitCommit) {
        throw new AuthoringOperationalError(`Could not inspect Git repository: ${detail || `git exited ${discovered.status}`}`);
      }
      return Object.assign(preflight, {
        repositoryStatus: "inspection_failed",
        inspectionError: detail || `git exited ${discovered.status}`,
      });
    }
    const repository = path.resolve(String(discovered.stdout || "").trim());
    preflight.repository = repository;
    preflight.repositoryRoot = repository;
    preflight.repositoryStatus = "detected";
    const symbolicHead = this.runGit(
      repository,
      ["symbolic-ref", "-q", "HEAD"],
      { readOnly: true },
    );
    if (symbolicHead.error || (symbolicHead.status !== 0 && symbolicHead.status !== 1)) {
      throw new AuthoringOperationalError(
        `Could not inspect the checked-out Git ref: ${commandFailure(symbolicHead, "git symbolic-ref failed")}`,
      );
    }
    const headRef = commandSucceeded(symbolicHead)
      ? String(symbolicHead.stdout || "").trim()
      : null;
    preflight.headRef = headRef;
    const headBefore = this.readGitValue(
      repository,
      ["rev-parse", "--verify", headRef || "HEAD"],
      { readOnly: true },
    );
    preflight.headBefore = headBefore;
    const missingIdentity = [];
    for (const key of ["user.name", "user.email"]) {
      const configured = this.runGit(repository, ["config", "--get", key], { readOnly: true });
      if (configured && configured.error) {
        throw new AuthoringOperationalError(
          `Could not inspect Git ${key}: ${configured.error.message}`,
        );
      }
      if (configured && configured.status !== 0 && configured.status !== 1) {
        throw new AuthoringOperationalError(
          `Could not inspect Git ${key}: ${commandFailure(configured, `git config exited ${configured.status}`)}`,
        );
      }
      if (!commandSucceeded(configured) || !String(configured.stdout || "").trim()) {
        missingIdentity.push(key);
      }
    }
    preflight.identityConfigured = missingIdentity.length === 0;
    const unsupportedIndexFlags = this.unsupportedGitIndexFlags(repository);
    preflight.unsupportedIndexFlags = unsupportedIndexFlags.slice(0, MAX_EFFECT_ITEMS);
    const activeFilters = this.activeGitFilterAttributes(repository, candidates);
    preflight.activeFilterAttributes = activeFilters.slice(0, MAX_EFFECT_ITEMS);
    if (!activeFilters.length && !unsupportedIndexFlags.length) {
      const status = this.runGit(
        repository,
        ["status", "--porcelain=v1", "--untracked-files=all"],
        { readOnly: true },
      );
      if (!commandSucceeded(status)) {
        throw new AuthoringOperationalError(
          `Could not inspect Git status: ${commandFailure(status, "git status failed")}`,
        );
      }
      preflight.worktreeClean = !String(status.stdout || "").trim();
    }
    preflight.ready = !this.gitCommit || Boolean(
      headBefore
      && headRef
      && preflight.worktreeClean
      && preflight.identityConfigured
      && !activeFilters.length
      && !unsupportedIndexFlags.length,
    );
    if (this.gitCommit && !headBefore) {
      preflight.diagnostics.push({
        code: "git_head_missing",
        message: "Git repository must have an existing HEAD before an automatic OKF commit.",
      });
    }
    if (this.gitCommit && headBefore && !headRef) {
      preflight.diagnostics.push({
        code: "git_detached_head_unsupported",
        message: "Automatic OKF commits require a checked-out symbolic branch; detached HEAD is not supported.",
      });
    }
    if (this.gitCommit && preflight.worktreeClean === false) {
      preflight.diagnostics.push({
        code: "git_worktree_dirty",
        message: "Git worktree must be completely clean before an automatic OKF commit.",
      });
    }
    if (this.gitCommit && missingIdentity.length) {
      preflight.diagnostics.push({
        code: "git_identity_missing",
        message: `Git ${missingIdentity[0]} must be configured before an automatic OKF commit.`,
      });
    }
    if (this.gitCommit && activeFilters.length) {
      preflight.diagnostics.push({
        code: "git_filter_attribute_unsupported",
        message: "Automatic OKF commits reject active Git filter attributes so validation cannot execute repository-configured filters and committed bytes remain exact.",
        paths: activeFilters.slice(0, MAX_EFFECT_ITEMS),
        omitted: Math.max(0, activeFilters.length - MAX_EFFECT_ITEMS),
      });
    }
    if (this.gitCommit && unsupportedIndexFlags.length) {
      preflight.diagnostics.push({
        code: "git_index_flag_unsupported",
        message: "Automatic OKF commits reject assume-unchanged and skip-worktree Git index flags because they can hide user changes from clean-worktree inspection.",
        paths: unsupportedIndexFlags.slice(0, MAX_EFFECT_ITEMS),
        omitted: Math.max(0, unsupportedIndexFlags.length - MAX_EFFECT_ITEMS),
      });
    }
    return preflight;
  }

  repositoryFiles(preflight, candidates) {
    const files = sortedUnique(candidates.map((candidate) => (
      path.relative(preflight.repository, candidate.target.absolutePath).replace(/\\/g, "/")
    )));
    if (files.some((file) => !file || file === ".." || file.startsWith("../") || path.isAbsolute(file))) {
      throw new AuthoringPolicyError("An affected concept path is outside the detected Git repository.");
    }
    return files;
  }

  inspectGitState(repository, revision, files) {
    const affected = this.runGit(repository, [
      "diff", "--no-ext-diff", "--cached", "--quiet", revision, "--",
    ].concat(files));
    const global = this.runGit(repository, [
      "diff", "--no-ext-diff", "--cached", "--quiet", revision, "--",
    ]);
    const worktree = this.runGit(repository, [
      "status", "--porcelain=v1", "-z", "--untracked-files=all", "--",
    ].concat(files));
    const state = (result) => {
      if (result && !result.error && result.status === 0) return "clean";
      if (result && !result.error && result.status === 1) return "dirty";
      return "unknown";
    };
    return {
      affectedIndexState: state(affected),
      indexState: state(global),
      affectedWorktreeState: !commandSucceeded(worktree)
        ? "unknown"
        : String(worktree.stdout || "").split("\0").filter(Boolean).some((entry) => (
          entry.startsWith("??") || entry.length > 1 && entry[1] !== " "
        )) ? "dirty" : "clean",
    };
  }

  classifyCommit(preflight, expectedTree) {
    const headAfter = this.readGitValue(
      preflight.repository,
      ["rev-parse", "--verify", preflight.headRef || "HEAD"],
    );
    if (!headAfter) {
      return { commitState: "unknown", committed: null, headAfter: null };
    }
    if (headAfter === preflight.headBefore) {
      return { commitState: "not_committed", committed: false, headAfter };
    }
    const treeAfter = this.readGitValue(preflight.repository, ["rev-parse", `${headAfter}^{tree}`]);
    const parentAfter = this.readGitValue(preflight.repository, ["rev-parse", `${headAfter}^`]);
    if (expectedTree && treeAfter === expectedTree && parentAfter === preflight.headBefore) {
      return {
        commitState: "committed",
        committed: true,
        commitSha: headAfter,
        headAfter,
        treeAfter,
      };
    }
    return {
      commitState: "unknown",
      committed: null,
      headAfter,
      treeAfter,
      parentAfter,
    };
  }

  inspectPublishedTargets(candidates) {
    const checks = candidates.map((candidate) => {
      try {
        const stat = fs.lstatSync(candidate.target.absolutePath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          return {
            path: candidate.path,
            absolutePath: candidate.target.absolutePath,
            expectedRevision: candidate.publishedRevision,
            observedState: "non_regular",
            observedRevision: null,
            matches: false,
          };
        }
        const observedRevision = revisionFor(fs.readFileSync(candidate.target.absolutePath));
        return {
          path: candidate.path,
          absolutePath: candidate.target.absolutePath,
          expectedRevision: candidate.publishedRevision,
          observedState: "regular",
          observedRevision,
          matches: observedRevision === candidate.publishedRevision,
        };
      } catch (error) {
        return {
          path: candidate.path,
          absolutePath: candidate.target.absolutePath,
          expectedRevision: candidate.publishedRevision,
          observedState: error && error.code === "ENOENT" ? "missing" : "unavailable",
          observedRevision: null,
          matches: false,
        };
      }
    });
    const conflicts = checks.filter((check) => !check.matches);
    return {
      targetState: conflicts.length ? "conflict" : "matching",
      validatedFilesPresent: conflicts.length === 0,
      targetChecks: checks,
      targetConflicts: conflicts,
    };
  }

  synchronizeCommittedIndex(preflight, classification, files) {
    const currentHeadRef = this.readGitValue(
      preflight.repository,
      ["symbolic-ref", "-q", "HEAD"],
    );
    if (!preflight.headRef || currentHeadRef !== preflight.headRef) {
      const inspected = this.inspectGitState(
        preflight.repository,
        classification.headAfter,
        files,
      );
      return Object.assign({
        indexSynchronization: "skipped_checkout_changed",
        checkoutState: "changed",
        currentHeadRef,
        indexSynchronizationError: "The checked-out Git ref changed before affected index paths could be synchronized.",
      }, inspected);
    }
    const indexPath = this.gitIndexPath(preflight.repository);
    const headPath = this.gitControlPath(preflight.repository, "HEAD");
    const branchPath = preflight.headRef
      ? this.gitControlPath(preflight.repository, preflight.headRef)
      : null;
    if (!indexPath || !headPath || !branchPath) {
      const inspected = this.inspectGitState(
        preflight.repository,
        classification.headAfter,
        files,
      );
      return Object.assign({
        indexSynchronization: "skipped_index_unavailable",
        indexSynchronizationError: "Could not resolve the Git index path.",
      }, inspected);
    }
    const lockPath = `${indexPath}.lock`;
    const headLockPath = `${headPath}.lock`;
    const branchLockPath = `${branchPath}.lock`;
    let lockDescriptor = null;
    let lockOwned = false;
    let headLockDescriptor = null;
    let headLockOwned = false;
    let branchLockDescriptor = null;
    let branchLockOwned = false;
    let attemptedLock = "index";
    let published = false;
    try {
      const indexStat = fs.statSync(indexPath);
      lockDescriptor = fs.openSync(lockPath, "wx", indexStat.mode & 0o777);
      lockOwned = true;
      fs.writeFileSync(lockDescriptor, fs.readFileSync(indexPath));
      fs.closeSync(lockDescriptor);
      lockDescriptor = null;
      attemptedLock = "checkout";
      headLockDescriptor = fs.openSync(headLockPath, "wx", 0o666);
      headLockOwned = true;
      fs.closeSync(headLockDescriptor);
      headLockDescriptor = null;
      attemptedLock = "branch";
      branchLockDescriptor = fs.openSync(branchLockPath, "wx", 0o666);
      branchLockOwned = true;
      fs.closeSync(branchLockDescriptor);
      branchLockDescriptor = null;
      const lockedHeadRef = this.readGitValue(
        preflight.repository,
        ["symbolic-ref", "-q", "HEAD"],
      );
      const lockedBranchHead = this.readGitValue(
        preflight.repository,
        ["rev-parse", "--verify", preflight.headRef],
      );
      if (lockedHeadRef !== preflight.headRef
        || lockedBranchHead !== classification.headAfter) {
        return {
          indexSynchronization: "skipped_checkout_changed",
          checkoutState: "changed",
          currentHeadRef: lockedHeadRef,
          currentBranchHead: lockedBranchHead,
          indexSynchronizationError: "The checked-out Git ref or its commit changed before affected index paths could be synchronized.",
          affectedIndexState: "unknown",
          indexState: "unknown",
          affectedWorktreeState: "unknown",
        };
      }
      const lockedIndex = { environment: { GIT_INDEX_FILE: lockPath } };
      const candidateIndexChanged = this.runGit(preflight.repository, [
        "diff", "--no-ext-diff", "--cached", "--quiet", preflight.headBefore, "--",
      ].concat(files), lockedIndex);
      if (!commandSucceeded(candidateIndexChanged)) {
        const inspected = this.inspectGitState(
          preflight.repository,
          classification.headAfter,
          files,
        );
        return Object.assign({
          indexSynchronization: candidateIndexChanged && !candidateIndexChanged.error
            && candidateIndexChanged.status === 1
            ? "skipped_affected_index_changed"
            : "skipped_index_unavailable",
          indexSynchronizationError: candidateIndexChanged && !candidateIndexChanged.error
            && candidateIndexChanged.status === 1
            ? "Affected Git index entries changed after preflight and were preserved."
            : commandFailure(candidateIndexChanged, "Could not verify affected Git index entries."),
        }, inspected);
      }
      const reset = this.runGit(preflight.repository, [
        "reset", "--quiet", classification.headAfter, "--",
      ].concat(files), lockedIndex);
      if (!commandSucceeded(reset)) {
        const inspected = this.inspectGitState(
          preflight.repository,
          classification.headAfter,
          files,
        );
        return Object.assign({
          indexSynchronization: "failed",
          indexSynchronizationError: commandFailure(reset, "Could not synchronize committed index paths."),
        }, inspected);
      }
      const verified = this.runGit(preflight.repository, [
        "diff", "--no-ext-diff", "--cached", "--quiet", classification.headAfter, "--",
      ].concat(files), lockedIndex);
      if (!commandSucceeded(verified)) {
        const inspected = this.inspectGitState(
          preflight.repository,
          classification.headAfter,
          files,
        );
        return Object.assign({
          indexSynchronization: "failed_verification",
          indexSynchronizationError: commandFailure(verified, "Synchronized index verification failed."),
        }, inspected);
      }
      fs.renameSync(lockPath, indexPath);
      published = true;
      return Object.assign({
        indexSynchronization: "synchronized",
      }, this.inspectGitState(preflight.repository, classification.headAfter, files));
    } catch (error) {
      const inspected = this.inspectGitState(
        preflight.repository,
        classification.headAfter,
        files,
      );
      return Object.assign({
        indexSynchronization: error && error.code === "EEXIST"
          ? attemptedLock === "index"
            ? "skipped_index_locked"
            : attemptedLock === "checkout"
              ? "skipped_checkout_locked"
              : "skipped_branch_locked"
          : "failed",
        indexSynchronizationError: error && error.code === "EEXIST"
          ? `The Git ${attemptedLock} state is locked by another writer; its state was preserved.`
          : error && error.message ? error.message : String(error),
      }, inspected);
    } finally {
      if (lockDescriptor !== null) {
        try {
          fs.closeSync(lockDescriptor);
        } catch {
          // Best-effort descriptor cleanup after a failed synchronization.
        }
      }
      if (headLockDescriptor !== null) {
        try {
          fs.closeSync(headLockDescriptor);
        } catch {
          // Best-effort descriptor cleanup after a failed synchronization.
        }
      }
      if (branchLockDescriptor !== null) {
        try {
          fs.closeSync(branchLockDescriptor);
        } catch {
          // Best-effort descriptor cleanup after a failed synchronization.
        }
      }
      if (lockOwned && !published) {
        for (const target of [lockPath, `${lockPath}.lock`]) {
          try {
            fs.unlinkSync(target);
          } catch (error) {
            if (!error || error.code !== "ENOENT") {
              // The index itself remains untouched; the receipt reports synchronization failure.
            }
          }
        }
      }
      for (const [owned, target] of [
        [branchLockOwned, branchLockPath],
        [headLockOwned, headLockPath],
      ]) {
        if (!owned) continue;
        try {
          fs.unlinkSync(target);
        } catch (error) {
          if (!error || error.code !== "ENOENT") {
            // The receipt already reports the synchronization outcome.
          }
        }
      }
    }
  }

  finalizeGitFailure(preflight, files, failure, expectedTree, candidates) {
    const classification = this.classifyCommit(preflight, expectedTree);
    if (classification.committed === true) {
      const synchronized = this.synchronizeCommittedIndex(preflight, classification, files);
      const targets = this.inspectPublishedTargets(candidates);
      return Object.assign({}, classification, {
        enabled: true,
        repository: true,
        repositoryRoot: preflight.repository,
        commitState: "observed_committed",
        persistence: "git_commit",
        warning: commandFailure(failure, "Git reported failure after the commit became visible."),
      }, synchronized, targets);
    }
    if (classification.committed === false) {
      const inspected = this.inspectGitState(preflight.repository, preflight.headBefore, files);
      const targets = this.inspectPublishedTargets(candidates);
      return Object.assign({
        enabled: true,
        repository: true,
        repositoryRoot: preflight.repository,
        committed: false,
        commitState: "not_committed",
        persistence: targets.validatedFilesPresent ? "working_tree" : "unknown",
        error: commandFailure(failure, "Git commit failed"),
      }, classification, inspected, targets);
    }
    const inspected = classification.headAfter
      ? this.inspectGitState(preflight.repository, classification.headAfter, files)
      : { affectedIndexState: "unknown", indexState: "unknown", affectedWorktreeState: "unknown" };
    const targets = this.inspectPublishedTargets(candidates);
    return Object.assign({
      enabled: true,
      repository: true,
      repositoryRoot: preflight.repository,
      committed: null,
      commitState: "unknown",
      persistence: "unknown",
      error: commandFailure(failure, "Git commit outcome could not be determined"),
    }, classification, inspected, targets);
  }

  gitControlPath(repository, name) {
    const controlPath = this.readGitValue(
      repository,
      ["rev-parse", "--git-path", name],
      { readOnly: true },
    );
    if (!controlPath) {
      return null;
    }
    return path.isAbsolute(controlPath)
      ? controlPath
      : path.resolve(repository, controlPath);
  }

  gitIndexPath(repository) {
    return this.gitControlPath(repository, "index");
  }

  temporaryGitIndex(repository) {
    const absoluteIndex = this.gitIndexPath(repository);
    return absoluteIndex
      ? `${absoluteIndex}.okf-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
      : null;
  }

  removeTemporaryGitIndex(indexPath) {
    [indexPath, `${indexPath}.lock`].forEach((target) => {
      try {
        fs.unlinkSync(target);
      } catch (error) {
        if (!error || error.code !== "ENOENT") {
          // A leftover isolated index is inert and must not obscure the commit result.
        }
      }
    });
  }

  buildValidatedGitTree(preflight, candidates, files) {
    const indexPath = this.temporaryGitIndex(preflight.repository);
    if (!indexPath) {
      return { failure: { status: 1, stderr: "Could not allocate an isolated Git index." } };
    }
    const isolated = { environment: { GIT_INDEX_FILE: indexPath } };
    try {
      const seeded = this.runGit(
        preflight.repository,
        ["read-tree", preflight.headBefore],
        isolated,
      );
      if (!commandSucceeded(seeded)) {
        return { failure: seeded };
      }
      for (const candidate of candidates) {
        const hashed = this.runGit(
          preflight.repository,
          ["hash-object", "-w", "--stdin"],
          { input: candidate.markdown },
        );
        if (!commandSucceeded(hashed)) {
          return { failure: hashed };
        }
        const objectId = String(hashed.stdout || "").trim();
        let mode = "100644";
        if (candidate.op === "update") {
          const relativePath = path.relative(
            preflight.repository,
            candidate.target.absolutePath,
          ).replace(/\\/g, "/");
          const seededEntry = this.runGit(preflight.repository, [
            "ls-files", "-s", "-z", "--", relativePath,
          ], isolated);
          if (!commandSucceeded(seededEntry)) {
            return { failure: seededEntry };
          }
          const match = String(seededEntry.stdout || "").match(/^([0-7]{6})\s/);
          if (!match) {
            return {
              failure: {
                status: 1,
                stderr: `Could not preserve the pinned Git tree mode for ${relativePath}.`,
              },
            };
          }
          mode = match[1];
        }
        const updated = this.runGit(preflight.repository, [
          "update-index",
          "--add",
          "--cacheinfo",
          mode,
          objectId,
          path.relative(preflight.repository, candidate.target.absolutePath).replace(/\\/g, "/"),
        ], isolated);
        if (!commandSucceeded(updated)) {
          return { failure: updated };
        }
      }
      const written = this.runGit(preflight.repository, ["write-tree"], isolated);
      if (!commandSucceeded(written)) {
        return { failure: written };
      }
      const expectedTree = String(written.stdout || "").trim();
      const changed = this.runGit(preflight.repository, [
        "diff", "--no-ext-diff", "--name-only", "-z",
        preflight.headBefore, expectedTree, "--",
      ]);
      const changedFiles = commandSucceeded(changed)
        ? String(changed.stdout || "").split("\0").filter(Boolean).sort()
        : null;
      if (!changedFiles || !isDeepStrictEqual(changedFiles, files.slice().sort())) {
        return {
          expectedTree,
          failure: {
            status: 1,
            stderr: commandSucceeded(changed)
              ? "The isolated Git tree did not exactly match the validated OKF batch paths."
              : commandFailure(changed, "Could not inspect the isolated Git tree."),
          },
        };
      }
      return { expectedTree };
    } finally {
      this.removeTemporaryGitIndex(indexPath);
    }
  }

  commitGit(preflight, candidates, message) {
    if (!preflight.enabled) {
      return {
        enabled: false,
        committed: false,
        commitState: "not_requested",
        repository: Boolean(preflight.repository),
        repositoryRoot: preflight.repository,
        persistence: "working_tree",
      };
    }
    if (!preflight.repository) {
      return {
        enabled: true,
        repository: false,
        repositoryRoot: null,
        committed: false,
        commitState: "not_repository",
        persistence: "working_tree",
        reason: "not_git_repository",
      };
    }
    const files = this.repositoryFiles(preflight, candidates);
    let expectedTree = null;
    try {
      const initialTargets = this.inspectPublishedTargets(candidates);
      if (!initialTargets.validatedFilesPresent) {
        return this.finalizeGitFailure(preflight, files, {
          status: 1,
          stderr: "A published concept changed before the Git commit tree was built.",
        }, null, candidates);
      }
      const built = this.buildValidatedGitTree(preflight, candidates, files);
      expectedTree = built.expectedTree || null;
      if (built.failure) {
        return this.finalizeGitFailure(
          preflight,
          files,
          built.failure,
          expectedTree,
          candidates,
        );
      }
      const verifiedTargets = this.inspectPublishedTargets(candidates);
      const headRefStillBefore = this.readGitValue(
        preflight.repository,
        ["symbolic-ref", "-q", "HEAD"],
      );
      const refStillBefore = this.readGitValue(
        preflight.repository,
        ["rev-parse", "--verify", preflight.headRef],
      );
      if (!verifiedTargets.validatedFilesPresent
        || headRefStillBefore !== preflight.headRef
        || refStillBefore !== preflight.headBefore) {
        return this.finalizeGitFailure(preflight, files, {
          status: 1,
          stderr: !verifiedTargets.validatedFilesPresent
            ? "A published concept changed before the Git ref update."
            : "The checked-out Git ref changed before the validated commit could be published.",
        }, expectedTree, candidates);
      }
      const committed = this.runGit(preflight.repository, [
        "commit-tree", expectedTree, "-p", preflight.headBefore, "-m", message,
      ]);
      if (!commandSucceeded(committed)) {
        return this.finalizeGitFailure(
          preflight,
          files,
          committed,
          expectedTree,
          candidates,
        );
      }
      const commitSha = String(committed.stdout || "").trim();
      const finalTargets = this.inspectPublishedTargets(candidates);
      if (!finalTargets.validatedFilesPresent) {
        return this.finalizeGitFailure(preflight, files, {
          status: 1,
          stderr: "A published concept changed before the validated commit was published.",
        }, expectedTree, candidates);
      }
      const updated = this.runGit(preflight.repository, [
        "update-ref", "-m", "okf-mcp live authoring",
        preflight.headRef, commitSha, preflight.headBefore,
      ]);
      const classification = this.classifyCommit(preflight, expectedTree);
      if (!commandSucceeded(updated) || classification.committed !== true) {
        return this.finalizeGitFailure(
          preflight,
          files,
          updated,
          expectedTree,
          candidates,
        );
      }
      const synchronized = this.synchronizeCommittedIndex(preflight, classification, files);
      const targets = this.inspectPublishedTargets(candidates);
      return Object.assign({
        enabled: true,
        repository: true,
        repositoryRoot: preflight.repository,
        committed: true,
        commitState: "committed",
        persistence: "git_commit",
      }, classification, synchronized, targets);
    } catch (error) {
      return this.finalizeGitFailure(
        preflight,
        files,
        { status: null, stdout: "", stderr: "", error },
        expectedTree,
        candidates,
      );
    }
  }

  defaultMessage(candidates) {
    if (candidates.length === 1) {
      return `docs(okf): ${candidates[0].op === "create" ? "add" : "update"} ${candidates[0].title}`;
    }
    return `docs(okf): apply ${candidates.length} concept changes`;
  }

  commitMessage(input, candidates) {
    if (hasOwn(input, "message") && typeof input.message !== "string") {
      throw new AuthoringPolicyError("Git commit message must be a string.");
    }
    const supplied = hasOwn(input, "message") ? input.message.trim() : "";
    const message = supplied || this.defaultMessage(candidates);
    if (message.includes("\0")) {
      throw new AuthoringPolicyError("Git commit message cannot contain NUL characters.");
    }
    if (byteLength(message) > MAX_COMMIT_MESSAGE_BYTES) {
      throw new AuthoringPolicyError(
        `Git commit message must not exceed ${MAX_COMMIT_MESSAGE_BYTES} UTF-8 bytes.`,
      );
    }
    return message;
  }

  ensureParentDirectories(candidate, createdDirectories) {
    const bundleRoot = this.store.resolveWritableBundleRoot(this.store.getBundle(candidate.bundle));
    const parent = path.dirname(candidate.target.absolutePath);
    const relative = path.relative(bundleRoot, parent);
    let current = bundleRoot;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (fs.existsSync(current)) {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error(`Concept parent is not a safe directory: ${current}`);
        }
        continue;
      }
      fs.mkdirSync(current);
      createdDirectories.push(current);
    }
  }

  cleanupDirectories(createdDirectories) {
    createdDirectories.slice().sort((left, right) => right.length - left.length).forEach((directory) => {
      try {
        fs.rmdirSync(directory);
      } catch (error) {
        if (!error || !["ENOENT", "ENOTEMPTY"].includes(error.code)) {
          throw error;
        }
      }
    });
  }

  stageCandidates(candidates) {
    const staged = [];
    const createdDirectories = [];
    try {
      candidates.forEach((candidate) => {
        this.ensureParentDirectories(candidate, createdDirectories);
        const temporary = temporaryPath(candidate.target.absolutePath);
        fs.writeFileSync(temporary, candidate.markdown, { encoding: "utf8", flag: "wx" });
        const stagedCandidate = Object.assign({}, candidate, { temporary });
        staged.push(stagedCandidate);
        if (candidate.op === "update") {
          fs.chmodSync(temporary, candidate.originalMode);
        }
      });
      return { staged, createdDirectories };
    } catch (error) {
      staged.forEach((entry) => {
        if (fs.existsSync(entry.temporary)) fs.unlinkSync(entry.temporary);
      });
      this.cleanupDirectories(createdDirectories);
      throw error;
    }
  }

  assertRevisions(staged) {
    staged.forEach((candidate) => {
      const exists = fs.existsSync(candidate.target.absolutePath);
      if (candidate.op === "create" && exists) {
        throw new Error(`Concept file appeared during batch preparation: ${candidate.path}`);
      }
      if (candidate.op === "update") {
        if (!exists) {
          throw new Error(`Concept file disappeared during batch preparation: ${candidate.path}`);
        }
        const currentRevision = revisionFor(fs.readFileSync(candidate.target.absolutePath));
        if (currentRevision !== candidate.baseRevision) {
          throw new Error(`Concept changed during batch preparation: ${candidate.path}`);
        }
      }
    });
  }

  inspectPublishedTarget(candidate) {
    try {
      const stat = fs.lstatSync(candidate.target.absolutePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return { state: "non_regular", revision: null };
      }
      return {
        state: "regular",
        revision: revisionFor(fs.readFileSync(candidate.target.absolutePath)),
      };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return { state: "missing", revision: null };
      }
      throw error;
    }
  }

  rollbackCandidate(candidate) {
    const inspected = this.inspectPublishedTarget(candidate);
    const receipt = {
      op: candidate.op,
      path: candidate.path,
      absolutePath: candidate.target.absolutePath,
      expectedPublishedRevision: candidate.publishedRevision,
      observedRevision: inspected.revision,
    };
    if (candidate.op === "create" && inspected.state === "missing") {
      return Object.assign(receipt, { status: "already_absent", restored: true });
    }
    if (inspected.state !== "regular" || inspected.revision !== candidate.publishedRevision) {
      return Object.assign(receipt, {
        status: "conflict",
        restored: false,
        observedState: inspected.state,
      });
    }
    if (candidate.op === "create") {
      fs.unlinkSync(candidate.target.absolutePath);
      return Object.assign(receipt, { status: "removed", restored: true });
    }
    restoreFile(candidate.target.absolutePath, candidate.originalText, candidate.originalMode);
    const restored = this.inspectPublishedTarget(candidate);
    if (restored.state !== "regular" || restored.revision !== candidate.baseRevision) {
      return Object.assign(receipt, {
        status: "restore_verification_failed",
        restored: false,
        restoredRevision: restored.revision,
      });
    }
    return Object.assign(receipt, {
      status: "restored",
      restored: true,
      restoredRevision: restored.revision,
    });
  }

  rollback(applied, staged, createdDirectories) {
    const failures = [];
    const outcomes = [];
    staged.forEach((candidate) => {
      if (fs.existsSync(candidate.temporary)) {
        try {
          fs.unlinkSync(candidate.temporary);
        } catch (error) {
          failures.push(error);
        }
      }
    });
    applied.slice().reverse().forEach((candidate) => {
      try {
        outcomes.push(this.rollbackCandidate(candidate));
      } catch (error) {
        const failure = {
          op: candidate.op,
          path: candidate.path,
          absolutePath: candidate.target.absolutePath,
          status: "error",
          restored: false,
          error: error && error.message ? error.message : String(error),
        };
        outcomes.push(failure);
        failures.push(failure);
      }
    });
    try {
      this.cleanupDirectories(createdDirectories || []);
    } catch (error) {
      failures.push({
        status: "directory_cleanup_error",
        error: error && error.message ? error.message : String(error),
      });
    }
    const conflicts = outcomes.filter((outcome) => !outcome.restored);
    return {
      complete: conflicts.length === 0 && failures.length === 0,
      outcomes,
      conflicts,
      failures,
    };
  }

  generatedStamp() {
    const timestampValue = this.now();
    return {
      by: this.actor,
      at: timestampValue instanceof Date
        ? timestampValue.toISOString()
        : new Date(timestampValue).toISOString(),
    };
  }

  targetReceipt(bundle, candidates, gitPreflight) {
    const bundleRoot = this.store.resolveWritableBundleRoot(bundle);
    const projectRoot = this.store.projectRoot
      ? path.resolve(this.store.projectRoot)
      : bundleRoot;
    return {
      bundle: bundle.id,
      bundleRoot,
      projectRoot,
      repositoryRoot: gitPreflight && gitPreflight.repositoryRoot
        ? gitPreflight.repositoryRoot
        : null,
      absolutePaths: candidates.map((candidate) => candidate.target.absolutePath),
    };
  }

  candidateSummaries(candidates) {
    return candidates.map((candidate) => ({
      op: candidate.op,
      bundle: candidate.bundle,
      path: candidate.path,
      absolutePath: candidate.target.absolutePath,
      uri: candidate.uri,
      title: candidate.title,
      baseRevision: candidate.baseRevision,
      candidateRevision: candidate.publishedRevision,
      effects: effectsForCandidate(candidate),
    }));
  }

  durabilityReceipt(git, filesChanged, stateOverride) {
    const persistence = git && git.persistence
      ? git.persistence
      : filesChanged ? "working_tree" : "none";
    return {
      state: stateOverride || (filesChanged
        ? git && ["committed", "observed_committed"].includes(git.commitState)
          ? "git_committed"
          : git && git.commitState === "unknown"
            ? "commit_state_unknown"
            : "filesystem_published_uncommitted"
        : "not_persisted"),
      filesChanged: Boolean(filesChanged),
      persistence,
      committed: git && hasOwn(git, "committed") ? git.committed : false,
      commitState: git && git.commitState ? git.commitState : "not_requested",
      affectedIndexState: git && git.affectedIndexState ? git.affectedIndexState : "not_inspected",
      indexState: git && git.indexState ? git.indexState : "not_inspected",
      crashDurable: false,
    };
  }

  snapshotReceipt(plan) {
    return {
      checkedAt: plan.generated.at,
      timeOfCheck: true,
      generatedBy: plan.generated.by,
      graphValidation: "future_overlay",
    };
  }

  preconditionsReceipt(plan) {
    return {
      allSatisfied: Boolean(plan.validation.valid && plan.gitPreflight.ready),
      revisions: plan.candidates.map((candidate) => ({
        path: candidate.path,
        absolutePath: candidate.target.absolutePath,
        baseRevision: candidate.baseRevision,
        candidateRevision: candidate.publishedRevision,
      })),
      git: {
        enabled: plan.gitPreflight.enabled,
        ready: plan.gitPreflight.ready,
        repositoryStatus: plan.gitPreflight.repositoryStatus,
        repositoryRoot: plan.gitPreflight.repositoryRoot,
        headBefore: plan.gitPreflight.headBefore,
        headRef: plan.gitPreflight.headRef,
        worktreeClean: plan.gitPreflight.worktreeClean,
        identityConfigured: plan.gitPreflight.identityConfigured,
        diagnostics: plan.gitPreflight.diagnostics,
      },
    };
  }

  planChanges(input, context) {
    if (!isPlainObject(input)) {
      throw new AuthoringPolicyError("okf_apply_changes requires an object argument.");
    }
    if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > MAX_CHANGES) {
      throw new AuthoringPolicyError(`changes must contain from 1 through ${MAX_CHANGES} operations.`);
    }
    let bundle;
    try {
      bundle = this.getBundle(input.bundle);
    } catch (error) {
      if (error && error.code) throw error;
      throw new AuthoringPolicyError(error && error.message ? error.message : String(error));
    }
    const generated = this.generatedStamp();
    const additionalBundles = context && Array.isArray(context.additionalBundles)
      ? context.additionalBundles
      : [];
    const currentIndex = this.buildIndex(additionalBundles);
    const candidates = input.changes.map((change, index) => {
      if (!isPlainObject(change)) {
        throw new AuthoringPolicyError(`changes[${index}] must be an object.`);
      }
      try {
        if (change.op === "create") {
          return this.createCandidate(change, bundle, currentIndex, generated);
        }
        if (change.op === "update") {
          return this.updateCandidate(change, bundle, currentIndex, generated);
        }
        throw new AuthoringPolicyError(`changes[${index}].op must be create or update.`);
      } catch (error) {
        if (error instanceof AuthoringPolicyError || error instanceof AuthoringOperationalError) {
          throw error;
        }
        if (error && error.code) throw error;
        throw new AuthoringPolicyError(error && error.message ? error.message : String(error));
      }
    });
    const targetPaths = new Set();
    candidates.forEach((candidate) => {
      const key = path.resolve(candidate.target.absolutePath);
      if (targetPaths.has(key)) {
        throw new AuthoringPolicyError(`A batch cannot target the same concept more than once: ${candidate.path}`);
      }
      targetPaths.add(key);
    });
    const absoluteTargets = Array.from(targetPaths);
    for (let left = 0; left < absoluteTargets.length; left += 1) {
      for (let right = left + 1; right < absoluteTargets.length; right += 1) {
        if (absoluteTargets[left].startsWith(`${absoluteTargets[right]}${path.sep}`)
          || absoluteTargets[right].startsWith(`${absoluteTargets[left]}${path.sep}`)) {
          throw new AuthoringPolicyError(
            "A batch cannot place one concept path underneath another concept file path.",
          );
        }
      }
    }
    const currentConcepts = currentIndex.concepts.filter((doc) => doc.bundle === bundle.id);
    const replacedPaths = new Set(candidates.filter((entry) => entry.op === "update").map((entry) => entry.path));
    const finalConcepts = currentConcepts.filter((doc) => !replacedPaths.has(doc.path)).concat(candidates);
    for (const candidate of candidates) {
      const key = semanticConceptKey(candidate.frontmatter.type, candidate.title);
      const before = currentConcepts.filter((doc) => semanticConceptKey(doc.type, doc.title) === key);
      const after = finalConcepts.filter((doc) => (
        semanticConceptKey(doc.type || doc.frontmatter.type, doc.title) === key
      ));
      if (after.length <= Math.max(1, before.length)) continue;
      const existing = after.filter((doc) => !candidates.includes(doc));
      const details = candidate.op === "create" && existing.length === 1 && after.length === 2
        ? conceptConflictDetails(existing, this.store.project)
        : {
          reason: before.length ? "same_type_title" : "same_batch_type_title",
          candidates: after.slice(0, 5).map((doc) => conceptMatchSummary(doc)),
          omitted: Math.max(0, after.length - 5),
          recommendedOperation: "merge_batch_changes",
        };
      throw new AuthoringPolicyError(
        `The batch would leave more than one ${candidate.frontmatter.type} titled "${candidate.title}".`,
        "concept_already_exists",
        details,
      );
    }
    const message = this.commitMessage(input, candidates);
    const overrides = new Map(candidates.map((candidate) => [
      `${candidate.bundle}\u0000${candidate.path}`,
      candidate.markdown,
    ]));
    const validation = this.validationResult(
      this.buildIndex(additionalBundles, overrides),
      candidates,
    );
    const gitPreflight = this.prepareGit(bundle, candidates);
    return {
      input,
      bundle,
      generated,
      additionalBundles,
      candidates,
      message,
      validation,
      gitPreflight,
      target: this.targetReceipt(bundle, candidates, gitPreflight),
      changes: this.candidateSummaries(candidates),
    };
  }

  validationReceipt(plan) {
    const git = {
      enabled: plan.gitPreflight.enabled,
      repository: Boolean(plan.gitPreflight.repository),
      repositoryRoot: plan.gitPreflight.repositoryRoot,
      repositoryStatus: plan.gitPreflight.repositoryStatus,
      ready: plan.gitPreflight.ready,
      headBefore: plan.gitPreflight.headBefore,
      headRef: plan.gitPreflight.headRef,
      worktreeClean: plan.gitPreflight.worktreeClean,
      identityConfigured: plan.gitPreflight.identityConfigured,
      diagnostics: plan.gitPreflight.diagnostics,
      commitState: "not_attempted",
      persistence: "none",
    };
    const readyToApply = Boolean(plan.validation.valid && plan.gitPreflight.ready);
    return {
      valid: plan.validation.valid,
      readyToApply,
      applied: false,
      filesChanged: false,
      status: !plan.validation.valid ? "invalid" : readyToApply ? "ready" : "blocked",
      snapshot: this.snapshotReceipt(plan),
      preconditions: this.preconditionsReceipt(plan),
      generated: plan.generated,
      target: plan.target,
      durability: this.durabilityReceipt(git, false),
      changes: plan.changes,
      validation: plan.validation,
      git,
    };
  }

  invalidValidationReceipt(error) {
    const validation = policyValidation(error);
    const generated = this.generatedStamp();
    return {
      valid: false,
      readyToApply: false,
      applied: false,
      filesChanged: false,
      status: "invalid",
      snapshot: {
        checkedAt: generated.at,
        timeOfCheck: true,
        generatedBy: generated.by,
        graphValidation: "not_run",
      },
      preconditions: {
        allSatisfied: false,
        revisions: [],
        git: {
          enabled: this.gitCommit,
          ready: false,
          repositoryStatus: "not_inspected",
          repositoryRoot: null,
          diagnostics: [],
        },
      },
      generated,
      durability: this.durabilityReceipt(null, false),
      changes: [],
      validation,
      ...(error && error.code ? { code: error.code } : {}),
      ...(error && error.details !== undefined ? { details: error.details } : {}),
      git: {
        enabled: this.gitCommit,
        repository: false,
        repositoryRoot: null,
        repositoryStatus: "not_inspected",
        commitState: "not_attempted",
        persistence: "none",
      },
    };
  }

  async validateChanges(input, context) {
    return this.store.withWriteLock(() => {
      try {
        return this.validationReceipt(this.planChanges(input, context));
      } catch (error) {
        if (!(error instanceof AuthoringPolicyError)) {
          throw error;
        }
        return this.invalidValidationReceipt(error);
      }
    });
  }

  async applyChanges(input, context) {
    return this.store.withWriteLock(() => this.applyChangesUnlocked(input, context));
  }

  async applyChangesUnlocked(input, context) {
    const plan = this.planChanges(input, context);
    if (!plan.validation.valid) {
      return {
        applied: false,
        readyToApply: false,
        filesChanged: false,
        status: "rejected",
        snapshot: this.snapshotReceipt(plan),
        preconditions: this.preconditionsReceipt(plan),
        generated: plan.generated,
        target: plan.target,
        durability: this.durabilityReceipt(null, false),
        changes: plan.changes,
        validation: plan.validation,
        git: {
          enabled: plan.gitPreflight.enabled,
          repository: Boolean(plan.gitPreflight.repository),
          repositoryRoot: plan.gitPreflight.repositoryRoot,
          repositoryStatus: plan.gitPreflight.repositoryStatus,
          commitState: "not_attempted",
          persistence: "none",
        },
      };
    }
    if (!plan.gitPreflight.ready) {
      const blocker = plan.gitPreflight.diagnostics[0];
      throw new AuthoringPolicyError(blocker
        ? blocker.message
        : "Configured Git preconditions do not currently allow automatic apply.");
    }
    const transaction = this.stageCandidates(plan.candidates);
    const staged = transaction.staged;
    const applied = [];
    try {
      this.assertRevisions(staged);
      staged.forEach((candidate) => {
        if (candidate.op === "create") {
          fs.linkSync(candidate.temporary, candidate.target.absolutePath);
          applied.push(candidate);
          fs.unlinkSync(candidate.temporary);
        } else {
          const currentRevision = revisionFor(fs.readFileSync(candidate.target.absolutePath));
          if (currentRevision !== candidate.baseRevision) {
            throw new Error(`Concept changed immediately before publication: ${candidate.path}`);
          }
          fs.renameSync(candidate.temporary, candidate.target.absolutePath);
          applied.push(candidate);
        }
      });
    } catch (error) {
      const rollback = this.rollback(applied, staged, transaction.createdDirectories);
      if (!rollback.complete) {
        return {
          applied: false,
          readyToApply: false,
          filesChanged: true,
          status: "rollback_conflict",
          snapshot: this.snapshotReceipt(plan),
          preconditions: this.preconditionsReceipt(plan),
          generated: plan.generated,
          target: plan.target,
          durability: this.durabilityReceipt(null, true, "partial_filesystem_state"),
          changes: plan.changes,
          validation: plan.validation,
          rollback,
          error: error && error.message ? error.message : String(error),
        };
      }
      throw error;
    }
    let persistedValidation;
    try {
      persistedValidation = this.validationResult(
        this.buildIndex(plan.additionalBundles),
        plan.candidates,
      );
    } catch (error) {
      const rollback = this.rollback(applied, staged, transaction.createdDirectories);
      if (!rollback.complete) {
        return {
          applied: false,
          readyToApply: false,
          filesChanged: true,
          status: "rollback_conflict",
          snapshot: this.snapshotReceipt(plan),
          preconditions: this.preconditionsReceipt(plan),
          generated: plan.generated,
          target: plan.target,
          durability: this.durabilityReceipt(null, true, "partial_filesystem_state"),
          changes: plan.changes,
          validation: plan.validation,
          rollback,
          error: error && error.message ? error.message : String(error),
        };
      }
      throw error;
    }
    if (!persistedValidation.valid) {
      const rollback = this.rollback(applied, staged, transaction.createdDirectories);
      return {
        applied: false,
        readyToApply: false,
        filesChanged: !rollback.complete,
        status: rollback.complete ? "rolled_back" : "rollback_conflict",
        snapshot: this.snapshotReceipt(plan),
        preconditions: this.preconditionsReceipt(plan),
        generated: plan.generated,
        target: plan.target,
        durability: this.durabilityReceipt(
          null,
          !rollback.complete,
          rollback.complete ? "rolled_back" : "partial_filesystem_state",
        ),
        changes: plan.changes,
        validation: persistedValidation,
        rollback,
      };
    }
    let git;
    try {
      git = this.commitGit(plan.gitPreflight, plan.candidates, plan.message);
    } catch (error) {
      git = {
        enabled: plan.gitPreflight.enabled,
        repository: Boolean(plan.gitPreflight.repository),
        repositoryRoot: plan.gitPreflight.repositoryRoot,
        committed: null,
        commitState: "unknown",
        persistence: "unknown",
        error: error && error.message ? error.message : String(error),
      };
    }
    if (git.targetState === "conflict") {
      let currentValidation = persistedValidation;
      try {
        currentValidation = this.validationResult(
          this.buildIndex(plan.additionalBundles),
          [],
        );
      } catch {
        // Preserve the last complete validation receipt when the conflicting state is unreadable.
      }
      if (git.committed !== true) {
        return {
          applied: false,
          readyToApply: false,
          filesChanged: true,
          status: "post_publication_conflict",
          snapshot: this.snapshotReceipt(plan),
          preconditions: this.preconditionsReceipt(plan),
          generated: plan.generated,
          target: plan.target,
          durability: this.durabilityReceipt(git, true, "partial_filesystem_state"),
          changes: plan.changes,
          validation: currentValidation,
          git,
          error: git.error || "Validated concept bytes were replaced before Git persistence completed.",
        };
      }
      persistedValidation = currentValidation;
    }
    const status = git.commitState === "unknown"
      ? "applied_commit_unknown"
      : git.committed === true && git.targetState === "conflict"
        ? "applied_worktree_diverged"
      : git.enabled && git.repository && !git.committed
        ? "applied_uncommitted"
        : "applied";
    return {
      applied: true,
      readyToApply: git.targetState !== "conflict",
      filesChanged: true,
      status,
      snapshot: this.snapshotReceipt(plan),
      preconditions: this.preconditionsReceipt(plan),
      generated: plan.generated,
      target: plan.target,
      durability: this.durabilityReceipt(git, true),
      changes: plan.changes,
      validation: persistedValidation,
      git,
    };
  }
}

module.exports = {
  LiveAuthoringService,
  MAX_CHANGES,
  MAX_COMMIT_MESSAGE_BYTES,
  MANAGED_METADATA_KEYS,
};
