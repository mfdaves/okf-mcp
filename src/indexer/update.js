"use strict";

// Derived views over an index, memoised per index object. An index is never
// mutated after it is built, so a WeakMap keyed by the index object is a sound
// cache: a rebuilt index is a new object with a fresh entry, and the entry of
// an index that is garbage-collected goes with it.
const LINK_SETS = new WeakMap();
const EDGES_BY_SOURCE = new WeakMap();

// Outbound and inbound neighbour sets over the index's non-broken edges, keyed
// by concept URI. Filters that ask "linked to" or "linked from" read these.
function linkSets(index) {
  let sets = LINK_SETS.get(index);
  if (sets) {
    return sets;
  }
  const outbound = new Map();
  const inbound = new Map();
  (index.edges || []).forEach((edge) => {
    if (edge.broken) {
      return;
    }
    if (!outbound.has(edge.source)) {
      outbound.set(edge.source, new Set());
    }
    if (!inbound.has(edge.target)) {
      inbound.set(edge.target, new Set());
    }
    outbound.get(edge.source).add(edge.target);
    inbound.get(edge.target).add(edge.source);
  });
  sets = { outbound, inbound };
  LINK_SETS.set(index, sets);
  return sets;
}

// Every edge of the index grouped by its source URI, in index edge order.
function edgesBySource(index) {
  let grouped = EDGES_BY_SOURCE.get(index);
  if (grouped) {
    return grouped;
  }
  grouped = new Map();
  (index.edges || []).forEach((edge) => {
    const list = grouped.get(edge.source);
    if (list) {
      list.push(edge);
    } else {
      grouped.set(edge.source, [edge]);
    }
  });
  EDGES_BY_SOURCE.set(index, grouped);
  return grouped;
}

module.exports = {
  edgesBySource,
  linkSets,
};
