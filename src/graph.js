"use strict";

const { applyFilters } = require("./search");
const { conceptSummary } = require("./indexer");

function nodeFor(doc) {
  return {
    id: doc.uri,
    bundle: doc.bundle,
    path: doc.path,
    pathUri: doc.pathUri,
    type: doc.type,
    title: doc.title,
    tags: doc.tags,
    aliases: doc.aliases,
    description: doc.description,
  };
}

function externalNodeFor(uri) {
  return {
    id: uri,
    bundle: null,
    path: uri,
    pathUri: uri,
    type: "External Reference",
    title: uri,
    tags: ["external"],
    aliases: [],
    description: "",
    external: true,
  };
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function docsByFilter(index, options) {
  const includeReserved = Boolean(options && options.includeReserved);
  const docs = includeReserved ? index.documents : index.concepts;
  if (!options || (!options.bundle && !options.type && !options.types && !options.tag && !options.tagsAny && !options.tagsAll && !options.pathPrefix)) {
    return docs;
  }
  const conceptUris = new Set(applyFilters(index, options).map((doc) => doc.uri));
  return docs.filter((doc) => conceptUris.has(doc.uri) || (includeReserved && doc.reserved));
}

function trimGraph(nodes, edges, options) {
  const maxNodes = boundedInteger(options && options.maxNodes, 100, 1, 1000);
  const maxEdges = boundedInteger(options && options.maxEdges, 300, 1, 5000);
  const warnings = [];
  let trimmedNodes = nodes;
  let trimmedEdges = edges;
  if (nodes.length > maxNodes) {
    const allowed = new Set(nodes.slice(0, maxNodes).map((node) => node.id));
    trimmedNodes = nodes.slice(0, maxNodes);
    trimmedEdges = edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
    warnings.push(`Graph truncated to ${maxNodes} nodes; use narrower filters for full results.`);
  }
  if (trimmedEdges.length > maxEdges) {
    trimmedEdges = trimmedEdges.slice(0, maxEdges);
    warnings.push(`Graph truncated to ${maxEdges} edges; use narrower filters for full results.`);
  }
  return {
    nodes: trimmedNodes,
    edges: trimmedEdges,
    warnings,
  };
}

function canonicalUri(index, uri) {
  const doc = uri ? index.byUri.get(uri) : null;
  return doc ? doc.uri : uri;
}

function getGraph(index, options) {
  const docs = docsByFilter(index, options || {});
  const uris = new Set(docs.map((doc) => doc.uri));
  const nodes = docs.map(nodeFor).sort((a, b) => a.id.localeCompare(b.id));
  const includeExternal = Boolean(options && options.includeExternal);
  const externalUris = new Set();
  const edges = index.edges.filter((edge) => {
    if (edge.broken || !uris.has(edge.source)) {
      return false;
    }
    if (uris.has(edge.target)) {
      return true;
    }
    if (includeExternal && edge.external) {
      externalUris.add(edge.target);
      return true;
    }
    return false;
  });
  externalUris.forEach((uri) => nodes.push(externalNodeFor(uri)));
  return trimGraph(nodes, edges, options || {});
}

function getNeighbors(index, uri) {
  const canonical = canonicalUri(index, uri);
  const inbound = [];
  const outbound = [];
  index.edges.forEach((edge) => {
    if (edge.source === canonical && index.byUri.has(edge.target)) {
      outbound.push({ edge, node: nodeFor(index.byUri.get(edge.target)) });
    } else if (edge.source === canonical && edge.external) {
      outbound.push({ edge, node: externalNodeFor(edge.target) });
    }
    if (edge.target === canonical && index.byUri.has(edge.source)) {
      inbound.push({ edge, node: nodeFor(index.byUri.get(edge.source)) });
    }
  });
  return { uri: canonical, inbound, outbound };
}

function getSubgraph(index, options) {
  const requestedSeeds = Array.isArray(options && options.seeds) ? options.seeds : [options && options.uri].filter(Boolean);
  const seeds = Array.from(new Set(requestedSeeds.map((uri) => canonicalUri(index, uri))));
  const depth = boundedInteger(options && options.depth, 1, 0, 10);
  const maxNodes = boundedInteger(options && options.maxNodes, 50, 1, 1000);
  const allowedUris = new Set((options && options.includeReserved ? index.documents : index.concepts).map((doc) => doc.uri));
  const seen = new Set();
  let frontier = seeds.filter((uri) => allowedUris.has(uri));
  frontier.forEach((uri) => seen.add(uri));
  for (let level = 0; level < depth && frontier.length && seen.size < maxNodes; level += 1) {
    const next = [];
    index.edges.filter((edge) => !edge.broken).forEach((edge) => {
      if (frontier.includes(edge.source) && allowedUris.has(edge.target) && !seen.has(edge.target)) {
        seen.add(edge.target);
        next.push(edge.target);
      }
      if (frontier.includes(edge.target) && allowedUris.has(edge.source) && !seen.has(edge.source)) {
        seen.add(edge.source);
        next.push(edge.source);
      }
    });
    frontier = next.slice(0, Math.max(0, maxNodes - seen.size));
  }
  const nodes = Array.from(seen).map((uri) => index.byUri.get(uri)).filter(Boolean).map(nodeFor);
  const uris = new Set(nodes.map((node) => node.id));
  const edges = index.edges.filter((edge) => !edge.broken && uris.has(edge.source) && uris.has(edge.target));
  return trimGraph(nodes, edges, Object.assign({}, options, { maxNodes }));
}

function findPaths(index, source, target, maxPaths) {
  const canonicalSource = canonicalUri(index, source);
  const canonicalTarget = canonicalUri(index, target);
  const limit = boundedInteger(maxPaths, 3, 1, 50);
  const adjacency = new Map();
  index.edges.filter((edge) => !edge.broken).forEach((edge) => {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    adjacency.get(edge.source).push(edge.target);
  });
  const queue = [[canonicalSource]];
  const paths = [];
  const bestDepth = new Map([[canonicalSource, 0]]);
  while (queue.length && paths.length < limit) {
    const path = queue.shift();
    const last = path[path.length - 1];
    if (last === canonicalTarget) {
      paths.push(path);
      continue;
    }
    for (const next of adjacency.get(last) || []) {
      if (path.includes(next)) {
        continue;
      }
      const nextDepth = path.length;
      if (bestDepth.has(next) && bestDepth.get(next) < nextDepth) {
        continue;
      }
      bestDepth.set(next, nextDepth);
      queue.push(path.concat(next));
    }
  }
  return { source: canonicalSource, target: canonicalTarget, paths };
}

function graphSummary(index) {
  const byType = {};
  const byTag = {};
  const byBundle = {};
  const byRelationType = {};
  index.concepts.forEach((doc) => {
    byType[doc.type] = (byType[doc.type] || 0) + 1;
    byBundle[doc.bundle] = (byBundle[doc.bundle] || 0) + 1;
    doc.tags.forEach((tag) => {
      byTag[tag] = (byTag[tag] || 0) + 1;
    });
  });
  const inbound = new Map();
  const outbound = new Map();
  index.edges.filter((edge) => !edge.broken).forEach((edge) => {
    outbound.set(edge.source, (outbound.get(edge.source) || 0) + 1);
    inbound.set(edge.target, (inbound.get(edge.target) || 0) + 1);
    if (edge.kind === "relation") {
      byRelationType[edge.relationType] = (byRelationType[edge.relationType] || 0) + 1;
    }
  });
  const orphanConcepts = index.concepts
    .filter((doc) => !inbound.get(doc.uri) && !outbound.get(doc.uri))
    .map((doc) => doc.uri);
  const topLinkedConcepts = index.concepts
    .map((doc) => ({ uri: doc.uri, links: (inbound.get(doc.uri) || 0) + (outbound.get(doc.uri) || 0) }))
    .filter((entry) => entry.links > 0)
    .sort((a, b) => b.links - a.links || a.uri.localeCompare(b.uri))
    .slice(0, 10);
  return {
    bundles: index.bundles.length,
    documents: index.documents.length,
    concepts: index.concepts.length,
    reserved: index.reserved.length,
    edges: index.edges.length,
    brokenLinks: index.edges.filter((edge) => edge.kind === "markdown_link" && edge.broken).length,
    brokenRelations: index.edges.filter((edge) => edge.kind === "relation" && edge.broken).length,
    relations: index.edges.filter((edge) => edge.kind === "relation").length,
    externalReferences: index.externalReferences ? index.externalReferences.length : 0,
    byBundle,
    byType,
    byTag,
    byRelationType,
    orphanConcepts,
    topLinkedConcepts,
    warnings: index.warnings,
    errors: index.errors,
  };
}

function exportGraph(index, options) {
  const graph = getGraph(index, options || {});
  const format = String((options && options.format) || "json").toLowerCase();
  if (format === "json") {
    return JSON.stringify(graph, null, 2);
  }
  if (format === "dot") {
    const dot = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
    const lines = ["digraph OKF {"];
    graph.nodes.forEach((node) => {
      lines.push(`  "${dot(node.id)}" [label="${dot(node.title)}"];`);
    });
    graph.edges.forEach((edge) => {
      lines.push(`  "${dot(edge.source)}" -> "${dot(edge.target)}" [label="${dot(edge.text || edge.relationType || edge.kind)}"];`);
    });
    lines.push("}");
    return lines.join("\n");
  }
  if (format === "mermaid") {
    const mermaidLabel = (value) => String(value || "").replace(/"/g, "#quot;").replace(/\]/g, "#93;").replace(/\r?\n/g, " ");
    const ids = new Map();
    graph.nodes.forEach((node, index) => ids.set(node.id, `N${index + 1}`));
    const lines = ["graph TD"];
    graph.nodes.forEach((node) => {
      lines.push(`  ${ids.get(node.id)}["${mermaidLabel(node.title)}"]`);
    });
    graph.edges.forEach((edge) => {
      lines.push(`  ${ids.get(edge.source)} --> ${ids.get(edge.target)}`);
    });
    return lines.join("\n");
  }
  throw new Error(`Unsupported graph export format: ${format}`);
}

module.exports = {
  exportGraph,
  findPaths,
  getGraph,
  getNeighbors,
  getSubgraph,
  graphSummary,
  nodeFor,
};
