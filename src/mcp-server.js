"use strict";

const path = require("path");
const readline = require("readline");
const { attachProject, buildIndex, buildProjectIndex, conceptSummary, loadProjectBundles } = require("./indexer");
const { searchConcepts } = require("./search");
const { exportGraph, findPaths, getGraph, getNeighbors, getSubgraph, graphSummary } = require("./graph");
const { fetchGitHubBundle, fetchRemoteBundles } = require("./remote");

const TOOL_NAMES = [
  "list_bundles",
  "list_concepts",
  "get_concept",
  "search_concepts",
  "list_types",
  "list_tags",
  "list_relation_types",
  "load_remote_bundle",
  "list_remote_bundles",
  "get_graph",
  "get_neighbors",
  "get_subgraph",
  "find_paths",
  "graph_summary",
  "validate_bundle",
  "validate_project",
  "export_graph",
];

function jsonContent(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function listTools() {
  const schemas = {
    get_concept: { required: ["uri"], properties: { uri: { type: "string" }, bundle: { type: "string" }, path: { type: "string" } } },
    search_concepts: { properties: { query: { type: "string" }, bundle: { type: "string" }, types: { type: "array", items: { type: "string" } }, tagsAny: { type: "array", items: { type: "string" } }, tagsAll: { type: "array", items: { type: "string" } }, pathPrefix: { type: "string" }, relationType: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } } },
    list_concepts: { properties: { query: { type: "string" }, bundle: { type: "string" }, type: { type: "string" }, tag: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } } },
    get_graph: { properties: { bundle: { type: "string" }, type: { type: "string" }, tag: { type: "string" }, pathPrefix: { type: "string" }, includeExternal: { type: "boolean" }, maxNodes: { type: "number" }, maxEdges: { type: "number" } } },
    get_neighbors: { required: ["uri"], properties: { uri: { type: "string" } } },
    get_subgraph: { properties: { uri: { type: "string" }, seeds: { type: "array", items: { type: "string" } }, depth: { type: "number" }, maxNodes: { type: "number" } } },
    find_paths: { required: ["source", "target"], properties: { source: { type: "string" }, target: { type: "string" }, maxPaths: { type: "number" } } },
    validate_bundle: { properties: { bundle: { type: "string" } } },
    load_remote_bundle: { required: ["id", "url"], properties: { id: { type: "string" }, url: { type: "string" }, provider: { type: "string" }, include: { type: "array", items: { type: "string" } }, exclude: { type: "array", items: { type: "string" } } } },
    export_graph: { properties: { format: { type: "string" }, includeExternal: { type: "boolean" }, maxNodes: { type: "number" }, maxEdges: { type: "number" } } },
  };
  return {
    tools: TOOL_NAMES.map((name) => ({
      name,
      description: `OKF ${name.replace(/_/g, " ")} tool.`,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
        ...(schemas[name] || {}),
      },
    })),
  };
}

function listResources(index) {
  return {
    resources: index.documents.map((doc) => ({
      uri: doc.uri,
      name: doc.title,
      description: doc.description || `${doc.kind} ${doc.path}`,
      mimeType: "text/markdown",
    })),
  };
}

function publicBundles(index) {
  return index.bundles.map((bundle) => {
    if (bundle.remote) {
      return {
        id: bundle.id,
        remote: true,
        provider: bundle.remoteSource && bundle.remoteSource.provider,
        url: bundle.remoteSource && bundle.remoteSource.url,
        ref: bundle.remoteSource && bundle.remoteSource.ref,
        path: bundle.remoteSource && bundle.remoteSource.path,
        fileCount: bundle.remoteSource && bundle.remoteSource.fileCount,
        include: bundle.include || [],
        exclude: bundle.exclude || [],
      };
    }
    const root = index.project && index.project.root
      ? path.relative(index.project.root, bundle.root).replace(/\\/g, "/") || "."
      : "<configured>";
    return {
      id: bundle.id,
      root,
      include: bundle.include || [],
      exclude: bundle.exclude || [],
    };
  });
}

function readResource(index, uri) {
  const doc = index.byUri.get(uri);
  if (!doc) {
    throw new Error(`Unknown OKF resource URI: ${uri}`);
  }
  return {
    contents: [
      {
        uri: doc.uri,
        mimeType: "text/markdown",
        text: doc.text,
      },
    ],
  };
}

function listConcepts(index, args) {
  const options = Object.assign({}, args || {});
  if (options.type && !options.types) {
    options.types = [options.type];
  }
  if (options.tag && !options.tagsAny) {
    options.tagsAny = [options.tag];
  }
  return searchConcepts(index, Object.assign(options, { query: "" }));
}

function getConcept(index, args) {
  const uri = args && args.uri ? args.uri : args && args.bundle && args.path ? `okf://${args.bundle}/${args.path}` : null;
  if (!uri || !index.byUri.has(uri)) {
    throw new Error(`Unknown OKF concept URI: ${uri || "<missing>"}`);
  }
  const doc = index.byUri.get(uri);
  if (!doc.valid || doc.reserved) {
    throw new Error(`URI is not a valid OKF concept: ${uri}`);
  }
  return Object.assign(conceptSummary(doc), {
    frontmatter: doc.frontmatter,
    body: doc.body,
    links: doc.links,
  });
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

function validateBundle(index, args) {
  const bundle = args && args.bundle;
  const errors = bundle ? index.errors.filter((entry) => entry.bundle === bundle) : index.errors;
  const warnings = bundle ? index.warnings.filter((entry) => entry.bundle === bundle) : index.warnings;
  return {
    valid: errors.length === 0 && warnings.filter((warning) => warning.code === "missing_type" || warning.code === "missing_frontmatter").length === 0,
    errors,
    warnings,
  };
}

async function callTool(state, name, args) {
  if (!state || !state.index) {
    state = {
      index: state,
      localBundleArgs: [],
      remoteBundles: [],
      relationTypes: state && state.relationTypes,
    };
  }
  const index = state.index;
  switch (name) {
    case "list_bundles":
      return jsonContent(publicBundles(index));
    case "list_concepts":
      return jsonContent(listConcepts(index, args));
    case "get_concept":
      return jsonContent(getConcept(index, args));
    case "search_concepts":
      return jsonContent(searchConcepts(index, args || {}));
    case "list_types":
      return jsonContent(listTypes(index));
    case "list_tags":
      return jsonContent(listTags(index));
    case "list_relation_types":
      return jsonContent(listRelationTypes(index));
    case "list_remote_bundles":
      return jsonContent(state.remoteBundles.map((bundle) => bundle.remoteSource));
    case "load_remote_bundle": {
      if (!args || !args.id || !args.url) {
        throw new Error("load_remote_bundle requires id and url.");
      }
      const provider = String(args.provider || "github");
      if (provider !== "github") {
        throw new Error(`Unsupported remote bundle provider: ${provider}`);
      }
      if (state.localBundleArgs.concat(state.remoteBundles).some((bundle) => bundle.id === args.id)) {
        throw new Error(`Bundle id already loaded: ${args.id}`);
      }
      const remoteBundle = await fetchGitHubBundle({
        id: args.id,
        url: args.url,
        include: Array.isArray(args.include) ? args.include : [],
        exclude: Array.isArray(args.exclude) ? args.exclude : [],
      });
      state.remoteBundles.push(remoteBundle);
      state.index = buildIndex(state.localBundleArgs.concat(state.remoteBundles), { relationTypes: state.relationTypes });
      return jsonContent(remoteBundle.remoteSource);
    }
    case "get_graph":
      return jsonContent(getGraph(index, args || {}));
    case "get_neighbors":
      if (!args || !args.uri) {
        throw new Error("get_neighbors requires uri.");
      }
      return jsonContent(getNeighbors(index, args && args.uri));
    case "get_subgraph":
      return jsonContent(getSubgraph(index, args || {}));
    case "find_paths":
      if (!args || !args.source || !args.target) {
        throw new Error("find_paths requires source and target.");
      }
      return jsonContent(findPaths(index, args && args.source, args && args.target, args && args.maxPaths));
    case "graph_summary":
      return jsonContent(graphSummary(index));
    case "validate_bundle":
      return jsonContent(validateBundle(index, args || {}));
    case "validate_project":
      return jsonContent(validateBundle(index, args || {}));
    case "export_graph":
      return {
        content: [
          {
            type: "text",
            text: exportGraph(index, args || {}),
          },
        ],
      };
    default:
      throw new Error(`Unknown OKF MCP tool: ${name}`);
  }
}

function createServer(bundleArgs, options) {
  const localBundleArgs = (bundleArgs || []).slice();
  const state = {
    index: options && options.initialIndex ? options.initialIndex : (options && options.projectPath ? buildProjectIndex(options.projectPath) : buildIndex(localBundleArgs)),
    localBundleArgs,
    remoteBundles: (options && options.initialRemoteBundles) || [],
    relationTypes: options && options.relationTypes,
  };
  async function handle(request) {
    const method = request.method;
    const params = request.params || {};
    if (method === "initialize") {
      return {
        protocolVersion: params.protocolVersion || "2025-06-18",
        serverInfo: { name: "okf-mcp", version: "0.1.0" },
        capabilities: { resources: {}, tools: {} },
      };
    }
    if (method === "notifications/initialized") {
      return null;
    }
    if (method === "resources/list") {
      return listResources(state.index);
    }
    if (method === "resources/read") {
      return readResource(state.index, params.uri);
    }
    if (method === "tools/list") {
      return listTools();
    }
    if (method === "tools/call") {
      return callTool(state, params.name, params.arguments || {});
    }
    throw new Error(`Unsupported MCP method: ${method}`);
  }
  return { get index() { return state.index; }, handle };
}

async function createServerAsync(bundleArgs, options) {
  if (options && options.projectPath) {
    const loaded = await loadProjectBundles(options.projectPath);
    const extraRemoteBundles = await fetchRemoteBundles(options.remoteBundles || []);
    const initialRemoteBundles = loaded.remoteBundles.concat(extraRemoteBundles);
    const localBundleArgs = (loaded.bundles || []).filter((bundle) => !bundle.remote);
    const initialIndex = attachProject(
      buildIndex(localBundleArgs.concat(initialRemoteBundles), { relationTypes: loaded.project.relationTypes }),
      loaded.project,
    );
    return createServer(localBundleArgs, {
      initialIndex,
      initialRemoteBundles,
      relationTypes: loaded.project.relationTypes,
    });
  }
  const remoteBundles = await fetchRemoteBundles((options && options.remoteBundles) || []);
  const localBundleArgs = (bundleArgs || []).slice();
  return createServer(localBundleArgs, {
    initialIndex: buildIndex(localBundleArgs.concat(remoteBundles)),
    initialRemoteBundles: remoteBundles,
  });
}

function responseFor(id, result, error) {
  if (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: error.message || String(error),
      },
    };
  }
  return { jsonrpc: "2.0", id, result };
}

async function runStdioServer(bundleArgs, input, output, options) {
  const server = await createServerAsync(bundleArgs, options);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    if (!line.trim()) {
      return;
    }
    if (line.length > 1024 * 1024) {
      output.write(JSON.stringify(responseFor(null, null, new Error("MCP request line exceeds 1 MiB."))) + "\n");
      return;
    }
    let request;
    try {
      request = JSON.parse(line);
      const result = await server.handle(request);
      if (request.id !== undefined) {
        output.write(JSON.stringify(responseFor(request.id, result, null)) + "\n");
      }
    } catch (error) {
      const id = request && request.id !== undefined ? request.id : null;
      output.write(JSON.stringify(responseFor(id, null, error)) + "\n");
    }
  });
  return server;
}

module.exports = {
  TOOL_NAMES,
  callTool,
  createServer,
  createServerAsync,
  listResources,
  listTools,
  readResource,
  runStdioServer,
};
