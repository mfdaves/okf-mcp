"use strict";

const path = require("path");
const {
  itemLiteral,
  markdownStructure,
  nodeText,
  sectionNodes,
} = require("./markdown");

const V02_VERSION = "0.2";

const V02_ADDITIVE_FIELDS = new Set([
  "sources",
  "usage_window",
  "generated",
  "verified",
  "status",
  "stale_after",
  "runtime",
  "parameters",
  "computation",
  "executor",
  "attester",
]);

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function documentsFrom(source) {
  if (Array.isArray(source)) {
    return source;
  }
  if (source && Array.isArray(source.documents)) {
    return source.documents;
  }
  if (source && source.index && Array.isArray(source.index.documents)) {
    return source.index.documents;
  }
  return [];
}

function sourceIndex(source) {
  return source && source.index && Array.isArray(source.index.documents)
    ? source.index
    : source || {};
}

function documentIdentity(doc) {
  return String((doc && (doc.uri || doc.pathUri || doc.path)) || "<unknown>");
}

function documentSummary(doc) {
  return {
    uri: documentIdentity(doc),
    path: normalizePath(doc && doc.path),
  };
}

function issue(code, message, details) {
  return Object.assign({
    code,
    severity: "error",
    message,
  }, details || {});
}

function issueKey(entry) {
  return [
    entry.code,
    entry.bundle,
    entry.path || entry.uri,
    entry.value,
    entry.message,
  ].map((value) => String(value || "")).join("\u0000");
}

function uniqueIssues(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = issueKey(entry);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function citationSource(item) {
  const text = String(item || "").trim();
  const markdownLink = text.match(/^\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
  if (markdownLink) {
    return {
      resource: markdownLink[2],
      title: markdownLink[1].trim(),
    };
  }
  const url = text.match(/^(?:([^\n]+?)\s*[:;–—-]\s*)?(https?:\/\/[^\s<>]+)$/);
  if (url) {
    const title = String(url[1] || "").trim();
    return Object.assign({ resource: url[2] }, title ? { title } : {});
  }
  const pathValue = text.match(/^`((?:\.\.?\/|\/|references\/)[^`]+)`$/)
    || text.match(/^((?:\.\.?\/|\/|references\/)[^\s]+)$/);
  if (pathValue) {
    return { resource: pathValue[1] };
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(text)) {
    return { resource: text };
  }
  return null;
}

function extractLegacyCitations(body) {
  const structure = markdownStructure(body);
  const headings = structure.headings.filter((heading) => (
    heading.level === 1 && heading.text.toLowerCase() === "citations"
  ));
  if (!headings.length) {
    return { found: false, sources: [], unparsed: [], sectionCount: 0 };
  }
  if (headings.length > 1) {
    return { found: true, sources: [], unparsed: [], sectionCount: headings.length };
  }
  const heading = headings[0];
  const blocks = sectionNodes(heading);
  const firstNonList = blocks.findIndex((node) => node.type !== "list");
  const flatBlocks = firstNonList === -1 ? blocks : blocks.slice(0, firstNonList);
  const lists = new Set(flatBlocks.filter((node) => node.type === "list"));
  const sources = [];
  const unparsed = blocks.filter((node) => node.type !== "list").map((node) => (
    nodeText(node).trim() || `[${node.type}]`
  ));
  const seen = new Set();
  const items = structure.items.filter((item) => lists.has(item.node.parent));
  for (const item of items) {
    const literal = itemLiteral(structure, item);
    const source = literal && citationSource(literal);
    if (!source) {
      unparsed.push(literal || structure.lines.slice(item.startLine - 1, item.endLine).join(" ").trim());
      continue;
    }
    if (!seen.has(source.resource)) {
      seen.add(source.resource);
      sources.push(source);
    }
  }
  return { found: true, sources, unparsed, sectionCount: 1 };
}

function normalizedTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return null;
  }
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function unsafeLocalResource(documentPath, resource) {
  const raw = String(resource || "").trim().replace(/\\/g, "/").split("#")[0];
  if (!raw || raw.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
    return false;
  }
  const relative = raw.startsWith("/")
    ? path.posix.normalize(raw.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(normalizePath(documentPath)), raw));
  return !relative || relative === "." || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative);
}

function validActor(value) {
  const actor = String(value || "").trim();
  return /^(?:human:[^\s]+|process:[^\s]+|[^\s/:]+\/[^\s/]+)$/.test(actor);
}

function actorMappingFor(doc, options) {
  const mappings = (options && options.actorMappings) || {};
  const keys = [doc && doc.uri, doc && doc.pathUri, doc && doc.path, "$default"]
    .filter(Boolean);
  for (const key of keys) {
    if (!hasOwn(mappings, key)) {
      continue;
    }
    const mapping = mappings[key];
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      return { key, by: "", confirmed: false, valid: false };
    }
    const by = String(mapping.by || "").trim();
    const confirmed = mapping.confirmed === true;
    return { key, by, confirmed, valid: confirmed && validActor(by) };
  }
  return null;
}

function generatedPathSet(options) {
  const configured = options && (options.generatedPaths || options.generatedFiles);
  if (configured instanceof Set) {
    return new Set(Array.from(configured, normalizePath));
  }
  return new Set(Array.isArray(configured) ? configured.map(normalizePath) : []);
}

function isGeneratedFile(doc, options) {
  const frontmatter = (doc && doc.frontmatter) || {};
  return generatedPathSet(options).has(normalizePath(doc && doc.path))
    || Boolean(doc && (doc.generatedFile === true || doc.isGenerated === true))
    || frontmatter.generated_file === true
    || frontmatter.generatedFile === true;
}

function discoverCollisions(documents, options) {
  const ids = new Map();
  const aliases = new Map();
  const collisions = [];

  documents.filter((doc) => !doc.reserved).forEach((doc) => {
    const frontmatter = doc.frontmatter || {};
    const id = String(frontmatter.id || doc.uri || doc.pathUri || "").trim();
    if (id) {
      const normalized = id.toLowerCase();
      if (!ids.has(normalized)) {
        ids.set(normalized, { value: id, documents: [] });
      }
      ids.get(normalized).documents.push(documentSummary(doc));
    }
    const docAliases = Array.isArray(doc.uriAliases) ? doc.uriAliases : [];
    new Set(docAliases.map((value) => String(value).trim()).filter(Boolean)).forEach((alias) => {
      const normalized = alias.toLowerCase();
      if (!aliases.has(normalized)) {
        aliases.set(normalized, { value: alias, documents: [] });
      }
      aliases.get(normalized).documents.push(documentSummary(doc));
    });
  });

  ids.forEach((entry) => {
    if (entry.documents.length > 1) {
      collisions.push({ kind: "id", value: entry.value, documents: entry.documents, origin: "discovered" });
    }
  });
  aliases.forEach((entry, key) => {
    if (entry.documents.length > 1) {
      collisions.push({ kind: "alias", value: entry.value, documents: entry.documents, origin: "discovered" });
    }
    if (ids.has(key)) {
      const idEntry = ids.get(key);
      const documentUris = new Set(entry.documents.map((doc) => doc.uri));
      const crossDocuments = idEntry.documents.filter((doc) => !documentUris.has(doc.uri));
      if (crossDocuments.length) {
        collisions.push({
          kind: "alias_id",
          value: entry.value,
          documents: entry.documents.concat(crossDocuments),
          origin: "discovered",
        });
      }
    }
  });

  [
    ["id", options && options.idCollisions],
    ["alias", options && options.aliasCollisions],
  ].forEach(([kind, entries]) => {
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      collisions.push(typeof entry === "string"
        ? { kind, value: entry, documents: [], origin: "provided" }
        : Object.assign({ kind, documents: [], origin: "provided" }, entry || {}));
    });
  });
  return collisions;
}

function referenceKind(resource) {
  const value = String(resource || "");
  if (/^https?:\/\//i.test(value)) {
    return "external_url";
  }
  if (value.startsWith("/")) {
    return "bundle_absolute";
  }
  if (value.startsWith("./") || value.startsWith("../") || value.includes("/")) {
    return "relative_path";
  }
  return "opaque";
}

function collectReferencedAssets(documents) {
  const assets = [];
  const seen = new Set();
  function add(doc, field, kind, resource, extra) {
    if (typeof resource !== "string" || !resource.trim()) {
      return;
    }
    const entry = Object.assign({
      uri: documentIdentity(doc),
      path: normalizePath(doc.path),
      field,
      kind,
      resource: resource.trim(),
      referenceKind: referenceKind(resource),
    }, extra || {});
    const key = [entry.uri, field, entry.resource, entry.sourceId || ""].join("\u0000");
    if (!seen.has(key)) {
      seen.add(key);
      assets.push(entry);
    }
  }
  documents.filter((doc) => !doc.reserved).forEach((doc) => {
    const fm = doc.frontmatter || {};
    add(doc, "resource", "concept_resource", fm.resource);
    (Array.isArray(fm.sources) ? fm.sources : []).forEach((source, index) => {
      if (source && typeof source === "object") {
        add(doc, `sources[${index}].resource`, "source", source.resource, { sourceId: source.id || null });
      }
    });
    add(doc, "computation", "computation", fm.computation);
    add(doc, "executor.resource", "executor", fm.executor && fm.executor.resource);
    add(doc, "attester.resource", "attester", fm.attester && fm.attester.resource);
  });
  return assets;
}

function resolveBundle(documents, options) {
  const requested = options && options.bundle ? String(options.bundle) : "";
  const bundleIds = Array.from(new Set(documents.map((doc) => doc && doc.bundle).filter(Boolean).map(String)));
  if (requested) {
    return requested;
  }
  if (bundleIds.length > 1) {
    throw new TypeError("checkV02Migration requires options.bundle when documents contain multiple bundles.");
  }
  return bundleIds[0] || "bundle";
}

function checkV02Migration(source, options) {
  const config = options || {};
  const allDocuments = documentsFrom(source);
  const bundle = resolveBundle(allDocuments, config);
  const documents = allDocuments.filter((doc) => !doc.bundle || String(doc.bundle) === bundle);
  const index = sourceIndex(source);
  const rootIndex = documents.find((doc) => normalizePath(doc.path) === "index.md") || null;
  const rootFrontmatter = (rootIndex && rootIndex.frontmatter) || {};
  const declaredVersion = hasOwn(rootFrontmatter, "okf_version")
    ? String(rootFrontmatter.okf_version).trim()
    : null;
  const timestampCandidates = [];
  const citationCandidates = [];
  const actorMappingNeeds = [];
  const generatedFileSkips = [];
  const nativeFieldWins = [];
  const blockers = [];
  let legacyMarkers = 0;
  let pendingLegacyMarkers = 0;
  let nativeMarkers = 0;

  documents.filter((doc) => !doc.reserved).forEach((doc) => {
    const fm = doc.frontmatter || {};
    const citations = extractLegacyCitations(doc.body);
    const generatedFile = isGeneratedFile(doc, config);
    const summary = documentSummary(doc);
    const hasTimestamp = hasOwn(fm, "timestamp");
    const hasGenerated = hasOwn(fm, "generated");
    const hasSources = hasOwn(fm, "sources");
    const hasNativeFields = Object.keys(fm).some((key) => V02_ADDITIVE_FIELDS.has(key))
      || String(fm.type || "").toLowerCase() === "attested computation";

    if (hasTimestamp) {
      legacyMarkers += 1;
    }
    if (citations.found) {
      legacyMarkers += 1;
    }
    if (hasNativeFields) {
      nativeMarkers += 1;
    }

    if (hasTimestamp && hasGenerated) {
      nativeFieldWins.push(Object.assign({ nativeField: "generated", legacyField: "timestamp" }, summary));
    } else if (hasTimestamp) {
      pendingLegacyMarkers += 1;
      const timestamp = normalizedTimestamp(fm.timestamp);
      const mapping = actorMappingFor(doc, config);
      const candidate = Object.assign({
        timestamp: timestamp || String(fm.timestamp || ""),
        actorMapping: mapping,
        ready: Boolean(timestamp && mapping && mapping.valid && !generatedFile),
        skipped: generatedFile,
      }, summary);
      timestampCandidates.push(candidate);
      if (!timestamp) {
        blockers.push(issue("invalid_legacy_timestamp", "Legacy timestamp is not an ISO 8601 datetime.", Object.assign({ bundle }, summary)));
      }
      if (!mapping || !mapping.valid) {
        const need = Object.assign({
          field: "generated.by",
          reason: mapping ? "mapping_not_confirmed_or_invalid" : "mapping_missing",
        }, summary);
        actorMappingNeeds.push(need);
        blockers.push(issue(
          "truthful_actor_mapping_required",
          "A confirmed, convention-valid actor mapping is required before migrating timestamp to generated.at.",
          Object.assign({ bundle }, need),
        ));
      }
    }

    if (citations.found && hasSources) {
      nativeFieldWins.push(Object.assign({ nativeField: "sources", legacyField: "# Citations" }, summary));
    } else if (citations.found) {
      pendingLegacyMarkers += 1;
      const candidate = Object.assign({
        sources: citations.sources,
        unparsed: citations.unparsed,
        sectionCount: citations.sectionCount,
        unsafeResources: citations.sources.filter((source) => unsafeLocalResource(doc.path, source.resource)).map((source) => source.resource),
        ready: citations.sources.length > 0
          && citations.unparsed.length === 0
          && citations.sectionCount === 1
          && !citations.sources.some((source) => unsafeLocalResource(doc.path, source.resource))
          && !generatedFile,
        skipped: generatedFile,
      }, summary);
      citationCandidates.push(candidate);
      if (citations.sectionCount > 1) {
        blockers.push(issue(
          "multiple_legacy_citation_sections",
          "Multiple legacy # Citations sections are ambiguous and require manual consolidation.",
          Object.assign({ bundle, sectionCount: citations.sectionCount }, summary),
        ));
      }
      if (!citations.sources.length) {
        blockers.push(issue("empty_legacy_citations", "Legacy # Citations has no safely convertible entries.", Object.assign({ bundle }, summary)));
      }
      if (citations.unparsed.length) {
        blockers.push(issue(
          "unparseable_legacy_citation",
          "One or more legacy citation entries cannot be converted without interpretation.",
          Object.assign({ bundle, entries: citations.unparsed }, summary),
        ));
      }
      if (candidate.unsafeResources.length) {
        blockers.push(issue(
          "unsafe_legacy_citation_resource",
          "A legacy citation resource resolves outside the bundle and cannot be migrated.",
          Object.assign({ bundle, resources: candidate.unsafeResources }, summary),
        ));
      }
    }

    if (generatedFile && (
      (hasTimestamp && !hasGenerated)
      || (citations.found && !hasSources)
    )) {
      const skip = Object.assign({ reason: "generated_file_requires_generator_change" }, summary);
      generatedFileSkips.push(skip);
      blockers.push(issue(
        "generated_file_requires_generator_change",
        "Generated concepts must be migrated in their generator, not through a concept update proposal.",
        Object.assign({ bundle }, summary),
      ));
    }

    if (doc.valid === false) {
      blockers.push(issue("invalid_concept", "Invalid concepts block a truthful v0.2 version declaration.", Object.assign({ bundle }, summary)));
    }
    (doc.conformanceDiagnostics || []).filter((entry) => entry.severity === "error").forEach((entry) => {
      blockers.push(issue(entry.code || "conformance_error", entry.message || "Conformance error.", Object.assign({ bundle }, summary)));
    });
    (doc.v02Diagnostics || []).forEach((entry) => {
      blockers.push(issue(entry.code || "invalid_v02_metadata", entry.message || "Invalid OKF v0.2 metadata.", Object.assign({ bundle }, summary)));
    });
  });

  documents.filter((doc) => doc.reserved).forEach((doc) => {
    (doc.conformanceDiagnostics || []).filter((entry) => entry.severity === "error").forEach((entry) => {
      blockers.push(issue(entry.code || "conformance_error", entry.message || "Reserved resource conformance error.", {
        bundle,
        path: normalizePath(doc.path),
        uri: documentIdentity(doc),
      }));
    });
  });

  if (declaredVersion && declaredVersion !== "0.1" && declaredVersion !== V02_VERSION) {
    blockers.push(issue("unsupported_declared_version", `Unsupported declared OKF version: ${declaredVersion}`, {
      bundle,
      path: rootIndex && rootIndex.path,
    }));
  }

  const indexErrors = Array.isArray(index.errors) ? index.errors : [];
  indexErrors.filter((entry) => !entry.bundle || String(entry.bundle) === bundle).forEach((entry) => {
    blockers.push(issue(entry.code || "index_error", entry.message || "Index error blocks migration.", Object.assign({ bundle }, entry)));
  });
  (Array.isArray(index.diagnostics) ? index.diagnostics : []).filter((entry) => (
    (!entry.bundle || String(entry.bundle) === bundle)
    && (entry.invalidatesProject || entry.severity === "error")
  )).forEach((entry) => {
    blockers.push(issue(entry.code || "project_validation_error", entry.message || "Project validation error blocks migration.", Object.assign({ bundle }, entry)));
  });
  (Array.isArray(index.warnings) ? index.warnings : []).filter((entry) => (
    (!entry.bundle || String(entry.bundle) === bundle)
    && String(entry.code || "").startsWith("asset_")
  )).forEach((entry) => {
    blockers.push(issue(entry.code, entry.message || "Referenced asset error blocks migration.", Object.assign({ bundle }, entry)));
  });
  (Array.isArray(config.blockers) ? config.blockers : []).forEach((entry) => {
    blockers.push(typeof entry === "string"
      ? issue("provided_blocker", entry, { bundle })
      : issue(entry.code || "provided_blocker", entry.message || "Provided migration blocker.", Object.assign({ bundle }, entry)));
  });

  const collisions = discoverCollisions(documents, config);
  collisions.forEach((collision) => {
    blockers.push(issue(
      `${collision.kind}_collision`,
      `Migration is blocked by ${collision.kind.replace(/_/g, "/")} collision: ${collision.value || "<unknown>"}`,
      { bundle, value: collision.value, documents: collision.documents, origin: collision.origin },
    ));
  });

  const rootPresent = Boolean(rootIndex);
  if (!rootPresent) {
    blockers.push(issue(
      "missing_root_index",
      "A bundle-root index.md is required before declaring OKF v0.2.",
      { bundle, path: "index.md" },
    ));
  }

  let contentClassification;
  const declaredV01 = declaredVersion === "0.1";
  const declaredV02 = declaredVersion === V02_VERSION;
  if ((pendingLegacyMarkers > 0 && nativeMarkers > 0)
    || (declaredV01 && nativeMarkers > 0)
    || (declaredV02 && pendingLegacyMarkers > 0)) {
    contentClassification = "mixed";
  } else if (pendingLegacyMarkers > 0 || declaredV01) {
    contentClassification = "v0.1";
  } else if (nativeMarkers > 0 || declaredV02) {
    contentClassification = "v0.2";
  } else {
    contentClassification = "undeclared";
  }

  const uniqueBlockers = uniqueIssues(blockers);
  const classification = uniqueBlockers.length ? "blocked" : contentClassification;
  const conceptCandidates = timestampCandidates.length + citationCandidates.length;
  const readyConceptCandidates = timestampCandidates.filter((entry) => entry.ready).length
    + citationCandidates.filter((entry) => entry.ready).length;
  return {
    bundle,
    targetVersion: V02_VERSION,
    declaredVersion,
    classification,
    contentClassification,
    legacyMarkers,
    pendingLegacyMarkers,
    nativeMarkers,
    candidates: {
      timestamps: timestampCandidates,
      citations: citationCandidates,
    },
    nativeFieldWins,
    actorMappingNeeds,
    collisions,
    generatedFileSkips,
    referencedAssets: collectReferencedAssets(documents),
    blockers: uniqueBlockers,
    readiness: {
      stageA: uniqueBlockers.length === 0 && conceptCandidates === readyConceptCandidates,
      conceptProposals: conceptCandidates === readyConceptCandidates,
      versionDeclaration: uniqueBlockers.length === 0 && conceptCandidates === readyConceptCandidates && rootPresent,
      rootIndexPresent: rootPresent,
    },
    readOnly: true,
    writesPerformed: false,
  };
}

function buildV02MigrationPlan(source, options) {
  const report = checkV02Migration(source, options);
  const proposals = new Map();

  function proposalFor(candidate) {
    if (!proposals.has(candidate.uri)) {
      proposals.set(candidate.uri, {
        kind: "concept_update",
        phase: "stage-a",
        target: { bundle: report.bundle, uri: candidate.uri, path: candidate.path },
        tool: "okf_propose_update",
        arguments: {
          uri: candidate.uri,
          frontmatter: {},
          message: "Prepare a review-only OKF v0.2 Stage-A metadata migration.",
        },
        retainedLegacyFields: [],
        requiresExplicitApproval: true,
      });
    }
    return proposals.get(candidate.uri);
  }

  report.candidates.timestamps.filter((candidate) => candidate.ready).forEach((candidate) => {
    const proposal = proposalFor(candidate);
    proposal.arguments.frontmatter.generated = {
      by: candidate.actorMapping.by,
      at: candidate.timestamp,
    };
    proposal.retainedLegacyFields.push("timestamp");
  });

  report.candidates.citations.filter((candidate) => candidate.ready).forEach((candidate) => {
    const proposal = proposalFor(candidate);
    proposal.arguments.frontmatter.sources = candidate.sources.map((sourceEntry) => Object.assign({}, sourceEntry));
    proposal.retainedLegacyFields.push("# Citations");
  });

  const conceptProposals = Array.from(proposals.values()).sort((left, right) => (
    left.target.path.localeCompare(right.target.path)
  ));
  conceptProposals.forEach((proposal, index) => {
    proposal.sequence = index + 1;
    proposal.retainedLegacyFields = Array.from(new Set(proposal.retainedLegacyFields));
  });

  let versionDeclaration = null;
  if (report.readiness.versionDeclaration && report.declaredVersion !== V02_VERSION) {
    versionDeclaration = {
      kind: "bundle_version_declaration",
      phase: "after-stage-a-validation",
      sequence: conceptProposals.length + 1,
      operation: "propose_reserved_index_update",
      target: { bundle: report.bundle, path: "index.md" },
      frontmatter: { okf_version: V02_VERSION },
      prerequisites: [
        "all Stage-A concept proposals are explicitly approved and accepted",
        "the complete bundle passes validation after those acceptances",
      ],
      requiresExplicitApproval: true,
    };
  }

  return {
    stage: "A",
    targetVersion: V02_VERSION,
    classification: report.classification,
    ready: report.readiness.stageA,
    report,
    conceptProposals,
    versionDeclaration,
    steps: versionDeclaration ? conceptProposals.concat(versionDeclaration) : conceptProposals.slice(),
    writesPerformed: false,
    proposalsCreated: false,
    proposalsAccepted: false,
  };
}

module.exports = {
  V02_VERSION,
  buildV02MigrationPlan,
  checkV02Migration,
  extractLegacyCitations,
};
