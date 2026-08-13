"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync: nodeSpawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");

const { normalizeConceptPath, renderConceptMarkdown, slug } = require("./authoring");
const {
  attachProject,
  buildIndex,
  bundleAllowsPath,
  resolveConcept,
  validateIndex,
} = require("./indexer");
const { validActor } = require("./v02");

const MAX_CHANGES = 100;
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

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

function revisionFor(text) {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
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

  generatedOutputDirectories() {
    const project = this.store.project;
    if (!project || !project.root) {
      return [];
    }
    return (project.plugins || [])
      .filter((plugin) => plugin && plugin.output)
      .map((plugin) => path.resolve(project.root, String(plugin.output)));
  }

  assertWritableTarget(bundle, conceptPath, existing) {
    const target = this.store.resolveConceptFile(bundle.id, conceptPath);
    if (this.generatedOutputDirectories().some((output) => isInside(output, target.absolutePath))) {
      throw new Error(`Concept is inside a configured generator output and must be changed through its generator: ${conceptPath}`);
    }
    if (existing) {
      const frontmatter = existing.frontmatter || {};
      if (existing.generatedFile === true
        || existing.isGenerated === true
        || frontmatter.generated_file === true
        || frontmatter.generatedFile === true) {
        throw new Error(`Generated concept must be changed through its generator: ${existing.uri}`);
      }
      if (generatedOwners(existing).some((owner) => owner.startsWith("process:"))) {
        throw new Error(`Process-generated concept must be changed through its generator: ${existing.uri}`);
      }
    }
    return target;
  }

  createCandidate(change, bundle, generated) {
    const type = nonEmptyString(change.type, "changes[].type");
    if (type === "Attested Computation") {
      throw new Error("Live concept authoring cannot create Attested Computation contracts.");
    }
    const title = nonEmptyString(change.title, "changes[].title");
    const conceptPath = normalizeConceptPath(
      change.path || `${slug(type, "concept")}/${slug(title, "concept")}.md`,
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
    };
  }

  updateCandidate(change, bundle, currentIndex, generated) {
    const uri = nonEmptyString(change.uri, "changes[].uri");
    const existing = resolveConcept(currentIndex, uri);
    if (!existing || !existing.valid || existing.reserved) {
      throw new Error(`Unknown valid OKF concept: ${uri}`);
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
      originalText,
      originalMode,
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

  runGit(directory, args) {
    const environment = Object.assign({}, process.env);
    Object.keys(environment).filter((key) => key.startsWith("GIT_")).forEach((key) => {
      delete environment[key];
    });
    environment.GIT_LITERAL_PATHSPECS = "1";
    environment.GIT_TERMINAL_PROMPT = "0";
    return this.spawnSync("git", [
      "-C",
      directory,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
    ].concat(args), {
      encoding: "utf8",
      shell: false,
      maxBuffer: 1024 * 1024,
      timeout: 15000,
      env: environment,
    });
  }

  prepareGit(bundle) {
    if (!this.gitCommit) {
      return { enabled: false, repository: null };
    }
    const discovered = this.runGit(bundle.root, ["rev-parse", "--show-toplevel"]);
    if (discovered.error) {
      throw new Error(`Git executable is unavailable: ${discovered.error.message}`);
    }
    if (discovered.status !== 0) {
      const detail = commandOutput(discovered);
      if (/not a git repository/i.test(detail)) {
        return { enabled: true, repository: null };
      }
      throw new Error(`Could not inspect Git repository: ${detail || `git exited ${discovered.status}`}`);
    }
    const repository = String(discovered.stdout || "").trim();
    const status = this.runGit(repository, ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status.error || status.status !== 0) {
      throw new Error(`Could not inspect Git status: ${commandFailure(status, "git status failed")}`);
    }
    if (String(status.stdout || "").trim()) {
      throw new Error("Git worktree must be completely clean before an automatic OKF commit.");
    }
    for (const key of ["user.name", "user.email"]) {
      const configured = this.runGit(repository, ["config", "--get", key]);
      if (configured.error || configured.status !== 0 || !String(configured.stdout || "").trim()) {
        throw new Error(`Git ${key} must be configured before an automatic OKF commit.`);
      }
    }
    return { enabled: true, repository };
  }

  commitGit(preflight, candidates, message) {
    if (!preflight.enabled) {
      return { enabled: false, committed: false };
    }
    if (!preflight.repository) {
      return { enabled: true, repository: false, committed: false, reason: "not_git_repository" };
    }
    const files = candidates.map((candidate) => (
      path.relative(preflight.repository, candidate.target.absolutePath).replace(/\\/g, "/")
    ));
    if (files.some((file) => !file || file === ".." || file.startsWith("../"))) {
      return {
        enabled: true,
        repository: true,
        committed: false,
        error: "An affected concept path is outside the detected Git repository.",
      };
    }
    const add = this.runGit(preflight.repository, ["add", "--"].concat(files));
    if (add.error || add.status !== 0) {
      return {
        enabled: true,
        repository: true,
        committed: false,
        error: commandFailure(add, "git add failed"),
      };
    }
    const commit = this.runGit(preflight.repository, ["commit", "-m", message, "--"].concat(files));
    if (commit.error || commit.status !== 0) {
      return {
        enabled: true,
        repository: true,
        committed: false,
        error: commandFailure(commit, "git commit failed"),
      };
    }
    const revision = this.runGit(preflight.repository, ["rev-parse", "HEAD"]);
    return {
      enabled: true,
      repository: true,
      committed: true,
      commitSha: revision.status === 0 ? String(revision.stdout || "").trim() : null,
      ...(revision.status === 0 ? {} : { warning: commandFailure(revision, "Commit succeeded but its SHA could not be read.") }),
    };
  }

  defaultMessage(candidates) {
    if (candidates.length === 1) {
      return `docs(okf): ${candidates[0].op === "create" ? "add" : "update"} ${candidates[0].title}`;
    }
    return `docs(okf): apply ${candidates.length} concept changes`;
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

  rollback(applied, staged, createdDirectories) {
    const failures = [];
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
        if (candidate.op === "create") {
          if (fs.existsSync(candidate.target.absolutePath)) fs.unlinkSync(candidate.target.absolutePath);
        } else {
          restoreFile(candidate.target.absolutePath, candidate.originalText, candidate.originalMode);
        }
      } catch (error) {
        failures.push(error);
      }
    });
    try {
      this.cleanupDirectories(createdDirectories || []);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) {
      throw new Error(`OKF batch rollback failed: ${failures[0].message}`);
    }
  }

  async applyChanges(input, context) {
    return this.store.withWriteLock(() => this.applyChangesUnlocked(input, context));
  }

  async applyChangesUnlocked(input, context) {
    if (!isPlainObject(input)) {
      throw new Error("okf_apply_changes requires an object argument.");
    }
    if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > MAX_CHANGES) {
      throw new Error(`changes must contain from 1 through ${MAX_CHANGES} operations.`);
    }
    const bundle = this.getBundle(input.bundle);
    const timestampValue = this.now();
    const generated = {
      by: this.actor,
      at: timestampValue instanceof Date
        ? timestampValue.toISOString()
        : new Date(timestampValue).toISOString(),
    };
    const additionalBundles = context && Array.isArray(context.additionalBundles)
      ? context.additionalBundles
      : [];
    const currentIndex = this.buildIndex(additionalBundles);
    const candidates = input.changes.map((change, index) => {
      if (!isPlainObject(change)) {
        throw new Error(`changes[${index}] must be an object.`);
      }
      if (change.op === "create") {
        return this.createCandidate(change, bundle, generated);
      }
      if (change.op === "update") {
        return this.updateCandidate(change, bundle, currentIndex, generated);
      }
      throw new Error(`changes[${index}].op must be create or update.`);
    });
    const targetPaths = new Set();
    candidates.forEach((candidate) => {
      const key = path.resolve(candidate.target.absolutePath);
      if (targetPaths.has(key)) {
        throw new Error(`A batch cannot target the same concept more than once: ${candidate.path}`);
      }
      targetPaths.add(key);
    });
    const overrides = new Map(candidates.map((candidate) => [
      `${candidate.bundle}\u0000${candidate.path}`,
      candidate.markdown,
    ]));
    const futureIndex = this.buildIndex(additionalBundles, overrides);
    const validation = this.validationResult(futureIndex, candidates);
    if (!validation.valid) {
      return {
        applied: false,
        status: "rejected",
        generated,
        validation,
      };
    }
    const gitPreflight = this.prepareGit(bundle);
    const transaction = this.stageCandidates(candidates);
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
      this.rollback(applied, staged, transaction.createdDirectories);
      throw error;
    }
    let persistedValidation;
    try {
      persistedValidation = this.validationResult(
        this.buildIndex(additionalBundles),
        candidates,
      );
    } catch (error) {
      this.rollback(applied, staged, transaction.createdDirectories);
      throw error;
    }
    if (!persistedValidation.valid) {
      this.rollback(applied, staged, transaction.createdDirectories);
      return {
        applied: false,
        status: "rolled_back",
        generated,
        validation: persistedValidation,
      };
    }
    const message = hasOwn(input, "message") && String(input.message).trim()
      ? String(input.message).trim()
      : this.defaultMessage(candidates);
    let git;
    try {
      git = this.commitGit(gitPreflight, candidates, message);
    } catch (error) {
      git = {
        enabled: gitPreflight.enabled,
        repository: Boolean(gitPreflight.repository),
        committed: false,
        error: error && error.message ? error.message : String(error),
      };
    }
    const summaries = candidates.map((candidate) => ({
      op: candidate.op,
      bundle: candidate.bundle,
      path: candidate.path,
      uri: candidate.uri,
      title: candidate.title,
    }));
    return {
      applied: true,
      status: git.enabled && git.repository && !git.committed
        ? "applied_uncommitted"
        : "applied",
      generated,
      changes: summaries,
      validation,
      git,
    };
  }
}

module.exports = {
  LiveAuthoringService,
  MAX_CHANGES,
  MANAGED_METADATA_KEYS,
};
