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

  async acceptProposal(id, authoringService) {
    const proposal = await this.getProposal(id);
    if (proposal.status !== "proposed") {
      throw new Error(`Only proposed concepts can be accepted. Current status: ${proposal.status}`);
    }
    const validation = authoringService.validateConcept({
      bundle: proposal.bundle,
      path: proposal.path,
      frontmatter: proposal.frontmatter,
      body: proposal.body,
    });
    if (!validation.valid) {
      proposal.validation = validation;
      this.saveExistingProposal(proposal);
      return { accepted: false, proposal, validation };
    }
    const bundle = this.getBundle(proposal.bundle);
    const relativePath = normalizeConceptPath(proposal.path);
    const absolutePath = path.resolve(bundle.root, relativePath);
    const relative = path.relative(path.resolve(bundle.root), absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Accepted concept path resolves outside bundle root.");
    }
    if (fs.existsSync(absolutePath)) {
      throw new Error(`Concept file already exists: ${relativePath}`);
    }
    ensureDir(path.dirname(absolutePath));
    fs.writeFileSync(absolutePath, validation.markdown, "utf8");
    proposal.status = "accepted";
    proposal.acceptedAt = nowIso();
    proposal.validation = validation;
    this.saveExistingProposal(proposal);
    return { accepted: true, proposal, validation };
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
