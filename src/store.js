"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildIndex } = require("./indexer");
const { DEFAULT_RELATION_TYPES, loadProjectConfig } = require("./project");
const { normalizeConceptPath } = require("./authoring");

function nowIso() {
  return new Date().toISOString();
}

function proposalId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeProposalId(id) {
  const clean = String(id || "").trim();
  if (!/^[a-z0-9_.-]+$/.test(clean)) {
    throw new Error(`Invalid proposal id: ${id || "<missing>"}`);
  }
  return clean;
}

function safeProposalFile(root, id) {
  const clean = normalizeProposalId(id);
  return path.join(root, `${clean}.json`);
}

function readJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Proposal records must be regular files and cannot be symbolic links.");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error("Proposal records cannot be symbolic links.");
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

function revisionFor(text) {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function writeFileAtomic(filePath, text, expectedRevision) {
  ensureDir(path.dirname(filePath));
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error("Concept files cannot be symbolic links.");
  }
  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode : null;
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, text, { encoding: "utf8", flag: "wx" });
    if (mode !== null) {
      fs.chmodSync(temporaryPath, mode);
    }
    const currentRevision = revisionFor(fs.readFileSync(filePath));
    if (expectedRevision && currentRevision !== expectedRevision) {
      return { written: false, currentRevision };
    }
    fs.renameSync(temporaryPath, filePath);
    return { written: true, currentRevision };
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeBundleFilePath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || raw.includes("\0")) {
    throw new Error("Bundle file path must be a safe relative path.");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Bundle file path must stay inside the bundle.");
  }
  return normalized;
}

function rejectSymlinkTraversal(realRoot, relativePath, label) {
  const segments = relativePath.split("/");
  let current = realRoot;
  segments.forEach((segment, index) => {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label || "Concept path"} cannot traverse a symbolic link: ${segments.slice(0, index + 1).join("/")}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Concept path parent is not a directory: ${segments.slice(0, index + 1).join("/")}`);
    }
    const resolved = fs.realpathSync(current);
    if (!isInside(realRoot, resolved)) {
      throw new Error("Concept path resolves outside bundle root.");
    }
  });
}

class FileConceptStore {
  constructor(options) {
    this.project = options.project || null;
    this.bundles = (options.bundles || []).filter((bundle) => !bundle.remote);
    this.relationTypes = options.relationTypes || [];
    this.allowCustomRelationTypes = Boolean(options.allowCustomRelationTypes);
    this.strictLinks = Boolean(options.strictLinks || (this.project && this.project.strictLinks));
    this.projectRoot = this.project ? fs.realpathSync(this.project.root) : null;
    const configuredProposalRoot = options.proposalRoot || ".okf-proposals";
    this.proposalRoot = path.resolve(
      this.projectRoot || process.cwd(),
      configuredProposalRoot,
    );
    if (this.projectRoot) {
      const relative = path.relative(this.projectRoot, this.proposalRoot);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Proposal root must be a dedicated directory inside the project root.");
      }
      rejectSymlinkTraversal(this.projectRoot, relative.replace(/\\/g, "/"), "Proposal root");
    } else if (fs.existsSync(this.proposalRoot) && fs.lstatSync(this.proposalRoot).isSymbolicLink()) {
      throw new Error("Proposal root cannot be a symbolic link.");
    }
    this.proposalLocks = new Map();
  }

  static fromProject(projectPath, options) {
    const project = loadProjectConfig(projectPath);
    if (project.errors.length) {
      throw new Error("Cannot configure writable concept storage from an invalid project configuration.");
    }
    return new FileConceptStore({
      project,
      bundles: project.bundles,
      relationTypes: project.relationTypes,
      strictLinks: project.strictLinks,
      proposalRoot: options && options.proposalRoot,
    });
  }

  static fromRoot(rootPath, options) {
    const requestedRoot = path.resolve(rootPath || ".");
    const root = fs.realpathSync(requestedRoot);
    if (!fs.statSync(root).isDirectory()) {
      throw new Error("Writable OKF root must be an existing directory.");
    }
    const id = String((options && options.id) || path.basename(root) || "bundle")
      .replace(/[^A-Za-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "bundle";
    const bundles = [{ id, root, include: [], exclude: [] }];
    const project = {
      project: id,
      root,
      path: null,
      bundles,
      remoteBundles: [],
      relationTypes: DEFAULT_RELATION_TYPES.slice(),
      plugins: [],
      strictLinks: Boolean(options && options.strictLinks),
      errors: [],
      rootMode: true,
    };
    return new FileConceptStore({
      project,
      bundles,
      relationTypes: project.relationTypes,
      allowCustomRelationTypes: true,
      strictLinks: project.strictLinks,
      proposalRoot: options && options.proposalRoot,
    });
  }

  getBundles() {
    return this.bundles.slice();
  }

  getRelationTypes() {
    return this.relationTypes.slice();
  }

  getIndex() {
    return buildIndex(this.bundles, {
      relationTypes: this.relationTypes,
      strictLinks: this.strictLinks,
      allowCustomRelationTypes: this.allowCustomRelationTypes,
    });
  }

  getBundle(id) {
    const bundle = this.bundles.find((entry) => entry.id === id);
    if (!bundle) {
      throw new Error(`Unknown writable OKF bundle: ${id || "<missing>"}`);
    }
    return bundle;
  }

  resolveWritableBundleRoot(bundle) {
    const configuredRoot = path.resolve(bundle.root);
    if (this.projectRoot) {
      if (!isInside(this.projectRoot, configuredRoot)) {
        throw new Error("Writable bundle root resolves outside the project root.");
      }
      const relative = path.relative(this.projectRoot, configuredRoot).replace(/\\/g, "/");
      rejectSymlinkTraversal(this.projectRoot, relative, "Writable bundle root");
    }
    const realRoot = fs.realpathSync(configuredRoot);
    if (!fs.statSync(realRoot).isDirectory()) {
      throw new Error("Writable bundle root must be an existing directory.");
    }
    if (this.projectRoot && !isInside(this.projectRoot, realRoot)) {
      throw new Error("Writable bundle root resolves outside the project root.");
    }
    return realRoot;
  }

  resolveConceptFile(bundleId, conceptPath) {
    const bundle = this.getBundle(bundleId);
    const relativePath = normalizeConceptPath(conceptPath);
    const realRoot = this.resolveWritableBundleRoot(bundle);
    const absolutePath = path.resolve(realRoot, ...relativePath.split("/"));
    if (!isInside(realRoot, absolutePath)) {
      throw new Error("Concept path resolves outside bundle root.");
    }
    rejectSymlinkTraversal(realRoot, relativePath);
    return { relativePath, absolutePath };
  }

  resolveBundleFile(bundleId, filePath) {
    const bundle = this.getBundle(bundleId);
    const relativePath = normalizeBundleFilePath(filePath);
    const realRoot = this.resolveWritableBundleRoot(bundle);
    const absolutePath = path.resolve(realRoot, ...relativePath.split("/"));
    if (!isInside(realRoot, absolutePath)) {
      throw new Error("Bundle file path resolves outside bundle root.");
    }
    rejectSymlinkTraversal(realRoot, relativePath);
    return { relativePath, absolutePath };
  }

  getConceptRevision(bundleId, conceptPath) {
    const { relativePath, absolutePath } = this.resolveConceptFile(bundleId, conceptPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Concept file does not exist: ${relativePath}`);
    }
    return revisionFor(fs.readFileSync(absolutePath));
  }

  getContentRevision(text) {
    return revisionFor(text);
  }

  proposalDirectory(relativeDirectory, create) {
    const relative = String(relativeDirectory || "").replace(/\\/g, "/");
    if (relative && !/^[A-Za-z0-9_.-]+$/.test(relative)) {
      throw new Error("Invalid proposal directory.");
    }
    const directory = relative ? path.join(this.proposalRoot, relative) : this.proposalRoot;
    if (this.projectRoot) {
      const fromProject = path.relative(this.projectRoot, directory);
      if (!fromProject || fromProject.startsWith("..") || path.isAbsolute(fromProject)) {
        throw new Error("Proposal directory resolves outside the project root.");
      }
      rejectSymlinkTraversal(this.projectRoot, fromProject.replace(/\\/g, "/"), "Proposal path");
    } else {
      const fromProposalRoot = path.relative(this.proposalRoot, directory);
      if (fromProposalRoot.startsWith("..") || path.isAbsolute(fromProposalRoot)) {
        throw new Error("Proposal directory resolves outside the configured proposal root.");
      }
      if (fs.existsSync(this.proposalRoot) && fs.lstatSync(this.proposalRoot).isSymbolicLink()) {
        throw new Error("Proposal root cannot be a symbolic link.");
      }
      if (relative) {
        rejectSymlinkTraversal(this.proposalRoot, relative, "Proposal path");
      }
    }
    if (create) {
      ensureDir(directory);
      if (this.projectRoot) {
        const fromProject = path.relative(this.projectRoot, directory).replace(/\\/g, "/");
        rejectSymlinkTraversal(this.projectRoot, fromProject, "Proposal path");
        if (!isInside(this.projectRoot, fs.realpathSync(directory))) {
          throw new Error("Proposal directory resolves outside the project root.");
        }
      }
    }
    return directory;
  }

  proposalFile(id, relativeDirectory, createDirectory) {
    return safeProposalFile(this.proposalDirectory(relativeDirectory, createDirectory), id);
  }

  async withProposalLock(id, operation) {
    const key = normalizeProposalId(id);
    const previous = this.proposalLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.proposalLocks.set(key, tail);
    await previous;
    try {
      return await operation(key);
    } finally {
      release();
      if (this.proposalLocks.get(key) === tail) {
        this.proposalLocks.delete(key);
      }
    }
  }

  listProposalFiles() {
    const root = this.proposalDirectory("", false);
    if (!fs.existsSync(root)) {
      return [];
    }
    return fs.readdirSync(root)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(root, name));
  }

  async saveProposal(input) {
    const id = proposalId();
    const timestamp = nowIso();
    const proposal = {
      id,
      status: "proposed",
      op: input.op || "create",
      targetUri: input.targetUri || null,
      targetPathUri: input.targetPathUri || null,
      baseRevision: input.baseRevision || null,
      bundle: input.bundle,
      path: input.path,
      uri: input.validation && input.validation.uri,
      pathUri: input.validation && input.validation.pathUri,
      frontmatter: input.frontmatter || {},
      body: input.body || "",
      markdown: input.markdown || "",
      message: input.message || "",
      validation: input.validation || null,
      assetFiles: Array.isArray(input.assetFiles) ? input.assetFiles : [],
      dependencyRevisions: Array.isArray(input.dependencyRevisions) ? input.dependencyRevisions : [],
      migrationId: input.migrationId || null,
      prerequisites: Array.isArray(input.prerequisites) ? input.prerequisites : [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeJson(this.proposalFile(id, "", true), proposal);
    return proposal;
  }

  async listProposals(filters) {
    const options = filters || {};
    return this.listProposalFiles().map(readJson).filter((proposal) => {
      if (options.bundle && proposal.bundle !== options.bundle) {
        return false;
      }
      if (options.status && proposal.status !== options.status) {
        return false;
      }
      return true;
    }).map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      op: proposal.op || "create",
      targetUri: proposal.targetUri || null,
      bundle: proposal.bundle,
      path: proposal.path,
      uri: proposal.uri,
      message: proposal.message,
      assetFileCount: Array.isArray(proposal.assetFiles) ? proposal.assetFiles.length : 0,
      migrationId: proposal.migrationId || null,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
    }));
  }

  async getProposal(id) {
    const filePath = this.proposalFile(id, "", false);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Unknown OKF proposal: ${id || "<missing>"}`);
    }
    return readJson(filePath);
  }

  saveExistingProposal(proposal) {
    proposal.updatedAt = nowIso();
    writeJson(this.proposalFile(proposal.id, "", true), proposal);
    return proposal;
  }

  markProposalConflict(proposal, currentRevision) {
    proposal.conflict = {
      expectedRevision: proposal.baseRevision || null,
      actualRevision: currentRevision,
      detectedAt: nowIso(),
    };
    this.saveExistingProposal(proposal);
    return {
      accepted: false,
      conflict: true,
      message: "The concept changed after this update was proposed. Create a new proposal from the current concept.",
      proposal,
    };
  }

  async acceptProposal(id, authoringService, options) {
    return this.withProposalLock(id, (canonicalId) => this.acceptProposalUnlocked(canonicalId, authoringService, options));
  }

  async acceptProposalUnlocked(id, authoringService, options) {
    const proposal = await this.getProposal(id);
    if (proposal.status !== "proposed") {
      throw new Error(`Only proposed concepts can be accepted. Current status: ${proposal.status}`);
    }
    const op = proposal.op || "create";
    if (!["create", "update", "create_computation", "migration_index"].includes(op)) {
      throw new Error(`Unsupported proposal operation: ${op}`);
    }
    if (op === "create_computation" && !(options && options.allowComputation)) {
      throw new Error("Accepting an Attested Computation proposal requires the computation-authoring capability.");
    }
    if (op === "migration_index") {
      for (const prerequisite of proposal.prerequisites || []) {
        const required = await this.getProposal(prerequisite);
        if (required.status !== "accepted") {
          throw new Error(`Migration index proposal requires accepted child proposal: ${prerequisite}`);
        }
      }
      const target = this.resolveBundleFile(proposal.bundle, proposal.path);
      if (!fs.existsSync(target.absolutePath)) {
        throw new Error(`Reserved index does not exist: ${proposal.path}`);
      }
      const currentRevision = revisionFor(fs.readFileSync(target.absolutePath));
      if (!proposal.baseRevision || currentRevision !== proposal.baseRevision) {
        return this.markProposalConflict(proposal, currentRevision);
      }
      const validation = authoringService.validateReservedIndexMigration(proposal);
      if (!validation.valid) {
        proposal.validation = validation;
        this.saveExistingProposal(proposal);
        return { accepted: false, proposal, validation };
      }
      const originalText = fs.readFileSync(target.absolutePath, "utf8");
      const write = writeFileAtomic(target.absolutePath, proposal.markdown, proposal.baseRevision);
      if (!write.written) {
        return this.markProposalConflict(proposal, write.currentRevision);
      }
      proposal.status = "accepted";
      proposal.acceptedAt = nowIso();
      proposal.validation = validation;
      try {
        this.saveExistingProposal(proposal);
      } catch (error) {
        writeFileAtomic(target.absolutePath, originalText, revisionFor(proposal.markdown));
        proposal.status = "proposed";
        delete proposal.acceptedAt;
        throw error;
      }
      return { accepted: true, created: false, updated: true, proposal, validation };
    }
    const { relativePath, absolutePath } = this.resolveConceptFile(proposal.bundle, proposal.path);
    const exists = fs.existsSync(absolutePath);
    if ((op === "create" || op === "create_computation") && exists) {
      throw new Error(`Concept file already exists: ${relativePath}`);
    }
    if (op === "update" && !exists) {
      throw new Error(`Concept file does not exist for update: ${relativePath}`);
    }
    let existing = null;
    if (op === "update") {
      const currentRevision = this.getConceptRevision(proposal.bundle, proposal.path);
      if (!proposal.baseRevision || currentRevision !== proposal.baseRevision) {
        return this.markProposalConflict(proposal, currentRevision);
      }
      existing = authoringService.resolveConcept(proposal.targetUri);
      if (
        proposal.bundle !== existing.bundle
        || proposal.path !== existing.path
        || proposal.targetPathUri !== existing.pathUri
      ) {
        throw new Error("Update proposal target does not match the current concept identity.");
      }
    }
    const candidate = {
      bundle: proposal.bundle,
      path: proposal.path,
      frontmatter: proposal.frontmatter,
      body: proposal.body,
    };
    const validation = op === "update"
      ? authoringService.validateUpdateCandidate(candidate, existing)
      : op === "create_computation"
        ? authoringService.validateAttestedComputation(candidate, {
          assetFiles: proposal.assetFiles || [],
          accepting: true,
        })
        : authoringService.validateConcept(candidate);
    if (!validation.valid) {
      proposal.validation = validation;
      this.saveExistingProposal(proposal);
      return { accepted: false, proposal, validation };
    }
    if (op === "create_computation") {
      const normalizeDependencies = (entries) => (Array.isArray(entries) ? entries : [])
        .map((entry) => ({
          field: entry.field,
          bundle: entry.bundle,
          path: entry.path,
          bytes: entry.bytes,
          revision: entry.revision,
        }))
        .sort((left, right) => `${left.field}\u0000${left.bundle}\u0000${left.path}`.localeCompare(`${right.field}\u0000${right.bundle}\u0000${right.path}`));
      const expectedDependencies = normalizeDependencies(proposal.dependencyRevisions);
      const actualDependencies = normalizeDependencies(validation.dependencyRevisions);
      if (JSON.stringify(expectedDependencies) !== JSON.stringify(actualDependencies)) {
        proposal.conflict = {
          code: "computation_dependency_changed",
          expectedDependencies,
          actualDependencies,
          detectedAt: nowIso(),
        };
        proposal.validation = validation;
        this.saveExistingProposal(proposal);
        return {
          accepted: false,
          conflict: true,
          message: "A referenced computation dependency changed after review. Create a new proposal from the current artifacts.",
          proposal,
          validation,
        };
      }
    }
    let rollbackAcceptance = null;
    if (op === "update") {
      const currentRevision = this.getConceptRevision(proposal.bundle, proposal.path);
      if (currentRevision !== proposal.baseRevision) {
        return this.markProposalConflict(proposal, currentRevision);
      }
      const safeTarget = this.resolveConceptFile(proposal.bundle, proposal.path);
      const originalText = fs.readFileSync(safeTarget.absolutePath, "utf8");
      const write = writeFileAtomic(safeTarget.absolutePath, validation.markdown, proposal.baseRevision);
      if (!write.written) {
        return this.markProposalConflict(proposal, write.currentRevision);
      }
      rollbackAcceptance = () => {
        const rollback = writeFileAtomic(
          safeTarget.absolutePath,
          originalText,
          revisionFor(validation.markdown),
        );
        if (!rollback.written) {
          throw new Error("Could not roll back an update after proposal status persistence failed.");
        }
      };
    } else if (op === "create_computation") {
      const assetTargets = (proposal.assetFiles || []).map((asset) => {
        const target = this.resolveBundleFile(proposal.bundle, asset.path);
        if (fs.existsSync(target.absolutePath)) {
          throw new Error(`Computation asset already exists: ${target.relativePath}`);
        }
        return Object.assign({}, asset, target);
      });
      const staged = [];
      const written = [];
      const allTargets = assetTargets.concat([{ relativePath, absolutePath, content: validation.markdown }]);
      const uniqueTargets = new Set(allTargets.map((target) => path.resolve(target.absolutePath)));
      if (uniqueTargets.size !== allTargets.length) {
        throw new Error("Computation proposal targets must resolve to distinct files.");
      }
      try {
        allTargets.forEach((target) => {
          ensureDir(path.dirname(target.absolutePath));
          const temporaryPath = path.join(
            path.dirname(target.absolutePath),
            `.${path.basename(target.absolutePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
          );
          fs.writeFileSync(temporaryPath, target.content, { encoding: "utf8", flag: "wx" });
          staged.push({ temporaryPath, absolutePath: target.absolutePath });
        });
        staged.forEach((target) => {
          fs.renameSync(target.temporaryPath, target.absolutePath);
          written.push(target.absolutePath);
        });
        rollbackAcceptance = () => {
          written.slice().reverse().forEach((target) => {
            if (fs.existsSync(target)) {
              fs.unlinkSync(target);
            }
          });
        };
      } catch (error) {
        staged.forEach((target) => {
          if (fs.existsSync(target.temporaryPath)) {
            fs.unlinkSync(target.temporaryPath);
          }
        });
        written.forEach((target) => {
          if (fs.existsSync(target)) {
            fs.unlinkSync(target);
          }
        });
        throw error;
      }
    } else {
      ensureDir(path.dirname(absolutePath));
      const safeTarget = this.resolveConceptFile(proposal.bundle, proposal.path);
      fs.writeFileSync(safeTarget.absolutePath, validation.markdown, { encoding: "utf8", flag: "wx" });
      rollbackAcceptance = () => {
        if (fs.existsSync(safeTarget.absolutePath)) {
          fs.unlinkSync(safeTarget.absolutePath);
        }
      };
    }
    proposal.status = "accepted";
    proposal.acceptedAt = nowIso();
    proposal.validation = validation;
    try {
      this.saveExistingProposal(proposal);
    } catch (error) {
      try {
        if (rollbackAcceptance) {
          rollbackAcceptance();
        }
      } finally {
        proposal.status = "proposed";
        delete proposal.acceptedAt;
      }
      throw error;
    }
    return {
      accepted: true,
      created: op === "create" || op === "create_computation",
      updated: op === "update",
      proposal,
      validation,
    };
  }

  async rejectProposal(id, reason) {
    return this.withProposalLock(id, (canonicalId) => this.rejectProposalUnlocked(canonicalId, reason));
  }

  async rejectProposalUnlocked(id, reason) {
    const proposal = await this.getProposal(id);
    if (proposal.status !== "proposed") {
      throw new Error(`Only proposed concepts can be rejected. Current status: ${proposal.status}`);
    }
    proposal.status = "rejected";
    proposal.rejectedAt = nowIso();
    proposal.rejectionReason = reason || "";
    this.saveExistingProposal(proposal);
    return proposal;
  }

  async saveMigrationManifest(input) {
    const id = input.id || proposalId();
    const timestamp = nowIso();
    const manifest = Object.assign({
      id,
      status: "proposed",
      kind: "okf-v0.2-stage-a",
      createdAt: timestamp,
      updatedAt: timestamp,
    }, input, { id });
    writeJson(this.proposalFile(id, "migrations", true), manifest);
    return manifest;
  }

  removeProposal(id) {
    const filePath = this.proposalFile(id, "", false);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  removeMigrationManifest(id) {
    const filePath = this.proposalFile(id, "migrations", false);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = {
  FileConceptStore,
  normalizeBundleFilePath,
};
