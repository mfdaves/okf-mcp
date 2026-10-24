"use strict";

// The indexer's public surface. build.js loads bundles and builds a complete
// index, edges.js derives one document's outbound graph, resolve.js turns
// locators into concepts, assemble.js registers documents and assembles the
// index object for both paths, update.js applies changes to an existing
// index and keeps derived views, and cache.js keeps one index current for a
// host that writes. Internal helpers stay on their modules; only the names
// listed here are part of the package API.
const build = require("./build");
const cache = require("./cache");
const edges = require("./edges");
const resolve = require("./resolve");
const update = require("./update");

module.exports = {
  IndexCache: cache.IndexCache,
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
  indexUpdateStats: update.indexUpdateStats,
  linkSets: update.linkSets,
  loadProjectBundles: build.loadProjectBundles,
  normalizeConceptTitle: resolve.normalizeConceptTitle,
  parseBundleArg: build.parseBundleArg,
  recoverConceptLocator: resolve.recoverConceptLocator,
  refreshIndex: update.refreshIndex,
  resolveLinkPath: edges.resolveLinkPath,
  resolveConcept: resolve.resolveConcept,
  semanticReferences: edges.semanticReferences,
  sanitizeBundleId: build.sanitizeBundleId,
  updateIndex: update.updateIndex,
  validateIndex: build.validateIndex,
};
