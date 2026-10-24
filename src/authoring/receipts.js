"use strict";

const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const { normalizeBody, relationKey, relationParts, sourceIdentity } = require("./candidates");
const {
  MAX_EFFECT_ITEMS,
  MAX_EFFECT_TEXT,
  byteLength,
  hasOwn,
  isPlainObject,
  sortedUnique,
} = require("./shared");

function boundedEffectList(values, project) {
  const normalized = project ? values.map(project) : sortedUnique(values).map(boundedEffectText);
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
  const added = Array.from(next.keys())
    .filter((key) => !previous.has(key))
    .sort();
  const removed = Array.from(previous.keys())
    .filter((key) => !next.has(key))
    .sort();
  const updated = Array.from(next.keys())
    .filter((key) => previous.has(key) && !isDeepStrictEqual(previous.get(key), next.get(key)))
    .sort();
  const effectList = (keys, values) =>
    boundedEffectList(project ? keys.map((key) => values.get(key)) : keys, project);
  return {
    added: effectList(added, next),
    removed: effectList(removed, previous),
    updated: effectList(updated, next),
  };
}

function metadataEffects(before, after) {
  const excluded = new Set(["tags", "sources", "relations", "generated"]);
  const keys = sortedUnique(Object.keys(before || {}).concat(Object.keys(after || {}))).filter(
    (key) => !excluded.has(key),
  );
  return {
    set: boundedEffectList(
      keys.filter((key) => hasOwn(after, key) && !isDeepStrictEqual(before[key], after[key])),
    ),
    removed: boundedEffectList(keys.filter((key) => hasOwn(before, key) && !hasOwn(after, key))),
  };
}

function effectsForCandidate(candidate) {
  const before = candidate.op === "update" ? candidate.originalFrontmatter : {};
  const after = candidate.frontmatter;
  const tags = collectionEffects(before.tags, after.tags, (value) => String(value));
  const sources = collectionEffects(before.sources, after.sources, sourceIdentity);
  const relations = collectionEffects(
    before.relations,
    after.relations,
    relationKey,
    relationEffectValue,
  );
  const metadata = metadataEffects(before, after);
  const bodyChanged =
    candidate.op === "create"
      ? true
      : normalizeBody(candidate.originalBody) !== normalizeBody(candidate.body);
  const changedFields = [];
  if (bodyChanged) changedFields.push("body");
  const hasEffect = (group) => group.values.length || group.omitted;
  if (hasEffect(tags.added) || hasEffect(tags.removed) || hasEffect(tags.updated))
    changedFields.push("tags");
  if (hasEffect(sources.added) || hasEffect(sources.removed) || hasEffect(sources.updated))
    changedFields.push("sources");
  if (hasEffect(relations.added) || hasEffect(relations.removed) || hasEffect(relations.updated))
    changedFields.push("relations");
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

function policyCode(message) {
  const text = String(message || "");
  if (/generated|generator/i.test(text)) return "generated_owner_protected";
  if (/Attested Computation|computation contract/i.test(text))
    return "computation_authoring_prohibited";
  if (/excluded by the bundle policy/i.test(text)) return "excluded_target";
  if (/no effective changes/i.test(text)) return "no_effective_changes";
  if (/same concept more than once/i.test(text)) return "duplicate_batch_target";
  if (/already exists/i.test(text)) return "target_exists";
  if (/unknown valid OKF concept/i.test(text)) return "concept_not_found";
  if (/server-managed/i.test(text)) return "managed_metadata_protected";
  if (/1 through \d+ operations/i.test(text)) return "invalid_batch_size";
  if (
    /outside|travers|safe relative|unsafe segment|reserved index|reserved .*file|Markdown file|Markdown path/i.test(
      text,
    )
  )
    return "unsafe_target_path";
  if (/worktree must be completely clean/i.test(text)) return "git_worktree_dirty";
  if (/Git filter attributes|repository-configured filters/i.test(text))
    return "git_filter_attribute_unsupported";
  if (/assume-unchanged|skip-worktree|Git index flags/i.test(text))
    return "git_index_flag_unsupported";
  if (/detached HEAD|symbolic branch|checked-out Git ref/i.test(text))
    return "git_head_ref_unsupported";
  if (/Git user\.(name|email)/i.test(text)) return "git_identity_missing";
  if (/must have an existing HEAD/i.test(text)) return "git_head_missing";
  if (/commit message/i.test(text)) return "invalid_commit_message";
  return "authoring_policy_rejected";
}

function policyValidation(error) {
  const message = error && error.message ? error.message : String(error);
  const code = (error && error.code) || policyCode(message);
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

function targetReceipt(store, bundle, candidates, gitPreflight) {
  const bundleRoot = store.resolveWritableBundleRoot(bundle);
  const projectRoot = store.projectRoot ? path.resolve(store.projectRoot) : bundleRoot;
  return {
    bundle: bundle.id,
    bundleRoot,
    projectRoot,
    repositoryRoot:
      gitPreflight && gitPreflight.repositoryRoot ? gitPreflight.repositoryRoot : null,
    absolutePaths: candidates.map((candidate) => candidate.target.absolutePath),
  };
}

function candidateSummaries(candidates) {
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

function durabilityReceipt(git, filesChanged, stateOverride) {
  const persistence =
    git && git.persistence ? git.persistence : filesChanged ? "working_tree" : "none";
  return {
    state:
      stateOverride ||
      (filesChanged
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

function snapshotReceipt(plan) {
  return {
    checkedAt: plan.generated.at,
    timeOfCheck: true,
    generatedBy: plan.generated.by,
    graphValidation: "future_overlay",
  };
}

function preconditionsReceipt(plan) {
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

function validationReceipt(plan) {
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
    snapshot: snapshotReceipt(plan),
    preconditions: preconditionsReceipt(plan),
    generated: plan.generated,
    target: plan.target,
    durability: durabilityReceipt(git, false),
    changes: plan.changes,
    validation: plan.validation,
    git,
  };
}

module.exports = {
  candidateSummaries,
  durabilityReceipt,
  policyValidation,
  preconditionsReceipt,
  snapshotReceipt,
  targetReceipt,
  validationReceipt,
};
