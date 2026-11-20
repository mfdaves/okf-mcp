"use strict";

// Views (plan I-2d): what a principal reads of a project whose bundles name
// audiences. A view is the set of bundles a principal may read, served from a
// server state of its own that was built from those bundles alone: its index,
// its store and its authoring services hold nothing else, so no tool,
// resource or diagnostic can return what the view does not contain
// (isolation by construction, plan B-4, per view). This module decides which
// view a principal gets and keeps the states; the server builds them
// (createViewState in src/mcp/server.js).
//
// A project without audiences has one view, the server's own state, and a
// principal that reads every bundle gets that state as well.

const { mayRead } = require("../audiences");

const DEFAULT_MAX_VIEWS = 8;

// Whether any bundle of the project names audiences.
function usesAudiences(project) {
  return [...(project?.bundles || []), ...(project?.remoteBundles || [])].some(
    (bundle) => bundle.audiences?.length,
  );
}

// The ids of the local bundles and remote snapshots `principal` may read. A
// snapshot follows the audiences of its entry in the project file; one that
// is not in the project file is open.
function readableBundleIds(state, principal) {
  const declared = new Map(
    (state.project.remoteBundles || []).map((bundle) => [bundle.id, bundle.audiences]),
  );
  const ids = new Set();
  for (const bundle of state.project.bundles) {
    if (mayRead(principal, bundle.audiences)) ids.add(bundle.id);
  }
  for (const bundle of state.remoteBundles || []) {
    if (mayRead(principal, declared.get(bundle.id))) ids.add(bundle.id);
  }
  return ids;
}

// The project as a view sees it: the bundles of `ids`, the producers and
// plugins that write them, and no copy of the configuration file.
function viewProject(project, ids) {
  return Object.assign({}, project, {
    bundles: project.bundles.filter((bundle) => ids.has(bundle.id)),
    remoteBundles: (project.remoteBundles || []).filter((bundle) => ids.has(bundle.id)),
    producers: (project.producers || []).filter((producer) => ids.has(producer.bundle)),
    plugins: (project.plugins || []).filter(
      (plugin) => !plugin || typeof plugin !== "object" || !plugin.bundle || ids.has(plugin.bundle),
    ),
    raw: null,
  });
}

// The process's one embedding runtime as a view uses it. The runtime stays
// synced on the whole project: a sync prunes every vector its index does not
// use, so a view's search reads the cache as it is and never starts one, and
// the vectors of a batch written through a view are embedded against the
// whole-project index. Answers carry no count of the cache, which covers
// bundles the view does not contain.
function viewEmbeddings(base) {
  const runtime = base.embeddings;
  return {
    async search(index, options) {
      const response = await runtime.search(index, options, { sync: false });
      delete response.cache;
      return response;
    },
    async embedChanged() {
      const previous = base.index;
      base.refreshIndex();
      const receipt = await runtime.embedChanged(previous, base.index);
      return { embedder: receipt.embedder, durationMs: receipt.durationMs };
    },
    status() {
      const status = runtime.status();
      return {
        configured: status.configured,
        available: status.available,
        alpha: status.alpha,
        normalization: status.normalization,
        embedUnits: status.embedUnits,
        minSimilarity: status.minSimilarity,
        embedder: status.embedder,
      };
    },
    idle: () => runtime.idle(),
  };
}

// The state `principal` is served from: `base` itself when the project names
// no audiences or the principal reads every bundle, else the state of its
// view, built by `build(base, ids)` on first use. At most `base.maxViews`
// views are kept; the least recently used one is dropped.
function viewStateFor(base, principal, build) {
  if (!base.project || !usesAudiences(base.project)) return base;
  const ids = readableBundleIds(base, principal);
  if (ids.size === base.project.bundles.length + (base.remoteBundles || []).length) return base;
  const key = [...ids].sort().join("\n");
  base.views ||= new Map();
  let view = base.views.get(key);
  if (view) {
    base.views.delete(key);
  } else {
    view = build(base, ids);
  }
  base.views.set(key, view);
  const limit = base.maxViews || DEFAULT_MAX_VIEWS;
  while (base.views.size > limit) {
    base.views.delete(base.views.keys().next().value);
  }
  return view;
}

module.exports = {
  DEFAULT_MAX_VIEWS,
  readableBundleIds,
  usesAudiences,
  viewEmbeddings,
  viewProject,
  viewStateFor,
};
