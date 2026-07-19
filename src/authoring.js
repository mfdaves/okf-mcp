"use strict";

const path = require("path");
const yaml = require("js-yaml");
const { parseMarkdownText, normalizeSlashes } = require("./parser");
const { resolveLinkPath } = require("./indexer");

function slug(value, fallback) {
  const text = String(value || fallback || "concept").trim().toLowerCase();
  return text
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || String(fallback || "concept");
}

function normalizeConceptPath(value) {
  const raw = normalizeSlashes(String(value || "").trim());
  if (!raw) {
    throw new Error("Concept path is required.");
  }
  if (raw.startsWith("/") || raw.includes("\0")) {
    throw new Error("Concept path must be a safe relative path.");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error("Concept path must stay inside the bundle.");
  }
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Concept path contains an unsafe segment.");
  }
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new Error("Concept path must end with .md.");
  }
  const base = path.posix.basename(normalized).toLowerCase();
  if (base === "index.md" || base === "log.md") {
    throw new Error("Concept path cannot be a reserved index.md or log.md file.");
  }
  return normalized;
}

function renderFrontmatter(frontmatter) {
  const values = Object.fromEntries(
    Object.entries(frontmatter || {}).filter((entry) => entry[1] !== undefined),
  );
  return yaml.dump(values, {
    schema: yaml.CORE_SCHEMA,
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  }).trimEnd();
}

function renderConceptMarkdown(input) {
  const frontmatter = Object.assign({}, input && input.frontmatter ? input.frontmatter : {});
  const body = String((input && input.body) || "").replace(/\r\n/g, "\n").trim();
  return [
    "---",
    renderFrontmatter(frontmatter),
    "---",
    "",
    body || `# ${frontmatter.title || path.posix.basename(input.path || "concept.md", ".md")}`,
    "",
  ].join("\n");
}

function relationFrom(value, doc) {
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/);
    if (parts.length === 1) {
      return { type: "related_to", target: parts[0], source: doc.uri };
    }
    return { type: parts[0], target: parts.slice(1).join(" "), source: doc.uri };
  }
  if (value && typeof value === "object") {
    return {
      type: value.type || value.kind || "related_to",
      target: value.target || value.to || "",
      source: doc.uri,
      label: value.label || value.text || "",
      description: value.description || "",
    };
  }
  return { type: "related_to", target: "", source: doc.uri };
}

class ConceptAuthoringService {
  constructor(store) {
    this.store = store;
  }

  getBundle(id) {
    const bundle = this.store.getBundles().find((entry) => entry.id === id);
    if (!bundle) {
      throw new Error(`Unknown writable OKF bundle: ${id || "<missing>"}`);
    }
    if (bundle.remote) {
      throw new Error(`Cannot write concepts to remote bundle: ${id}`);
    }
    return bundle;
  }

  suggestConceptPath(input) {
    const prefix = input && input.prefix ? normalizeSlashes(String(input.prefix)).replace(/^\/+|\/+$/g, "") : "";
    if (prefix && (prefix === "." || prefix.startsWith("../") || prefix.includes("/../"))) {
      throw new Error("Path prefix must stay inside the bundle.");
    }
    const typePart = slug(input && input.type, "concept");
    const titlePart = slug(input && input.title, typePart);
    return {
      bundle: input && input.bundle,
      path: normalizeConceptPath([prefix, typePart, `${titlePart}.md`].filter(Boolean).join("/")),
    };
  }

  validateConcept(input, options) {
    const bundleId = input && input.bundle;
    const bundle = this.getBundle(bundleId);
    const conceptPath = normalizeConceptPath(input && input.path);
    const frontmatter = Object.assign({}, input && input.frontmatter ? input.frontmatter : {});
    const markdown = renderConceptMarkdown({ path: conceptPath, frontmatter, body: input && input.body });
    const index = this.store.getIndex();
    const replace = options && options.replace;
    const errors = [];
    const warnings = [];
    let doc = null;

    function isReplacedConcept(existing) {
      return Boolean(
        replace
        && existing
        && existing.bundle === replace.bundle
        && existing.path === replace.path,
      );
    }

    try {
      doc = parseMarkdownText(bundle, conceptPath, markdown, `${bundle.root}/${conceptPath}`);
    } catch (error) {
      errors.push({ code: "parse_error", bundle: bundleId, path: conceptPath, message: error.message });
      return { valid: false, bundle: bundleId, path: conceptPath, markdown, errors, warnings };
    }

    doc.warnings.forEach((warning) => {
      const entry = Object.assign({ bundle: bundleId }, warning);
      if (entry.code === "missing_type" || entry.code === "missing_frontmatter" || entry.code === "invalid_id") {
        errors.push(entry);
      } else {
        warnings.push(entry);
      }
    });

    const existingAtPath = index.byUri.get(doc.pathUri);
    if (existingAtPath && !isReplacedConcept(existingAtPath)) {
      errors.push({ code: "duplicate_uri", bundle: bundleId, path: conceptPath, uri: doc.pathUri, message: "Concept path already exists." });
    }
    const existingAtUri = index.byUri.get(doc.uri);
    if (doc.uri !== doc.pathUri && existingAtUri && !isReplacedConcept(existingAtUri)) {
      errors.push({ code: "duplicate_uri", bundle: bundleId, path: conceptPath, uri: doc.uri, message: "Concept id already exists." });
    }

    doc.links.forEach((link) => {
      const resolved = resolveLinkPath(bundle, doc.path, link.href, index.byPathUri);
      if (!resolved) {
        return;
      }
      if (resolved.outsideRoot) {
        warnings.push({ code: "link_outside_root", bundle: bundleId, path: doc.path, href: link.href, message: "Markdown link resolves outside bundle root." });
        return;
      }
      const targetPathUri = `okf://${bundleId}/${resolved.path}`;
      const target = index.byPathUri && index.byPathUri.get(targetPathUri);
      const targetExists = Boolean(target && target.pathUri === targetPathUri);
      if (!targetExists && resolved.uri !== doc.uri && resolved.uri !== doc.pathUri) {
        warnings.push({ code: "broken_link", bundle: bundleId, path: doc.path, href: link.href, target: resolved.path, message: "Markdown link target does not exist in bundle." });
      }
    });

    const relationTypes = new Set(this.store.getRelationTypes().map(String));
    doc.relations.map((relation) => relationFrom(relation, doc)).forEach((relation) => {
      const type = String(relation.type || "related_to");
      const targetUri = String(relation.target || "").trim();
      if (!targetUri) {
        errors.push({ code: "missing_relation_target", bundle: bundleId, path: doc.path, relationType: type, message: "Relation has no target." });
        return;
      }
      if (!relationTypes.has(type)) {
        errors.push({ code: "invalid_relation_type", bundle: bundleId, path: doc.path, relationType: type, message: `Unsupported relation type: ${type}` });
      }
      if (targetUri.startsWith("okf://") && !index.byUri.has(targetUri) && targetUri !== doc.uri && targetUri !== doc.pathUri) {
        errors.push({ code: "broken_relation", bundle: bundleId, path: doc.path, target: targetUri, relationType: type, message: "Relation target does not exist." });
      }
    });

    return {
      valid: errors.length === 0,
      bundle: bundleId,
      path: conceptPath,
      uri: doc.uri,
      pathUri: doc.pathUri,
      markdown,
      concept: {
        uri: doc.uri,
        pathUri: doc.pathUri,
        type: doc.type,
        title: doc.title,
        description: doc.description,
        tags: doc.tags,
        aliases: doc.aliases,
      },
      errors,
      warnings,
    };
  }

  async proposeConcept(input) {
    const validation = this.validateConcept(input || {});
    if (!validation.valid) {
      return { created: false, validation };
    }
    const proposal = await this.store.saveProposal({
      op: "create",
      bundle: validation.bundle,
      path: validation.path,
      frontmatter: Object.assign({}, input.frontmatter || {}),
      body: String(input.body || ""),
      markdown: validation.markdown,
      message: input.message || "",
      validation,
    });
    return { created: true, proposal };
  }

  resolveConcept(uri) {
    const index = this.store.getIndex();
    const existing = uri ? index.byUri.get(uri) : null;
    if (!existing || existing.reserved || !existing.valid) {
      throw new Error(`Unknown valid OKF concept: ${uri || "<missing>"}`);
    }
    this.getBundle(existing.bundle);
    return existing;
  }

  validateUpdateCandidate(input, existing) {
    const validation = this.validateConcept({
      bundle: existing.bundle,
      path: existing.path,
      frontmatter: input.frontmatter,
      body: input.body,
    }, {
      replace: {
        bundle: existing.bundle,
        path: existing.path,
      },
    });
    if (validation.uri !== existing.uri) {
      validation.errors.push({
        code: "immutable_uri",
        bundle: existing.bundle,
        path: existing.path,
        uri: validation.uri,
        message: "Concept updates cannot change the existing concept URI.",
      });
      validation.valid = false;
    }
    return validation;
  }

  async proposeUpdate(input) {
    const uri = input && input.uri;
    if (!uri) {
      throw new Error("okf_propose_update requires uri.");
    }
    const existing = this.resolveConcept(uri);
    const patch = input && input.frontmatter === undefined ? {} : input.frontmatter;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("frontmatter must be an object when provided.");
    }
    const removeKeys = input && input.removeFrontmatterKeys === undefined
      ? []
      : input.removeFrontmatterKeys;
    if (!Array.isArray(removeKeys) || removeKeys.some((key) => typeof key !== "string" || !key.trim())) {
      throw new Error("removeFrontmatterKeys must be an array of non-empty strings.");
    }
    if (removeKeys.includes("id")) {
      throw new Error("Concept updates cannot remove the existing concept id.");
    }
    const hasBody = Boolean(input && Object.prototype.hasOwnProperty.call(input, "body"));
    if (!Object.keys(patch).length && !removeKeys.length && !hasBody) {
      throw new Error("okf_propose_update requires a frontmatter change, a removed key, or a body replacement.");
    }
    const frontmatter = Object.assign({}, existing.frontmatter, patch);
    removeKeys.forEach((key) => {
      delete frontmatter[key];
    });
    const body = hasBody ? String(input.body || "") : existing.body;
    const validation = this.validateUpdateCandidate({ frontmatter, body }, existing);
    if (!validation.valid) {
      return { created: false, op: "update", validation };
    }
    const proposal = await this.store.saveProposal({
      op: "update",
      targetUri: existing.uri,
      targetPathUri: existing.pathUri,
      baseRevision: this.store.getContentRevision(existing.text),
      bundle: validation.bundle,
      path: validation.path,
      frontmatter,
      body,
      markdown: validation.markdown,
      message: input.message || "",
      validation,
    });
    return { created: true, op: "update", proposal };
  }

  async listProposals(input) {
    return this.store.listProposals(input || {});
  }

  async getProposal(input) {
    return this.store.getProposal(input && input.proposalId);
  }

  async acceptProposal(input) {
    return this.store.acceptProposal(input && input.proposalId, this);
  }

  async rejectProposal(input) {
    return this.store.rejectProposal(input && input.proposalId, input && input.reason);
  }
}

module.exports = {
  ConceptAuthoringService,
  normalizeConceptPath,
  renderConceptMarkdown,
  slug,
};
