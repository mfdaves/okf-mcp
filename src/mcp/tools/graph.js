"use strict";

const { resolveConcept } = require("../../indexer");
const { exportGraph, findPaths, getGraph, getNeighbors, getSubgraph, graphSummary } = require("../../graph");
const {
  READ_ONLY,
  ToolExecutionError,
  booleanParameter,
  defineTool,
  integerParameter,
  jsonContent,
  nonEmptyStringParameter,
  stringArrayParameter,
  stringParameter,
} = require("../registry");

function requireGraphConcept(index, uri) {
  const doc = resolveConcept(index, uri);
  if (!doc || !doc.valid || doc.reserved) {
    throw new ToolExecutionError(`Unknown valid OKF concept: ${uri || "<missing>"}`);
  }
  return doc;
}

const tools = {
  get_graph: {
    ...defineTool(
      "Return a bounded set of OKF graph nodes and edges with optional concept filters.",
      READ_ONLY,
      {
        bundle: nonEmptyStringParameter("Limit graph nodes to this bundle id."),
        type: nonEmptyStringParameter("Limit graph nodes to this exact concept type."),
        tag: nonEmptyStringParameter("Limit graph nodes to concepts containing this tag."),
        pathPrefix: stringParameter("Limit graph nodes to bundle relative paths beginning with this prefix."),
        includeExternal: booleanParameter("Include opaque external relation targets in the graph."),
        includeAssets: booleanParameter("Include explicitly referenced bundle assets as graph nodes."),
        edgeKinds: stringArrayParameter("Limit returned edges to these edge kinds.", { nonEmptyItems: true }),
        maxNodes: integerParameter("Maximum number of graph nodes to return.", 1, 1000, 100),
        maxEdges: integerParameter("Maximum number of graph edges to return.", 1, 5000, 300),
      },
    ),
    handler: (state, args) => jsonContent(getGraph(state.index, args)),
  },
  get_neighbors: {
    ...defineTool(
      "Return the incoming and outgoing graph relationships for one OKF concept.",
      READ_ONLY,
      {
        uri: nonEmptyStringParameter("Canonical or path based okf URI of the center concept."),
        includeExternal: booleanParameter("Include opaque external neighbors without fetching them."),
        includeAssets: booleanParameter("Include referenced asset neighbors."),
        edgeKinds: stringArrayParameter("Limit neighbors to these edge kinds.", { nonEmptyItems: true }),
      },
      ["uri"],
    ),
    handler: (state, args) => {
      requireGraphConcept(state.index, args.uri);
      return jsonContent(getNeighbors(state.index, args.uri, args));
    },
  },
  get_subgraph: {
    ...defineTool(
      "Traverse a bounded OKF subgraph outward from one or more seed concepts.",
      READ_ONLY,
      {
        uri: nonEmptyStringParameter("Single canonical or path based okf URI to use as a seed."),
        seeds: stringArrayParameter("One or more okf URIs to use as traversal seeds.", { minItems: 1, nonEmptyItems: true }),
        depth: integerParameter("Maximum relationship depth to traverse from the seeds.", 0, 10, 1),
        maxNodes: integerParameter("Maximum number of graph nodes to return.", 1, 1000, 50),
        edgeKinds: stringArrayParameter("Limit traversal to these edge kinds.", { nonEmptyItems: true }),
      },
      [],
      {
        anyOf: [
          { required: ["uri"] },
          { required: ["seeds"] },
        ],
      },
    ),
    handler: (state, args) => {
      const seeds = args.seeds || [args.uri];
      seeds.forEach((uri) => requireGraphConcept(state.index, uri));
      return jsonContent(getSubgraph(state.index, args));
    },
  },
  find_paths: {
    ...defineTool(
      "Find bounded relationship paths between two OKF concepts.",
      READ_ONLY,
      {
        source: nonEmptyStringParameter("Canonical or path based okf URI where path search begins."),
        target: nonEmptyStringParameter("Canonical or path based okf URI where path search ends."),
        maxPaths: integerParameter("Maximum number of distinct paths to return.", 1, 50, 3),
        edgeKinds: stringArrayParameter("Limit path traversal to these edge kinds.", { nonEmptyItems: true }),
      },
      ["source", "target"],
    ),
    handler: (state, args) => {
      requireGraphConcept(state.index, args.source);
      requireGraphConcept(state.index, args.target);
      return jsonContent(findPaths(state.index, args.source, args.target, args.maxPaths, args));
    },
  },
  graph_summary: {
    ...defineTool(
      "Summarize bundle, concept, edge, type, tag, and graph health counts.",
      READ_ONLY,
    ),
    handler: (state) => jsonContent(graphSummary(state.index)),
  },
  export_graph: {
    ...defineTool(
      "Render the current OKF graph as JSON, Graphviz DOT, or Mermaid text.",
      READ_ONLY,
      {
        format: stringParameter("Output format for the graph.", { enum: ["json", "dot", "mermaid"], default: "json" }),
        includeExternal: booleanParameter("Include opaque external relation targets in the export."),
        includeAssets: booleanParameter("Include explicitly referenced bundle assets in the export."),
        edgeKinds: stringArrayParameter("Limit exported edges to these edge kinds.", { nonEmptyItems: true }),
        maxNodes: integerParameter("Maximum number of graph nodes to export.", 1, 1000, 100),
        maxEdges: integerParameter("Maximum number of graph edges to export.", 1, 5000, 300),
      },
    ),
    handler: (state, args) => ({
      content: [
        {
          type: "text",
          text: exportGraph(state.index, args),
        },
      ],
    }),
  },
};

module.exports = { tools };
