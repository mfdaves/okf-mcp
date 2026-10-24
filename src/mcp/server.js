"use strict";

const { McpServer, ResourceTemplate, fromJsonSchema } = require("@modelcontextprotocol/server");
const { StdioServerTransport, serveStdio } = require("@modelcontextprotocol/server/stdio");
const { attachProject, buildIndex, loadProjectBundles } = require("../indexer");
const { fetchRemoteBundles } = require("../remote");
const { ConceptAuthoringService } = require("../authoring");
const { LiveAuthoringService } = require("../live-authoring");
const { FileConceptStore } = require("../store");
const { loadProjectConfig } = require("../project");
const { ProducerService } = require("../producers");
const packageMetadata = require("../../package.json");
const { ToolExecutionError, composeRegistry, jsonContent, toolEnabled } = require("./registry");
const { listResources, readResource } = require("./resources");

const MAX_MCP_MESSAGE_BYTES = 1024 * 1024;

// Each area module exports its tools with schema, annotations, gate, and
// handler together; the registry fixes the advertised order and rejects
// duplicates or tools missing from that order.
const registry = composeRegistry([
  require("./tools/catalog"),
  require("./tools/search"),
  require("./tools/graph"),
  require("./tools/provenance"),
  require("./tools/computation"),
  require("./tools/migration"),
  require("./tools/remote"),
  require("./tools/proposals"),
  require("./tools/live-authoring"),
  require("./tools/producers"),
]);

function rebuildStateIndex(state) {
  const index = buildIndex(state.localBundleArgs.concat(state.remoteBundles), {
    relationTypes: state.relationTypes,
    strictLinks: state.strictLinks,
    allowCustomRelationTypes: state.allowCustomRelationTypes,
  });
  state.index = state.project ? attachProject(index, state.project) : index;
  if (state.languages) {
    state.index.languages = state.languages;
  }
  return state.index;
}

async function callTool(state, name, args) {
  const tool = registry.tools[name];
  try {
    if (!tool) {
      throw new Error(`Unknown registered MCP tool: ${name}`);
    }
    return await tool.handler(state, args);
  } catch (error) {
    if (!(error instanceof ToolExecutionError)) {
      throw error;
    }
    const failure = {
      error: "Tool execution failed",
      tool: name,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
    return jsonContent(failure, { isError: true, structured: true });
  }
}

function createState(bundleArgs, options) {
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
  const relationTypes = (options && options.relationTypes) || (project && project.relationTypes);
  const allowCustomRelationTypes = Boolean(
    (options && options.allowCustomRelationTypes) || (project && project.rootMode),
  );
  let initialIndex = options && options.initialIndex;
  if (!initialIndex) {
    initialIndex = buildIndex(localBundleArgs, {
      relationTypes,
      strictLinks: Boolean((options && options.strictLinks) || (project && project.strictLinks)),
      allowCustomRelationTypes,
    });
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
    liveAuthoringService: options && options.liveAuthoringService,
    producerService: options && options.producerService,
    allowWrite: Boolean(options && options.allowWrite),
    actor: options && options.actor,
    allowAuthoring: Boolean(options && options.allowAuthoring),
    allowRuntimeRemoteLoad: Boolean(options && options.allowRuntimeRemoteLoad),
    allowComputationAuthoring: Boolean(options && options.allowComputationAuthoring),
    strictLinks: Boolean((options && options.strictLinks) || (project && project.strictLinks)),
    allowCustomRelationTypes,
    repositoryMappings: (options && options.repositoryMappings) || new Map(),
    // Search stemming languages from --languages; the project config's value
    // travels on index.project (attachProject) and detection covers the rest.
    languages: (options && options.languages) || undefined,
  };
  if (state.languages) {
    state.index.languages = state.languages;
  }
  // Tool handlers refresh the index through the state so index construction
  // stays in this module; handlers never see bundle arguments or build options.
  state.rebuildIndex = () => rebuildStateIndex(state);
  if (
    !state.producerService &&
    project &&
    (project.producers || []).length &&
    authoringService &&
    authoringService.store
  ) {
    state.producerService = new ProducerService({
      project,
      store: authoringService.store,
      bundles: localBundleArgs,
      loader: options && options.producerLoader,
      env: options && options.producerEnv,
      now: options && options.producerNow,
    });
  }
  return state;
}

async function createStateAsync(bundleArgs, options) {
  if (options && options.projectPath) {
    const loaded = await loadProjectBundles(options.projectPath);
    const extraRemoteBundles = await fetchRemoteBundles(options.remoteBundles || []);
    const initialRemoteBundles = loaded.remoteBundles.concat(extraRemoteBundles);
    const localBundleArgs = (loaded.bundles || []).filter((bundle) => !bundle.remote);
    const store =
      options.authoringStore ||
      FileConceptStore.fromProject(options.projectPath, { proposalRoot: options.proposalRoot });
    const authoringService = options.authoringService || new ConceptAuthoringService(store);
    const liveAuthoringService =
      options.liveAuthoringService ||
      (options.allowWrite
        ? new LiveAuthoringService(store, { actor: options.actor, gitCommit: options.gitCommit })
        : null);
    const initialIndex = attachProject(
      buildIndex(localBundleArgs.concat(initialRemoteBundles), {
        relationTypes: loaded.project.relationTypes,
        strictLinks: options.strictLinks || loaded.project.strictLinks,
      }),
      loaded.project,
    );
    return createState(localBundleArgs, {
      initialIndex,
      initialRemoteBundles,
      relationTypes: loaded.project.relationTypes,
      authoringService,
      liveAuthoringService,
      producerService: options.producerService,
      producerLoader: options.producerLoader,
      producerEnv: options.producerEnv,
      producerNow: options.producerNow,
      allowWrite: options.allowWrite,
      actor: options.actor,
      allowAuthoring: options.allowAuthoring,
      allowRuntimeRemoteLoad: options.allowRuntimeRemoteLoad,
      allowComputationAuthoring: options.allowComputationAuthoring,
      strictLinks: options.strictLinks || loaded.project.strictLinks,
      repositoryMappings: options.repositoryMappings,
      languages: options.languages,
    });
  }
  if (options && options.rootPath) {
    const store =
      options.authoringStore ||
      FileConceptStore.fromRoot(options.rootPath, {
        proposalRoot: options.proposalRoot,
        strictLinks: options.strictLinks,
      });
    const authoringService = options.authoringService || new ConceptAuthoringService(store);
    const liveAuthoringService =
      options.liveAuthoringService ||
      (options.allowWrite
        ? new LiveAuthoringService(store, { actor: options.actor, gitCommit: options.gitCommit })
        : null);
    const localBundleArgs = store.getBundles();
    const remoteBundles = await fetchRemoteBundles(options.remoteBundles || []);
    const initialIndex = attachProject(
      buildIndex(localBundleArgs.concat(remoteBundles), {
        relationTypes: store.getRelationTypes(),
        strictLinks: options.strictLinks,
        allowCustomRelationTypes: true,
      }),
      store.project,
    );
    return createState(localBundleArgs, {
      initialIndex,
      initialRemoteBundles: remoteBundles,
      relationTypes: store.getRelationTypes(),
      authoringService,
      liveAuthoringService,
      producerService: options.producerService,
      allowWrite: options.allowWrite,
      actor: options.actor,
      allowAuthoring: options.allowAuthoring,
      allowRuntimeRemoteLoad: options.allowRuntimeRemoteLoad,
      allowComputationAuthoring: options.allowComputationAuthoring,
      strictLinks: options.strictLinks,
      allowCustomRelationTypes: true,
      repositoryMappings: options.repositoryMappings,
      languages: options.languages,
    });
  }
  const remoteBundles = await fetchRemoteBundles((options && options.remoteBundles) || []);
  const localBundleArgs = (bundleArgs || []).slice();
  const liveAuthoringService =
    options && options.liveAuthoringService
      ? options.liveAuthoringService
      : options && options.allowWrite && options.authoringService && options.authoringService.store
        ? new LiveAuthoringService(options.authoringService.store, {
            actor: options.actor,
            gitCommit: options.gitCommit,
          })
        : null;
  if (options && options.allowWrite && !liveAuthoringService) {
    throw new Error("Live OKF authoring requires --root or --project and a configured actor.");
  }
  return createState(localBundleArgs, {
    initialIndex: buildIndex(localBundleArgs.concat(remoteBundles), {
      strictLinks: options && options.strictLinks,
      allowCustomRelationTypes: true,
    }),
    initialRemoteBundles: remoteBundles,
    authoringService: options && options.authoringService,
    liveAuthoringService,
    producerService: options && options.producerService,
    allowWrite: options && options.allowWrite,
    actor: options && options.actor,
    allowAuthoring: options && options.allowAuthoring,
    allowRuntimeRemoteLoad: options && options.allowRuntimeRemoteLoad,
    allowComputationAuthoring: options && options.allowComputationAuthoring,
    strictLinks: options && options.strictLinks,
    allowCustomRelationTypes: true,
    repositoryMappings: options && options.repositoryMappings,
    languages: options && options.languages,
  });
}

function registerMcpInterface(state) {
  const server = new McpServer(
    {
      name: "okf-mcp",
      version: packageMetadata.version,
    },
    {
      capabilities: {
        resources: { listChanged: false },
        tools: { listChanged: false },
      },
    },
  );
  let pendingToolCall = Promise.resolve();
  const resources = new ResourceTemplate("okf://{+locator}", {
    list: async () => listResources(state.index),
  });
  server.registerResource(
    "okf-documents",
    resources,
    {
      description: "Markdown documents in the loaded Open Knowledge Format catalog.",
      mimeType: "text/markdown",
    },
    async (uri) => readResource(state.index, uri.href),
  );
  registry.names
    .filter((name) => toolEnabled(registry.tools[name], state))
    .forEach((name) => {
      const definition = registry.tools[name];
      server.registerTool(
        name,
        {
          description: definition.description,
          annotations: definition.annotations,
          inputSchema: fromJsonSchema(definition.inputSchema),
          ...(definition.outputSchema
            ? { outputSchema: fromJsonSchema(definition.outputSchema) }
            : {}),
        },
        async (args) => {
          const current = pendingToolCall.then(async () => {
            try {
              return await callTool(state, name, args);
            } catch {
              return jsonContent(
                {
                  error: "Internal tool error",
                  tool: name,
                },
                { isError: true },
              );
            }
          });
          pendingToolCall = current.catch(() => {});
          return current;
        },
      );
    });
  return server;
}

async function createMcpServer(bundleArgs, options) {
  return registerMcpInterface(await createStateAsync(bundleArgs, options));
}

async function runStdioServer(bundleArgs, input, output, options) {
  const state = await createStateAsync(bundleArgs, options);
  const transport = new StdioServerTransport(input, output, {
    maxBufferSize: MAX_MCP_MESSAGE_BYTES,
  });
  return serveStdio(() => registerMcpInterface(state), { legacy: "serve", transport });
}

module.exports = {
  createMcpServer,
  runStdioServer,
};
