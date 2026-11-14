"use strict";

const { McpServer, ResourceTemplate, fromJsonSchema } = require("@modelcontextprotocol/server");
const { StdioServerTransport, serveStdio } = require("@modelcontextprotocol/server/stdio");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const {
  attachProject,
  buildIndex,
  indexInputs,
  indexUpdateStats,
  loadProjectBundles,
  parseBundleArg,
  refreshIndex,
  updateIndex,
} = require("../indexer");
const { fetchRemoteBundles } = require("../remote");
const { ConceptAuthoringService } = require("../authoring");
const { LiveAuthoringService } = require("../live-authoring");
const { FileConceptStore } = require("../store");
const { DEFAULT_RELATION_TYPES, loadProjectConfig } = require("../project");
const { ProducerService } = require("../producers");
const { loadEmbeddingConfigFile } = require("../search/embedding-config");
const { openEmbeddingRuntime } = require("../search/hybrid");
const { callPackTool, loadToolPacks, toolPackScopes } = require("../tool-packs");
const packageMetadata = require("../../package.json");
const { READ_SCOPE, flagsPrincipal } = require("./principal");
const { ToolExecutionError, composeRegistry, jsonContent, toolEnabled } = require("./registry");
const { listResources, readResource } = require("./resources");

const MAX_MCP_MESSAGE_BYTES = 1024 * 1024;

// Each area module exports its tools with schema, annotations, gate, and
// handler together; the registry fixes the advertised order and rejects
// duplicates or tools missing from that order.
const registry = composeRegistry([
  require("./tools/catalog"),
  require("./tools/search"),
  require("./tools/context"),
  require("./tools/graph"),
  require("./tools/provenance"),
  require("./tools/computation"),
  require("./tools/migration"),
  require("./tools/remote"),
  require("./tools/proposals"),
  require("./tools/live-authoring"),
  require("./tools/producers"),
]);

// Whether the server's index was built from exactly what the live authoring
// service would build its own from (the service's bundles with their include
// and exclude patterns plus the server's remote snapshots, its relation
// types and flags, a floating date, the server's languages), so the two can
// share one index object instead of each keeping a copy. The check reads the
// index's own build record, so an index a host built from other arguments
// is never shared.
function liveIndexCompatible(state) {
  const service = state.liveAuthoringService;
  const store = service?.store;
  if (!store || typeof service.adoptIndex !== "function" || store.project !== state.project) {
    return false;
  }
  const built = indexInputs(state.index);
  if (!built) {
    return false;
  }
  const expected = {
    bundles: store
      .getBundles()
      .concat(state.remoteBundles || [])
      .map(parseBundleArg)
      .map((bundle) => ({
        id: bundle.id,
        root: bundle.root,
        remote: Boolean(bundle.remote),
        include: (bundle.include || []).map(String),
        exclude: (bundle.exclude || []).map(String),
      })),
    relationTypes: Array.from(
      new Set((store.getRelationTypes() || DEFAULT_RELATION_TYPES).map(String)),
    ),
    allowCustomRelationTypes: Boolean(store.allowCustomRelationTypes),
    strictLinks: Boolean(store.strictLinks),
    asOf: null,
    // The server stamps its --languages on the index; the service reads none.
    languages: state.languages === undefined ? null : state.languages,
  };
  return isDeepStrictEqual(built, expected);
}

function shareIndexWithLiveAuthoring(state) {
  if (state.shareLiveIndex) {
    state.liveAuthoringService.adoptIndex(state.index, state.remoteBundles);
  }
}

// After a live batch the service hands over what it published: the server
// adopts the service's index when the two share one, applies the batch to its
// own index otherwise (brought up to date with the files first, as the
// service's own index was), and only rebuilds from scratch when there is no
// batch to apply (producer runs, proposals, remote loads, a stale concept
// file).
function rebuildStateIndex(state) {
  const service = state.liveAuthoringService;
  const publication =
    service && typeof service.takePublication === "function" ? service.takePublication() : null;
  if (publication) {
    if (publication.hostOwned && publication.index) {
      state.index = publication.index;
      return state.index;
    }
    if (indexUpdateStats(state.index)) {
      state.index = updateIndex(refreshIndex(state.index), publication.changes);
      return state.index;
    }
  }
  const index = buildIndex(state.localBundleArgs.concat(state.remoteBundles), {
    relationTypes: state.relationTypes,
    strictLinks: state.strictLinks,
    allowCustomRelationTypes: state.allowCustomRelationTypes,
  });
  state.index = state.project ? attachProject(index, state.project) : index;
  if (state.languages) {
    state.index.languages = state.languages;
  }
  shareIndexWithLiveAuthoring(state);
  return state.index;
}

// Runs one tool for a principal (the flags' principal when none is given, as
// over stdio). A tool whose gate the principal does not pass is unknown to it.
// Plan I-2c: brings the server's index up to date with files edited outside
// okf-mcp (size and mtime, refreshIndex) and hands a changed index to live
// authoring as a write would. Indexes that did not come out of buildIndex
// are left as they are. Callers run it inside the call queue.
function refreshStateIndex(state) {
  if (!indexUpdateStats(state.index)) {
    return state.index;
  }
  const refreshed = refreshIndex(state.index);
  if (refreshed !== state.index) {
    state.index = refreshed;
    shareIndexWithLiveAuthoring(state);
  }
  return state.index;
}

async function callTool(state, name, args, principal) {
  const tool = registry.tools[name];
  const caller = principal || flagsPrincipal(state);
  try {
    if (!tool || !toolEnabled(tool, state, caller)) {
      throw new Error(`Unknown registered MCP tool: ${name}`);
    }
    return await tool.handler(state, args, caller);
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
  const authoringService = options?.authoringService;
  let project = null;
  if (authoringService?.store) {
    project = authoringService.store.project;
  } else if (options?.projectPath) {
    project = loadProjectConfig(options.projectPath);
  }
  const localBundleArgs = project
    ? project.bundles.filter((bundle) => !bundle.remote)
    : (bundleArgs || []).slice();
  const relationTypes = options?.relationTypes || project?.relationTypes;
  const allowCustomRelationTypes = Boolean(options?.allowCustomRelationTypes || project?.rootMode);
  let initialIndex = options?.initialIndex;
  if (!initialIndex) {
    initialIndex = buildIndex(localBundleArgs, {
      relationTypes,
      strictLinks: Boolean(options?.strictLinks || project?.strictLinks),
      allowCustomRelationTypes,
    });
    if (project) {
      initialIndex = attachProject(initialIndex, project);
    }
  }
  const state = {
    index: initialIndex,
    localBundleArgs,
    remoteBundles: options?.initialRemoteBundles || [],
    relationTypes,
    project,
    authoringService,
    liveAuthoringService: options?.liveAuthoringService,
    producerService: options?.producerService,
    allowWrite: Boolean(options?.allowWrite),
    actor: options?.actor,
    allowAuthoring: Boolean(options?.allowAuthoring),
    allowRuntimeRemoteLoad: Boolean(options?.allowRuntimeRemoteLoad),
    allowComputationAuthoring: Boolean(options?.allowComputationAuthoring),
    strictLinks: Boolean(options?.strictLinks || project?.strictLinks),
    allowCustomRelationTypes,
    repositoryMappings: options?.repositoryMappings || new Map(),
    // Search stemming languages from --languages; the project config's value
    // travels on index.project (attachProject) and detection covers the rest.
    languages: options?.languages || undefined,
    // "http" once an HTTP handler serves the state to many principals.
    transport: "stdio",
    // Set by an HTTP handler: run before a call or resource read (plan I-2c).
    refreshBeforeRead: null,
    // Tool packs (plan D1) and the scopes their tools declare beyond okf.*.
    toolPacks: [],
    toolPackScopes: [],
    // One tool-call queue per process: every McpServer built on this state
    // (one per stdio connection, one per HTTP request) runs its tool calls
    // through it, so calls from different sessions never interleave.
    callQueue: Promise.resolve(),
  };
  if (state.languages) {
    state.index.languages = state.languages;
  }
  // Tool handlers refresh the index through the state so index construction
  // stays in this module; handlers never see bundle arguments or build options.
  state.rebuildIndex = () => rebuildStateIndex(state);
  state.refreshIndex = () => refreshStateIndex(state);
  state.shareLiveIndex = liveIndexCompatible(state);
  shareIndexWithLiveAuthoring(state);
  if (
    !state.producerService &&
    project &&
    (project.producers || []).length &&
    authoringService?.store
  ) {
    state.producerService = new ProducerService({
      project,
      store: authoringService.store,
      bundles: localBundleArgs,
      loader: options?.producerLoader,
      env: options?.producerEnv,
      now: options?.producerNow,
    });
  }
  return state;
}

// Hybrid search settings (WP3c): a library caller's settings object, the
// --embedder-config file of --root mode, or the project's own; --cache-dir
// (relative to the working directory) overrides the cache location.
function embeddingSettings(projectSettings, options) {
  const given = options?.embedding || {};
  const base = given.embedder
    ? given
    : given.configPath
      ? loadEmbeddingConfigFile(given.configPath)
      : projectSettings;
  if (!base) return null;
  return given.cacheDir
    ? Object.assign({}, base, { cacheDir: path.resolve(given.cacheDir) })
    : base;
}

// Opens the embedding runtime (never throws: failures leave it degraded) and
// prepares the missing vectors in the background, so a large first embed
// never delays the server's start; searches stay lexical until rows exist.
async function attachEmbeddings(state, settings, context) {
  if (!settings) return state;
  state.embeddings = await openEmbeddingRuntime(settings, context);
  state.embeddings.scheduleSync(state.index);
  return state;
}

async function createStateAsync(bundleArgs, options) {
  if (options?.projectPath) {
    const loaded = await loadProjectBundles(options.projectPath);
    // Tool packs load first: a pack that fails stops the server at startup.
    const toolPacks = await loadToolPacks(loaded.project, {
      loader: options.toolPackLoader,
      env: options.toolPackEnv,
      coreNames: registry.names,
    });
    const extraRemoteBundles = await fetchRemoteBundles(options.remoteBundles || []);
    const initialRemoteBundles = loaded.remoteBundles.concat(extraRemoteBundles);
    const localBundleArgs = (loaded.bundles || []).filter((bundle) => !bundle.remote);
    const store =
      options.authoringStore ||
      FileConceptStore.fromProject(options.projectPath, { proposalRoot: options.proposalRoot });
    const authoringService =
      options.authoringService ||
      new ConceptAuthoringService(store, {
        actor: options.actor,
        writePolicy: options.writePolicy,
      });
    const liveAuthoringService =
      options.liveAuthoringService ||
      (options.allowWrite
        ? new LiveAuthoringService(store, {
            actor: options.actor,
            gitCommit: options.gitCommit,
            writePolicy: options.writePolicy,
          })
        : null);
    const initialIndex = attachProject(
      buildIndex(localBundleArgs.concat(initialRemoteBundles), {
        relationTypes: loaded.project.relationTypes,
        strictLinks: options.strictLinks || loaded.project.strictLinks,
      }),
      loaded.project,
    );
    const projectState = createState(localBundleArgs, {
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
    projectState.toolPacks = toolPacks;
    projectState.toolPackScopes = toolPackScopes(toolPacks);
    return attachEmbeddings(projectState, embeddingSettings(loaded.project.embedding, options), {
      root: loaded.project.root,
      write: Boolean(options.allowWrite),
    });
  }
  if (options?.rootPath) {
    const store =
      options.authoringStore ||
      FileConceptStore.fromRoot(options.rootPath, {
        proposalRoot: options.proposalRoot,
        strictLinks: options.strictLinks,
      });
    const authoringService =
      options.authoringService ||
      new ConceptAuthoringService(store, {
        actor: options.actor,
        writePolicy: options.writePolicy,
      });
    const liveAuthoringService =
      options.liveAuthoringService ||
      (options.allowWrite
        ? new LiveAuthoringService(store, {
            actor: options.actor,
            gitCommit: options.gitCommit,
            writePolicy: options.writePolicy,
          })
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
    const rootState = createState(localBundleArgs, {
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
    return attachEmbeddings(rootState, embeddingSettings(null, options), {
      root: options.rootPath,
      write: Boolean(options.allowWrite),
    });
  }
  const remoteBundles = await fetchRemoteBundles(options?.remoteBundles || []);
  const localBundleArgs = (bundleArgs || []).slice();
  const liveAuthoringService = options?.liveAuthoringService
    ? options.liveAuthoringService
    : options?.allowWrite && options.authoringService?.store
      ? new LiveAuthoringService(options.authoringService.store, {
          actor: options.actor,
          gitCommit: options.gitCommit,
          writePolicy: options.writePolicy,
        })
      : null;
  if (options?.allowWrite && !liveAuthoringService) {
    throw new Error("Live OKF authoring requires --root or --project and a configured actor.");
  }
  return createState(localBundleArgs, {
    initialIndex: buildIndex(localBundleArgs.concat(remoteBundles), {
      strictLinks: options?.strictLinks,
      allowCustomRelationTypes: true,
    }),
    initialRemoteBundles: remoteBundles,
    authoringService: options?.authoringService,
    liveAuthoringService,
    producerService: options?.producerService,
    allowWrite: options?.allowWrite,
    actor: options?.actor,
    allowAuthoring: options?.allowAuthoring,
    allowRuntimeRemoteLoad: options?.allowRuntimeRemoteLoad,
    allowComputationAuthoring: options?.allowComputationAuthoring,
    strictLinks: options?.strictLinks,
    allowCustomRelationTypes: true,
    repositoryMappings: options?.repositoryMappings,
    languages: options?.languages,
  });
}

// Runs a read of the index. With a refresher set (MCP over HTTP, plan I-2c)
// the read goes through the call queue and the refresher runs first in the
// same job, so the check is taken in arrival order with the calls; without
// one (stdio) the read runs as before.
function readIndex(state, read) {
  if (!state.refreshBeforeRead) return read();
  const current = state.callQueue.then(() => {
    state.refreshBeforeRead();
    return read();
  });
  state.callQueue = current.catch(() => {});
  return current;
}

// The configured tool packs' tools the principal may use, after the core
// tools: it needs okf.read and the tool's scope. A pack call runs outside the
// call queue unless its pack sets serialize: true; `subjectToken` is the
// caller's bearer token over HTTP and absent over stdio.
function registerToolPackTools(server, state, caller, subjectToken) {
  if (!caller.scopes.has(READ_SCOPE)) return;
  for (const pack of state.toolPacks) {
    for (const tool of pack.tools) {
      if (!caller.scopes.has(tool.scope)) continue;
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          annotations: tool.annotations,
          inputSchema: fromJsonSchema(tool.inputSchema),
          ...(tool.outputSchema ? { outputSchema: fromJsonSchema(tool.outputSchema) } : {}),
        },
        async (args, ctx) => {
          const run = () =>
            callPackTool(pack, tool, args, caller, { subjectToken, signal: ctx?.mcpReq?.signal });
          if (!pack.serialize) return run();
          const current = state.callQueue.then(run);
          state.callQueue = current.catch(() => {});
          return current;
        },
      );
    }
  }
}

// One McpServer over shared state, advertising and serving the tools the
// principal may use (the flags' principal when none is given, as over stdio).
// `options.subjectToken` is the HTTP caller's bearer token, for tool packs.
function registerMcpInterface(state, principal, options) {
  const caller = principal || flagsPrincipal(state);
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
  const resources = new ResourceTemplate("okf://{+locator}", {
    list: async () => readIndex(state, () => listResources(state.index)),
  });
  server.registerResource(
    "okf-documents",
    resources,
    {
      description: "Markdown documents in the loaded Open Knowledge Format catalog.",
      mimeType: "text/markdown",
    },
    async (uri) => readIndex(state, () => readResource(state.index, uri.href)),
  );
  registry.names
    .filter((name) => toolEnabled(registry.tools[name], state, caller))
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
          const current = state.callQueue.then(async () => {
            try {
              state.refreshBeforeRead?.();
              return await callTool(state, name, args, caller);
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
          state.callQueue = current.catch(() => {});
          return current;
        },
      );
    });
  registerToolPackTools(server, state, caller, options?.subjectToken);
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
  MAX_MCP_MESSAGE_BYTES,
  createMcpServer,
  runStdioServer,
  /** @internal Exposed for tests that need the server state behind a tool call. */
  callTool,
  /** @internal */
  createStateAsync,
  /** @internal Builds one McpServer over an existing state (tests share one state). */
  registerMcpInterface,
};
