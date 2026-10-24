"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync: nodeSpawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");

const {
  deriveConceptPathSuggestion,
  isConfiguredGeneratorOutput,
  normalizeConceptPath,
  renderConceptMarkdown,
} = require("../authoring");
const {
  IndexCache,
  attachProject,
  buildIndex,
  bundleAllowsPath,
  conceptMatchSummary,
  refreshIndex,
  resolveConcept,
  updateIndex,
  validateIndex,
} = require("../indexer");
const {
  MANAGED_METADATA_KEYS,
  actorValue,
  applyRelationPatch,
  applySourcePatch,
  applyTagPatch,
  conceptConflictDetails,
  conceptIsManaged,
  nonEmptyString,
  normalizeBody,
  normalizeRelation,
  normalizeSource,
  semanticConceptKey,
  staleUpdateDetails,
  uniqueStrings,
  validateMetadata,
  validateRemovalKeys,
} = require("./candidates");
const { GitPublisher } = require("./git-publish");
const { enforceWritePolicy, resolveWritePolicy, withPolicyViolations } = require("./policy-hook");
const {
  candidateSummaries,
  durabilityReceipt,
  policyReceipt,
  policyValidation,
  preconditionsReceipt,
  rollbackReceipt,
  snapshotReceipt,
  targetReceipt,
  validationReceipt,
} = require("./receipts");
const {
  AuthoringOperationalError,
  AuthoringPolicyError,
  byteLength,
  hasOwn,
  isPlainObject,
  revisionFor,
} = require("./shared");
const { assertRevisions, rollback, stageCandidates } = require("./staging");

const MAX_CHANGES = 100;
const MAX_COMMIT_MESSAGE_BYTES = 1024;

// The candidate as an index upsert: its rendered Markdown before it is
// written, or a read-back of the target path once it is.
function candidateUpsert(candidate, persisted) {
  const upsert = { bundleId: candidate.bundle, relativePath: candidate.path };
  return persisted ? upsert : Object.assign(upsert, { text: candidate.markdown });
}

class LiveAuthoringService {
  constructor(store, options) {
    const config = options || {};
    this.store = store;
    this.actor = actorValue(config.actor);
    this.gitCommit = Boolean(config.gitCommit);
    this.spawnSync = config.spawnSync || nodeSpawnSync;
    this.now = config.now || (() => new Date());
    this.git = new GitPublisher({ gitCommit: this.gitCommit, spawnSync: this.spawnSync });
    this.writePolicy = resolveWritePolicy(config, store);
    // One index kept between batches and refreshed before each (W-6); a host
    // hands one over through adoptIndex and takes it back via takePublication.
    this.indexCache = new IndexCache({ now: this.now });
    this.publication = null;
  }

  adoptIndex(index, additionalBundles) {
    this.indexCache.adopt(index, additionalBundles);
  }

  takePublication() {
    const publication = this.publication;
    this.publication = null;
    return publication;
  }

  // Under the writer lock like the rest of a batch; the once-a-day rebuild
  // for a new calendar day (updateIndex) lands here: one build's latency.
  currentIndex(additionalBundles) {
    return this.indexCache.current(additionalBundles, () => this.buildIndex(additionalBundles));
  }

  // Called when the files on disk are no longer known to match any index the
  // service holds (an incomplete rollback, a diverged worktree).
  forgetIndex() {
    this.indexCache.forget();
  }

  getBundle(id) {
    const bundles = this.store.getBundles();
    const bundle = id
      ? bundles.find((entry) => entry.id === id)
      : bundles.length === 1
        ? bundles[0]
        : null;
    if (!bundle) {
      throw new Error(
        id
          ? `Unknown writable OKF bundle: ${id}`
          : "A bundle id is required unless exactly one writable OKF root is configured.",
      );
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
      throw new Error(
        `Concept is inside a configured generator output and must be changed through its generator: ${conceptPath}`,
      );
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
    const sources = (change.sources || []).map((source, index) =>
      normalizeSource(source, `changes[].sources[${index}]`),
    );
    const relations = (change.relations || []).map((relation, index) =>
      normalizeRelation(relation, `changes[].relations[${index}]`),
    );
    if (tags.length) frontmatter.tags = tags;
    if (sources.length)
      frontmatter.sources = applySourcePatch([], { add: sources }, "changes[].sources");
    if (relations.length)
      frontmatter.relations = applyRelationPatch([], { add: relations }, "changes[].relations");
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
    if (!existing?.valid || existing.reserved) {
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
      throw new Error(
        "Live concept authoring cannot modify Attested Computation contracts or code.",
      );
    }
    const target = this.assertWritableTarget(bundle, existing.path, existing);
    const originalText = fs.readFileSync(target.absolutePath, "utf8");
    const originalMode = fs.statSync(target.absolutePath).mode;
    const indexedRevision = revisionFor(existing.text);
    const diskRevision = revisionFor(originalText);
    if (indexedRevision !== diskRevision) {
      // planChanges re-reads the document and plans again once; a second
      // mismatch is a conflict the caller sees with the revision now on disk.
      throw new AuthoringPolicyError(
        `Concept changed after it was indexed; retry the update: ${existing.uri}`,
        "concept_changed",
        {
          uri: existing.uri,
          bundleId: existing.bundle,
          relativePath: existing.path,
          indexedRevision,
          revision: diskRevision,
        },
      );
    }
    const frontmatter = Object.assign({}, existing.frontmatter);
    Object.assign(frontmatter, validateMetadata(change.metadata, "changes[].metadata"));
    validateRemovalKeys(change.removeMetadataKeys, "changes[].removeMetadataKeys").forEach(
      (key) => {
        delete frontmatter[key];
      },
    );
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
      frontmatter.sources = applySourcePatch(
        frontmatter.sources,
        change.sources,
        "changes[].sources",
      );
    }
    if (hasOwn(change, "relations")) {
      frontmatter.relations = applyRelationPatch(
        frontmatter.relations,
        change.relations,
        "changes[].relations",
      );
    }
    const body = hasOwn(change, "body") ? String(change.body || "") : existing.body;
    if (
      isDeepStrictEqual(frontmatter, existing.frontmatter) &&
      normalizeBody(body) === normalizeBody(existing.body)
    ) {
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
      (document.warnings || [])
        .filter((entry) => entry.layer === "v0.2")
        .forEach((entry) => {
          candidateDiagnostics.push(
            Object.assign({}, entry, {
              severity: "error",
              bundle: candidate.bundle,
              path: candidate.path,
            }),
          );
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

  // The staged publication steps stay overridable methods: tests subclass the
  // service and hook them to inject races between staging and publication.
  stageCandidates(candidates) {
    return stageCandidates(this.store, candidates);
  }

  assertRevisions(staged) {
    return assertRevisions(staged);
  }

  rollback(applied, staged, createdDirectories) {
    return rollback(applied, staged, createdDirectories);
  }

  generatedStamp() {
    const timestampValue = this.now();
    return {
      by: this.actor,
      at:
        timestampValue instanceof Date
          ? timestampValue.toISOString()
          : new Date(timestampValue).toISOString(),
    };
  }

  buildCandidates(changes, bundle, currentIndex, generated) {
    return changes.map((change, index) => {
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
        if (error?.code) throw error;
        throw new AuthoringPolicyError(error?.message ? error.message : String(error));
      }
    });
  }

  planChanges(input, context) {
    if (!isPlainObject(input)) {
      throw new AuthoringPolicyError("okf_apply_changes requires an object argument.");
    }
    if (
      !Array.isArray(input.changes) ||
      input.changes.length < 1 ||
      input.changes.length > MAX_CHANGES
    ) {
      throw new AuthoringPolicyError(
        `changes must contain from 1 through ${MAX_CHANGES} operations.`,
      );
    }
    let bundle;
    try {
      bundle = this.getBundle(input.bundle);
    } catch (error) {
      if (error?.code) throw error;
      throw new AuthoringPolicyError(error?.message ? error.message : String(error));
    }
    const generated = this.generatedStamp();
    const additionalBundles =
      context && Array.isArray(context.additionalBundles) ? context.additionalBundles : [];
    let currentIndex = this.currentIndex(additionalBundles);
    let candidates = null;
    for (let attempt = 0; candidates === null; attempt += 1) {
      try {
        candidates = this.buildCandidates(input.changes, bundle, currentIndex, generated);
      } catch (error) {
        if (error?.code !== "concept_changed" || attempt > 0) throw error;
        // The index missed an edit the refresh cannot see (same size and
        // mtime): take that document from disk and plan again, once.
        const { bundleId, relativePath } = error.details;
        currentIndex = this.indexCache.update(currentIndex, {
          upserts: [{ bundleId, relativePath }],
        });
      }
    }
    const policy = enforceWritePolicy(this.writePolicy, {
      actor: this.actor,
      candidates,
      index: currentIndex,
    });
    const targetPaths = new Set();
    candidates.forEach((candidate) => {
      const key = path.resolve(candidate.target.absolutePath);
      if (targetPaths.has(key)) {
        throw new AuthoringPolicyError(
          `A batch cannot target the same concept more than once: ${candidate.path}`,
        );
      }
      targetPaths.add(key);
    });
    const absoluteTargets = Array.from(targetPaths);
    for (let left = 0; left < absoluteTargets.length; left += 1) {
      for (let right = left + 1; right < absoluteTargets.length; right += 1) {
        if (
          absoluteTargets[left].startsWith(`${absoluteTargets[right]}${path.sep}`) ||
          absoluteTargets[right].startsWith(`${absoluteTargets[left]}${path.sep}`)
        ) {
          throw new AuthoringPolicyError(
            "A batch cannot place one concept path underneath another concept file path.",
          );
        }
      }
    }
    const currentConcepts = currentIndex.concepts.filter((doc) => doc.bundle === bundle.id);
    const replacedPaths = new Set(
      candidates.filter((entry) => entry.op === "update").map((entry) => entry.path),
    );
    const finalConcepts = currentConcepts
      .filter((doc) => !replacedPaths.has(doc.path))
      .concat(candidates);
    for (const candidate of candidates) {
      const key = semanticConceptKey(candidate.frontmatter.type, candidate.title);
      const before = currentConcepts.filter(
        (doc) => semanticConceptKey(doc.type, doc.title) === key,
      );
      const after = finalConcepts.filter(
        (doc) => semanticConceptKey(doc.type || doc.frontmatter.type, doc.title) === key,
      );
      if (after.length <= Math.max(1, before.length)) continue;
      const existing = after.filter((doc) => !candidates.includes(doc));
      const details =
        candidate.op === "create" && existing.length === 1 && after.length === 2
          ? conceptConflictDetails(existing, this.store.project)
          : {
              reason: before.length ? "same_type_title" : "same_batch_type_title",
              candidates: after.slice(0, 5).map((doc) => conceptMatchSummary(doc)),
              omitted: Math.max(0, after.length - 5),
              recommendedOperation: "merge_batch_changes",
            };
      throw new AuthoringPolicyError(
        `The batch would leave more than one concept with the same type and title: ${candidate.uri}`,
        "concept_already_exists",
        details,
      );
    }
    const message = this.commitMessage(input, candidates);
    const validation = withPolicyViolations(
      this.validationResult(
        updateIndex(
          currentIndex,
          { upserts: candidates.map((candidate) => candidateUpsert(candidate, false)) },
          this.indexCache.options(),
        ),
        candidates,
      ),
      policy,
    );
    const gitPreflight = this.git.prepareGit(bundle, candidates);
    return {
      input,
      bundle,
      generated,
      additionalBundles,
      currentIndex,
      candidates,
      message,
      validation,
      policy,
      gitPreflight,
      target: targetReceipt(this.store, bundle, candidates, gitPreflight),
      changes: candidateSummaries(candidates),
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
      durability: durabilityReceipt(null, false),
      changes: [],
      validation,
      ...(error?.code ? { code: error.code } : {}),
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
      this.publication = null;
      try {
        return validationReceipt(this.planChanges(input, context));
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
    this.publication = null;
    const plan = this.planChanges(input, context);
    if (!plan.validation.valid) {
      return {
        applied: false,
        readyToApply: false,
        filesChanged: false,
        status: "rejected",
        snapshot: snapshotReceipt(plan),
        preconditions: preconditionsReceipt(plan),
        generated: plan.generated,
        target: plan.target,
        durability: durabilityReceipt(null, false),
        changes: plan.changes,
        validation: plan.validation,
        ...policyReceipt(plan),
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
      throw new AuthoringPolicyError(
        blocker
          ? blocker.message
          : "Configured Git preconditions do not currently allow automatic apply.",
      );
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
        this.forgetIndex();
        return rollbackReceipt(plan, rollback, error);
      }
      throw error;
    }
    let persistedValidation;
    let persistedIndex;
    try {
      // Validate the bytes that landed on disk, read back from the targets,
      // applied to the index the batch was planned against after a refresh,
      // so a dependency that changed or vanished since planning counts too.
      persistedIndex = updateIndex(
        refreshIndex(plan.currentIndex, this.indexCache.options()),
        { upserts: plan.candidates.map((candidate) => candidateUpsert(candidate, true)) },
        this.indexCache.options(),
      );
      persistedValidation = this.validationResult(persistedIndex, plan.candidates);
    } catch (error) {
      const rollback = this.rollback(applied, staged, transaction.createdDirectories);
      if (!rollback.complete) {
        this.forgetIndex();
        return rollbackReceipt(plan, rollback, error);
      }
      throw error;
    }
    if (!persistedValidation.valid) {
      const rollback = this.rollback(applied, staged, transaction.createdDirectories);
      if (!rollback.complete) {
        this.forgetIndex();
      }
      return Object.assign(rollbackReceipt(plan, rollback, null), {
        validation: persistedValidation,
      });
    }
    let git;
    try {
      git = this.git.commitGit(plan.gitPreflight, plan.candidates, plan.message);
    } catch (error) {
      git = {
        enabled: plan.gitPreflight.enabled,
        repository: Boolean(plan.gitPreflight.repository),
        repositoryRoot: plan.gitPreflight.repositoryRoot,
        committed: null,
        commitState: "unknown",
        persistence: "unknown",
        error: error?.message ? error.message : String(error),
      };
    }
    if (git.targetState === "conflict") {
      // The worktree diverged from what was validated; nothing the service
      // holds describes the files now, so re-read everything and let the host
      // rebuild its own index.
      this.forgetIndex();
      let currentValidation = persistedValidation;
      try {
        currentValidation = this.validationResult(this.buildIndex(plan.additionalBundles), []);
      } catch {
        // Preserve the last complete validation receipt when the conflicting state is unreadable.
      }
      if (git.committed !== true) {
        return {
          applied: false,
          readyToApply: false,
          filesChanged: true,
          status: "post_publication_conflict",
          snapshot: snapshotReceipt(plan),
          preconditions: preconditionsReceipt(plan),
          generated: plan.generated,
          target: plan.target,
          durability: durabilityReceipt(git, true, "partial_filesystem_state"),
          changes: plan.changes,
          validation: currentValidation,
          ...policyReceipt(plan),
          git,
          error:
            git.error || "Validated concept bytes were replaced before Git persistence completed.",
        };
      }
      persistedValidation = currentValidation;
    } else {
      const shared = this.indexCache.index === plan.currentIndex;
      this.indexCache.replace(plan.currentIndex, persistedIndex);
      this.publication = {
        index: persistedIndex,
        hostOwned: Boolean(shared && this.indexCache.hostOwned),
        changes: { upserts: plan.candidates.map((candidate) => candidateUpsert(candidate, true)) },
      };
    }
    const status =
      git.commitState === "unknown"
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
      snapshot: snapshotReceipt(plan),
      preconditions: preconditionsReceipt(plan),
      generated: plan.generated,
      target: plan.target,
      durability: durabilityReceipt(git, true),
      changes: plan.changes,
      validation: persistedValidation,
      ...policyReceipt(plan),
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
