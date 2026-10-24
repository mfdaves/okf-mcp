"use strict";

const fs = require("node:fs");
const path = require("path");
const {
  conceptSignals,
  conceptSummary,
  recoverConceptLocator,
  resolveConcept,
  validateIndex,
} = require("../../indexer");
const { describeConceptGitSources } = require("../../git-source");
const {
  READ_ONLY,
  ToolExecutionError,
  defineTool,
  jsonContent,
  nonEmptyStringParameter,
} = require("../registry");

function publicBundles(index, options) {
  return index.bundles.map((bundle) => {
    const documentCount = index.documents.filter((doc) => doc.bundle === bundle.id).length;
    const conceptCount = index.concepts.filter((doc) => doc.bundle === bundle.id).length;
    const assetCount = (index.assets || []).filter((asset) => asset.bundle === bundle.id).length;
    if (bundle.remote) {
      return {
        id: bundle.id,
        remote: true,
        provider: bundle.remoteSource && bundle.remoteSource.provider,
        url: bundle.remoteSource && bundle.remoteSource.url,
        ref: bundle.remoteSource && bundle.remoteSource.ref,
        path: bundle.remoteSource && bundle.remoteSource.path,
        fileCount: bundle.remoteSource && bundle.remoteSource.fileCount,
        documentCount,
        conceptCount,
        assetCount,
        okfVersion: bundle.okfVersion || null,
        versionStatus: bundle.versionStatus,
        revision: bundle.remoteSource && (bundle.remoteSource.commitSha || bundle.remoteSource.ref),
        include: bundle.include || [],
        exclude: bundle.exclude || [],
      };
    }
    const absoluteRoot = path.resolve(bundle.root);
    const projectRoot = index.project && index.project.root
      ? path.resolve(index.project.root)
      : null;
    const root = projectRoot
      ? path.relative(projectRoot, absoluteRoot).replace(/\\/g, "/") || "."
      : "<configured>";
    return {
      id: bundle.id,
      root,
      ...((options && options.includeAbsolutePaths) ? { absoluteRoot, projectRoot } : {}),
      documentCount,
      conceptCount,
      assetCount,
      okfVersion: bundle.okfVersion || null,
      versionStatus: bundle.versionStatus,
      include: bundle.include || [],
      exclude: bundle.exclude || [],
    };
  });
}

function conceptLocator(args) {
  return args && (args.id || args.uri)
    ? (args.id || args.uri)
    : args && args.bundle && args.path
      ? `okf://${args.bundle}/${args.path}`
      : null;
}

function getConcept(index, args, repositoryMappings) {
  const locator = conceptLocator(args);
  const doc = resolveConcept(index, locator);
  if (!doc) {
    const recovery = recoverConceptLocator(index, locator, {
      bundle: args && args.bundle,
      limit: 5,
    });
    throw new ToolExecutionError(
      `Unknown OKF concept URI or ID: ${locator || "<missing>"}`,
      recovery.status === "ambiguous" ? "concept_locator_ambiguous" : "concept_not_found",
      { recovery },
    );
  }
  if (!doc.valid || doc.reserved) {
    throw new ToolExecutionError(`Locator is not a valid OKF concept: ${locator}`);
  }
  return Object.assign(conceptSummary(doc), {
    frontmatter: doc.frontmatter,
    body: doc.body,
    links: doc.links,
    signals: conceptSignals(doc, true),
    referencedAssets: (index.assets || []).filter((asset) => (
      (asset.referencedBy || []).some((reference) => reference.uri === doc.uri)
    )).map((asset) => ({
      uri: asset.uri,
      bundle: asset.bundle,
      path: asset.path,
      mimeType: asset.mimeType,
      size: asset.size,
      sha256: asset.sha256,
      roles: asset.roles,
    })),
    gitSources: describeConceptGitSources(index, doc, repositoryMappings),
  });
}

function conceptIndexIsStale(index, args) {
  const doc = resolveConcept(index, conceptLocator(args));
  if (!doc) return true;
  const bundle = (index.bundles || []).find((entry) => entry.id === doc.bundle);
  if (!bundle || bundle.remote) return false;
  try {
    return !fs.lstatSync(doc.absolutePath).isFile();
  } catch (_error) {
    return true;
  }
}

function listTypes(index) {
  const counts = {};
  index.concepts.forEach((doc) => {
    counts[doc.type] = (counts[doc.type] || 0) + 1;
  });
  return counts;
}

function listTags(index) {
  const counts = {};
  index.concepts.forEach((doc) => {
    doc.tags.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return counts;
}

function listRelationTypes(index) {
  const counts = {};
  index.edges.filter((edge) => edge.kind === "relation").forEach((edge) => {
    counts[edge.relationType] = (counts[edge.relationType] || 0) + 1;
  });
  return counts;
}

function listEdgeKinds(index) {
  const counts = {};
  index.edges.forEach((edge) => {
    if (!counts[edge.kind]) {
      counts[edge.kind] = { total: 0, resolved: 0, broken: 0 };
    }
    counts[edge.kind].total += 1;
    counts[edge.kind][edge.broken ? "broken" : "resolved"] += 1;
  });
  return counts;
}

const tools = {
  list_bundles: {
    ...defineTool(
      "List the local and remote OKF bundles currently loaded by the server.",
      READ_ONLY,
    ),
    handler: (state) => jsonContent(publicBundles(state.index, {
      includeAbsolutePaths: Boolean(state.allowWrite),
    })),
  },
  get_concept: {
    ...defineTool(
      "Read one valid OKF concept, including its frontmatter, Markdown body, and links.",
      READ_ONLY,
      {
        id: nonEmptyStringParameter("Portable extensionless Concept ID or bundle-relative Markdown path."),
        uri: nonEmptyStringParameter("Canonical or path based okf URI for the concept."),
        bundle: nonEmptyStringParameter("Bundle id used with path when uri is not supplied."),
        path: nonEmptyStringParameter("Bundle relative Markdown path used with bundle when uri is not supplied."),
      },
      [],
      {
        anyOf: [
          { required: ["id"] },
          { required: ["uri"] },
          { required: ["bundle", "path"] },
        ],
      },
    ),
    handler: (state, args) => {
      if (conceptIndexIsStale(state.index, args)) state.rebuildIndex();
      return jsonContent(getConcept(state.index, args, state.repositoryMappings));
    },
  },
  list_types: {
    ...defineTool(
      "Count the concept types present in the current OKF index.",
      READ_ONLY,
    ),
    handler: (state) => jsonContent(listTypes(state.index)),
  },
  list_tags: {
    ...defineTool(
      "Count the tags present on concepts in the current OKF index.",
      READ_ONLY,
    ),
    handler: (state) => jsonContent(listTags(state.index)),
  },
  list_relation_types: {
    ...defineTool(
      "Count the typed relations present in the current OKF graph.",
      READ_ONLY,
    ),
    handler: (state) => jsonContent(listRelationTypes(state.index)),
  },
  list_edge_kinds: {
    ...defineTool(
      "Count standard semantic and extension edge kinds in the current graph.",
      READ_ONLY,
    ),
    handler: (state) => jsonContent(listEdgeKinds(state.index)),
  },
  validate_bundle: {
    ...defineTool(
      "Report OKF conformance separately from project validity for one bundle or the full current index.",
      READ_ONLY,
      {
        bundle: nonEmptyStringParameter("Optional bundle id to validate in isolation."),
      },
    ),
    handler: (state, args) => {
      const index = state.index;
      if (args.bundle && !index.bundles.some((bundle) => bundle.id === args.bundle)) {
        throw new ToolExecutionError(`Unknown OKF bundle: ${args.bundle}`);
      }
      return jsonContent(validateIndex(index, args.bundle));
    },
  },
  validate_project: {
    ...defineTool(
      "Report OKF conformance, project validity, and structured diagnostics for the complete configured project.",
      READ_ONLY,
    ),
    handler: (state) => jsonContent(validateIndex(state.index)),
  },
};

module.exports = { tools };
