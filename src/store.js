"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildIndex } = require("./indexer");
const { loadProjectConfig } = require("./project");
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

function safeProposalFile(root, id) {
  const clean = String(id || "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(clean)) {
    throw new Error(`Invalid proposal id: ${id || "<missing>"}`);
  }
  return path.join(root, `${clean}.json`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
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

function rejectSymlinkTraversal(realRoot, relativePath) {
  const segments = relativePath.split("/");
  let current = realRoot;
  segments.forEach((segment, index) => {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      return;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Concept path cannot traverse a symbolic link: ${segments.slice(0, index + 1).join("/")}`);
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
    this.proposalRoot = options.proposalRoot || path.join((this.project && this.project.root) || process.cwd(), ".okf-proposals");
  }

  static fromProject(projectPath, options) {
    const project = loadProjectConfig(projectPath);
    return new FileConceptStore({
      project,
      bundles: project.bundles,
      relationTypes: project.relationTypes,
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
    return buildIndex(this.bundles, { relationTypes: this.relationTypes });
  }

  getBundle(id) {
    const bundle = this.bundles.find((entry) => entry.id === id);
    if (!bundle) {
      throw new Error(`Unknown writable OKF bundle: ${id || "<missing>"}`);
    }
    return bundle;
  }

  resolveConceptFile(bundleId, conceptPath) {
    const bundle = this.getBundle(bundleId);
    const relativePath = normalizeConceptPath(conceptPath);
    const realRoot = fs.realpathSync(bundle.root);
    const absolutePath = path.resolve(realRoot, ...relativePath.split("/"));
    if (!isInside(realRoot, absolutePath)) {
      throw new Error("Concept path resolves outside bundle root.");
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

  listProposalFiles() {
    if (!fs.existsSync(this.proposalRoot)) {
      return [];
    }
    return fs.readdirSync(this.proposalRoot)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(this.proposalRoot, name));
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
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeJson(safeProposalFile(this.proposalRoot, id), proposal);
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
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
    }));
  }

  async getProposal(id) {
    const filePath = safeProposalFile(this.proposalRoot, id);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Unknown OKF proposal: ${id || "<missing>"}`);
    }
    return readJson(filePath);
  }

  saveExistingProposal(proposal) {
    proposal.updatedAt = nowIso();
    writeJson(safeProposalFile(this.proposalRoot, proposal.id), proposal);
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

  async acceptProposal(id, authoringService) {
    const proposal = await this.getProposal(id);
    if (proposal.status !== "proposed") {
      throw new Error(`Only proposed concepts can be accepted. Current status: ${proposal.status}`);
    }
    const op = proposal.op || "create";
    if (op !== "create" && op !== "update") {
      throw new Error(`Unsupported proposal operation: ${op}`);
    }
    const { relativePath, absolutePath } = this.resolveConceptFile(proposal.bundle, proposal.path);
    const exists = fs.existsSync(absolutePath);
    if (op === "create" && exists) {
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
      : authoringService.validateConcept(candidate);
    if (!validation.valid) {
      proposal.validation = validation;
      this.saveExistingProposal(proposal);
      return { accepted: false, proposal, validation };
    }
    if (op === "update") {
      const currentRevision = this.getConceptRevision(proposal.bundle, proposal.path);
      if (currentRevision !== proposal.baseRevision) {
        return this.markProposalConflict(proposal, currentRevision);
      }
      const safeTarget = this.resolveConceptFile(proposal.bundle, proposal.path);
      const write = writeFileAtomic(safeTarget.absolutePath, validation.markdown, proposal.baseRevision);
      if (!write.written) {
        return this.markProposalConflict(proposal, write.currentRevision);
      }
    } else {
      ensureDir(path.dirname(absolutePath));
      const safeTarget = this.resolveConceptFile(proposal.bundle, proposal.path);
      fs.writeFileSync(safeTarget.absolutePath, validation.markdown, { encoding: "utf8", flag: "wx" });
    }
    proposal.status = "accepted";
    proposal.acceptedAt = nowIso();
    proposal.validation = validation;
    this.saveExistingProposal(proposal);
    return {
      accepted: true,
      created: op === "create",
      updated: op === "update",
      proposal,
      validation,
    };
  }

  async rejectProposal(id, reason) {
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
}

module.exports = {
  FileConceptStore,
};
