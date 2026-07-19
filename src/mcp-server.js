"use strict";

const path = require("path");
const readline = require("readline");
const {
  attachProject,
  buildIndex,
  conceptSummary,
  loadProjectBundles,
  validateIndex,
} = require("./indexer");
const { searchConcepts } = require("./search");
const { exportGraph, findPaths, getGraph, getNeighbors, getSubgraph, graphSummary } = require("./graph");
const { fetchGitHubBundle, fetchRemoteBundles } = require("./remote");
const { ConceptAuthoringService } = require("./authoring");
const { FileConceptStore } = require("./store");
const { loadProjectConfig } = require("./project");
const packageMetadata = require("../package.json");

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const LOCAL_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const DESTRUCTIVE_WRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
const REMOTE_LOAD = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

function stringParameter(description, extra) {
  return Object.assign({ type: "string", description }, extra || {});
}

function numberParameter(description, extra) {
  return Object.assign({ type: "number", description }, extra || {});
}

function booleanParameter(description) {
  return { type: "boolean", description };
}

function stringArrayParameter(description) {
  return {
    type: "array",
    description,
    items: { type: "string" },
  };
}

function objectParameter(description) {
  return {
    type: "object",
    description,
    additionalProperties: true,
  };
}

function defineTool(description, annotations, properties, required, schemaExtras) {
  return {
    description,
    annotations,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: properties || {},
      ...(required && required.length ? { required } : {}),
      ...(schemaExtras || {}),
    },
  };
}

const TOOL_DEFINITIONS = {
  list_bundles: defineTool(
    "List the local and remote OKF bundles currently loaded by the server.",
    READ_ONLY,
  ),
  list_concepts: defineTool(
    "List compact OKF concept summaries with optional bundle, type, tag, and text filters.",
    READ_ONLY,
    {
      query: stringParameter("Optional text matched against concept metadata and content."),
      bundle: stringParameter("Limit results to this bundle id."),
      type: stringParameter("Limit results to this exact concept type."),
      tag: stringParameter("Limit results to concepts containing this tag."),
      limit: numberParameter("Maximum number of concepts to return."),
      offset: numberParameter("Number of matching concepts to skip before returning results."),
    },
  ),
  get_concept: defineTool(
    "Read one valid OKF concept, including its frontmatter, Markdown body, and links.",
    READ_ONLY,
    {
      uri: stringParameter("Canonical or path based okf URI for the concept."),
      bundle: stringParameter("Bundle id used with path when uri is not supplied."),
      path: stringParameter("Bundle relative Markdown path used with bundle when uri is not supplied."),
    },
    [],
    {
      anyOf: [
        { required: ["uri"] },
        { required: ["bundle", "path"] },
      ],
    },
  ),
  search_concepts: defineTool(
    "Search OKF concepts and return ranked summaries using text and structured filters.",
    READ_ONLY,
    {
      query: stringParameter("Text query matched against concept metadata and content."),
      bundle: stringParameter("Limit results to this bundle id."),
      types: stringArrayParameter("Limit results to any of these concept types."),
      tagsAny: stringArrayParameter("Require at least one of these tags."),
      tagsAll: stringArrayParameter("Require all of these tags."),
      pathPrefix: stringParameter("Limit results to bundle relative paths beginning with this prefix."),
      relationType: stringParameter("Limit results to concepts participating in this relation type."),
      limit: numberParameter("Maximum number of concepts to return."),
      offset: numberParameter("Number of matching concepts to skip before returning results."),
    },
  ),
  list_types: defineTool(
    "Count the concept types present in the current OKF index.",
    READ_ONLY,
  ),
  list_tags: defineTool(
    "Count the tags present on concepts in the current OKF index.",
    READ_ONLY,
  ),
  list_relation_types: defineTool(
    "Count the typed relations present in the current OKF graph.",
    READ_ONLY,
  ),
  load_remote_bundle: defineTool(
    "Fetch a public GitHub Markdown tree and add it to the in memory index as a read only remote bundle.",
    REMOTE_LOAD,
    {
      id: stringParameter("Unique bundle id to assign to the fetched remote tree."),
      url: stringParameter("Public GitHub tree URL to fetch."),
      provider: stringParameter("Remote provider name. Only github is supported.", { enum: ["github"] }),
      include: stringArrayParameter("Optional glob patterns selecting remote Markdown paths to include."),
      exclude: stringArrayParameter("Optional glob patterns selecting remote Markdown paths to exclude."),
    },
    ["id", "url"],
  ),
  list_remote_bundles: defineTool(
    "List metadata for remote bundles currently loaded into the server.",
    READ_ONLY,
  ),
  okf_validate_concept: defineTool(
    "Validate a proposed new OKF concept without writing a proposal or concept file.",
    READ_ONLY,
    {
      bundle: stringParameter("Writable bundle id that would contain the concept."),
      path: stringParameter("Safe bundle relative Markdown path for the concept."),
      frontmatter: objectParameter("Complete YAML frontmatter represented as a JSON object."),
      body: stringParameter("Markdown body for the concept."),
    },
    ["bundle", "path", "frontmatter"],
  ),
  okf_suggest_concept_path: defineTool(
    "Suggest a safe bundle relative Markdown path from a concept type and title.",
    READ_ONLY,
    {
      bundle: stringParameter("Writable bundle id that will contain the concept."),
      type: stringParameter("Concept type used to build the path."),
      title: stringParameter("Concept title used to build the file name."),
      prefix: stringParameter("Optional bundle relative directory prefix."),
    },
    ["bundle", "type", "title"],
  ),
  okf_propose_concept: defineTool(
    "Create a reviewable proposal for a new OKF concept without writing the concept file.",
    LOCAL_WRITE,
    {
      bundle: stringParameter("Writable bundle id that will contain the concept."),
      path: stringParameter("Safe bundle relative Markdown path for the new concept."),
      frontmatter: objectParameter("Complete YAML frontmatter represented as a JSON object."),
      body: stringParameter("Markdown body for the new concept."),
      message: stringParameter("Optional review note explaining why the concept should be created."),
    },
    ["bundle", "path", "frontmatter"],
  ),
  okf_propose_update: defineTool(
    "Create a reviewable update proposal for an existing OKF concept while preserving unspecified content.",
    LOCAL_WRITE,
    {
      uri: stringParameter("Canonical or path based okf URI of the existing concept."),
      frontmatter: objectParameter("Frontmatter fields to add or replace; unspecified fields are preserved."),
      removeFrontmatterKeys: stringArrayParameter("Frontmatter keys to remove; the id field cannot be removed."),
      body: stringParameter("Replacement Markdown body; omit it to preserve the current body."),
      message: stringParameter("Optional review note explaining why the concept should be updated."),
    },
    ["uri"],
    {
      anyOf: [
        { required: ["frontmatter"] },
        { required: ["removeFrontmatterKeys"] },
        { required: ["body"] },
      ],
    },
  ),
  okf_list_proposals: defineTool(
    "List compact metadata for stored authoring proposals.",
    READ_ONLY,
    {
      bundle: stringParameter("Limit results to proposals for this bundle id."),
      status: stringParameter("Limit results to this proposal status.", { enum: ["proposed", "accepted", "rejected"] }),
    },
  ),
  okf_get_proposal: defineTool(
    "Read one authoring proposal, including its candidate content and validation result.",
    READ_ONLY,
    {
      proposalId: stringParameter("Identifier returned when the proposal was created."),
    },
    ["proposalId"],
  ),
  okf_accept_proposal: defineTool(
    "Accept a reviewed proposal and write its new or updated concept file after revalidation.",
    DESTRUCTIVE_WRITE,
    {
      proposalId: stringParameter("Identifier of the proposed change to accept."),
    },
    ["proposalId"],
  ),
  okf_reject_proposal: defineTool(
    "Reject a reviewed proposal so it can no longer be accepted.",
    DESTRUCTIVE_WRITE,
    {
      proposalId: stringParameter("Identifier of the proposed change to reject."),
      reason: stringParameter("Optional explanation recorded with the rejection."),
    },
    ["proposalId"],
  ),
  get_graph: defineTool(
    "Return a bounded set of OKF graph nodes and edges with optional concept filters.",
    READ_ONLY,
    {
      bundle: stringParameter("Limit graph nodes to this bundle id."),
      type: stringParameter("Limit graph nodes to this exact concept type."),
      tag: stringParameter("Limit graph nodes to concepts containing this tag."),
      pathPrefix: stringParameter("Limit graph nodes to bundle relative paths beginning with this prefix."),
      includeExternal: booleanParameter("Include opaque external relation targets in the graph."),
      maxNodes: numberParameter("Maximum number of graph nodes to return."),
      maxEdges: numberParameter("Maximum number of graph edges to return."),
    },
  ),
  get_neighbors: defineTool(
    "Return the incoming and outgoing graph relationships for one OKF concept.",
    READ_ONLY,
    {
      uri: stringParameter("Canonical or path based okf URI of the center concept."),
    },
    ["uri"],
  ),
  get_subgraph: defineTool(
    "Traverse a bounded OKF subgraph outward from one or more seed concepts.",
    READ_ONLY,
    {
      uri: stringParameter("Single canonical or path based okf URI to use as a seed."),
      seeds: stringArrayParameter("One or more okf URIs to use as traversal seeds."),
      depth: numberParameter("Maximum relationship depth to traverse from the seeds."),
      maxNodes: numberParameter("Maximum number of graph nodes to return."),
    },
    [],
    {
      anyOf: [
        { required: ["uri"] },
        { required: ["seeds"] },
      ],
    },
  ),
  find_paths: defineTool(
    "Find bounded relationship paths between two OKF concepts.",
    READ_ONLY,
    {
      source: stringParameter("Canonical or path based okf URI where path search begins."),
      target: stringParameter("Canonical or path based okf URI where path search ends."),
      maxPaths: numberParameter("Maximum number of distinct paths to return."),
    },
    ["source", "target"],
  ),
  graph_summary: defineTool(
    "Summarize bundle, concept, edge, type, tag, and graph health counts.",
    READ_ONLY,
  ),
  validate_bundle: defineTool(
    "Report OKF conformance separately from project validity for one bundle or the full current index.",
    READ_ONLY,
    {
      bundle: stringParameter("Optional bundle id to validate in isolation."),
    },
  ),
  validate_project: defineTool(
    "Report OKF conformance, project validity, and structured diagnostics for the complete configured project.",
    READ_ONLY,
  ),
  export_graph: defineTool(
    "Render the current OKF graph as JSON, Graphviz DOT, or Mermaid text.",
    READ_ONLY,
    {
      format: stringParameter("Output format for the graph.", { enum: ["json", "dot", "mermaid"] }),
      includeExternal: booleanParameter("Include opaque external relation targets in the export."),
      maxNodes: numberParameter("Maximum number of graph nodes to export."),
      maxEdges: numberParameter("Maximum number of graph edges to export."),
    },
  ),
};

const TOOL_NAMES = Object.keys(TOOL_DEFINITIONS);
const PROJECT_HELPER_TOOL_NAMES = new Set([
  "okf_validate_concept",
  "okf_suggest_concept_path",
  "okf_list_proposals",
  "okf_get_proposal",
]);
const AUTHORING_MUTATION_TOOL_NAMES = new Set([
  "okf_propose_concept",
  "okf_propose_update",
  "okf_accept_proposal",
  "okf_reject_proposal",
]);
const RUNTIME_REMOTE_TOOL_NAMES = new Set([
  "load_remote_bundle",
]);

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

function toolEnabled(state, name) {
  if (PROJECT_HELPER_TOOL_NAMES.has(name)) {
    return Boolean(state && state.authoringService);
  }
  if (AUTHORING_MUTATION_TOOL_NAMES.has(name)) {
    return Boolean(state && state.authoringService && state.allowAuthoring);
  }
  if (RUNTIME_REMOTE_TOOL_NAMES.has(name)) {
    return Boolean(state && state.allowRuntimeRemoteLoad);
  }
  return true;
}

function requireToolEnabled(state, name) {
  if (!toolEnabled(state, name)) {
    throw new Error(`MCP tool is disabled by server configuration: ${name}`);
  }
}

function listTools(state) {
  return {
    tools: TOOL_NAMES
      .filter((name) => toolEnabled(state, name))
      .map((name) => Object.assign({ name }, TOOL_DEFINITIONS[name])),
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

function requireAuthoring(state) {
  if (!state.authoringService) {
    throw new Error("OKF authoring is not configured. Start the server with --project to enable writable concept proposals.");
  }
  return state.authoringService;
}

function rebuildStateIndex(state) {
  const index = buildIndex(
    state.localBundleArgs.concat(state.remoteBundles),
    { relationTypes: state.relationTypes },
  );
  state.index = state.project ? attachProject(index, state.project) : index;
  return state.index;
}

async function callTool(state, name, args) {
  if (!state || !state.index) {
    state = {
      index: state,
      localBundleArgs: [],
      remoteBundles: [],
      relationTypes: state && state.relationTypes,
      project: null,
      authoringService: null,
      allowAuthoring: false,
      allowRuntimeRemoteLoad: false,
    };
  }
  requireToolEnabled(state, name);
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
      if (state.index.bundles.some((bundle) => bundle.id === args.id)) {
        throw new Error(`Bundle id already loaded: ${args.id}`);
      }
      const remoteBundle = await fetchGitHubBundle({
        id: args.id,
        url: args.url,
        include: Array.isArray(args.include) ? args.include : [],
        exclude: Array.isArray(args.exclude) ? args.exclude : [],
      });
      state.remoteBundles.push(remoteBundle);
      rebuildStateIndex(state);
      return jsonContent(remoteBundle.remoteSource);
    }
    case "okf_validate_concept":
      return jsonContent(requireAuthoring(state).validateConcept(args || {}));
    case "okf_suggest_concept_path":
      return jsonContent(requireAuthoring(state).suggestConceptPath(args || {}));
    case "okf_propose_concept":
      return jsonContent(await requireAuthoring(state).proposeConcept(args || {}));
    case "okf_propose_update":
      return jsonContent(await requireAuthoring(state).proposeUpdate(args || {}));
    case "okf_list_proposals":
      return jsonContent(await requireAuthoring(state).listProposals(args || {}));
    case "okf_get_proposal":
      return jsonContent(await requireAuthoring(state).getProposal(args || {}));
    case "okf_accept_proposal": {
      const result = await requireAuthoring(state).acceptProposal(args || {});
      if (result.accepted) {
        rebuildStateIndex(state);
      }
      return jsonContent(result);
    }
    case "okf_reject_proposal":
      return jsonContent(await requireAuthoring(state).rejectProposal(args || {}));
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
      return jsonContent(validateIndex(index, args && args.bundle));
    case "validate_project":
      return jsonContent(validateIndex(index));
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
  const authoringService = options && options.authoringService;
  let project = null;
  if (authoringService && authoringService.store) {
    project = authoringService.store.project;
  } else if (options && options.projectPath) {
    project = loadProjectConfig(options.projectPath);
  }
  const localBundleArgs = project
    ? project.bundles.filter((bundle) => !bundle.remote)
    : (bundleArgs || []).slice();
  const relationTypes = (options && options.relationTypes)
    || (project && project.relationTypes);
  let initialIndex = options && options.initialIndex;
  if (!initialIndex) {
    initialIndex = buildIndex(localBundleArgs, { relationTypes });
    if (project) {
      initialIndex = attachProject(initialIndex, project);
    }
  }
  const state = {
    index: initialIndex,
    localBundleArgs,
    remoteBundles: (options && options.initialRemoteBundles) || [],
    relationTypes,
    project,
    authoringService,
    allowAuthoring: Boolean(options && options.allowAuthoring),
    allowRuntimeRemoteLoad: Boolean(options && options.allowRuntimeRemoteLoad),
  };
  async function handle(request) {
    const method = request.method;
    const params = request.params || {};
    if (method === "initialize") {
      const requestedVersion = params.protocolVersion;
      if (!SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)) {
        throw new Error(
          `Unsupported MCP protocol version: ${requestedVersion || "<missing>"}. `
          + `Supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
        );
      }
      return {
        protocolVersion: requestedVersion,
        serverInfo: { name: "okf-mcp", version: packageMetadata.version },
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
      return listTools(state);
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
    const store = options.authoringStore || FileConceptStore.fromProject(options.projectPath, { proposalRoot: options.proposalRoot });
    const authoringService = options.authoringService || new ConceptAuthoringService(store);
    const initialIndex = attachProject(
      buildIndex(localBundleArgs.concat(initialRemoteBundles), { relationTypes: loaded.project.relationTypes }),
      loaded.project,
    );
    return createServer(localBundleArgs, {
      initialIndex,
      initialRemoteBundles,
      relationTypes: loaded.project.relationTypes,
      authoringService,
      allowAuthoring: options.allowAuthoring,
      allowRuntimeRemoteLoad: options.allowRuntimeRemoteLoad,
    });
  }
  const remoteBundles = await fetchRemoteBundles((options && options.remoteBundles) || []);
  const localBundleArgs = (bundleArgs || []).slice();
  return createServer(localBundleArgs, {
    initialIndex: buildIndex(localBundleArgs.concat(remoteBundles)),
    initialRemoteBundles: remoteBundles,
    allowAuthoring: options && options.allowAuthoring,
    allowRuntimeRemoteLoad: options && options.allowRuntimeRemoteLoad,
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
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOL_NAMES,
  callTool,
  createServer,
  createServerAsync,
  listResources,
  listTools,
  readResource,
  rebuildStateIndex,
  runStdioServer,
};
