"use strict";

// The indexer's public surface. build.js loads bundles and builds a complete
// index, edges.js derives one document's outbound graph, resolve.js turns
// locators into concepts, and update.js keeps derived views and applies
// changes to an existing index. Internal helpers stay on their modules; only
// the names listed here are part of the package API.
const build = require("./build");
const edges = require("./edges");
const resolve = require("./resolve");
const update = require("./update");

module.exports = {
  buildIndex: build.buildIndex,
  buildProjectIndex: build.buildProjectIndex,
  buildProjectIndexAsync: build.buildProjectIndexAsync,
  attachProject: build.attachProject,
  conceptSummary: resolve.conceptSummary,
  conceptSignals: resolve.conceptSignals,
  conceptIsGeneratedFile: resolve.conceptIsGeneratedFile,
  conceptMatchSummary: resolve.conceptMatchSummary,
  bundleAllowsPath: build.bundleAllowsPath,
  bundleExcludesPath: build.bundleExcludesPath,
  edgesBySource: update.edgesBySource,
  findConceptMatches: resolve.findConceptMatches,
  linkSets: update.linkSets,
  loadProjectBundles: build.loadProjectBundles,
  normalizeConceptTitle: resolve.normalizeConceptTitle,
  parseBundleArg: build.parseBundleArg,
  recoverConceptLocator: resolve.recoverConceptLocator,
  resolveLinkPath: edges.resolveLinkPath,
  resolveConcept: resolve.resolveConcept,
  semanticReferences: edges.semanticReferences,
  sanitizeBundleId: build.sanitizeBundleId,
  validateIndex: build.validateIndex,
};
