"use strict";

const { fetchGitHubBundle, sanitizeRemoteId } = require("../../remote");
const {
  GATES,
  READ_ONLY,
  REMOTE_LOAD,
  ToolExecutionError,
  defineTool,
  expectedToolOperation,
  jsonContent,
  nonEmptyStringParameter,
  stringArrayParameter,
  stringParameter,
} = require("../registry");

const tools = {
  load_remote_bundle: {
    ...defineTool(
      "Fetch a public GitHub Markdown tree and add it to the in memory index as a read only remote bundle.",
      REMOTE_LOAD,
      {
        id: nonEmptyStringParameter("Unique bundle id to assign to the fetched remote tree."),
        url: nonEmptyStringParameter("Public GitHub tree URL to fetch."),
        provider: stringParameter("Remote provider name. Only github is supported.", { enum: ["github"], default: "github" }),
        include: stringArrayParameter("Optional glob patterns selecting remote Markdown paths to include.", { nonEmptyItems: true }),
        exclude: stringArrayParameter("Optional glob patterns selecting remote Markdown paths to exclude.", { nonEmptyItems: true }),
      },
      ["id", "url"],
    ),
    enabled: GATES.runtimeRemote,
    handler: async (state, args) => {
      const provider = String(args.provider || "github");
      if (provider !== "github") {
        throw new ToolExecutionError(`Unsupported remote bundle provider: ${provider}`);
      }
      const normalizedId = sanitizeRemoteId(args.id);
      if (normalizedId !== args.id) {
        throw new ToolExecutionError("Remote bundle id may contain only letters, numbers, underscores, dots, and hyphens.");
      }
      if (state.index.bundles.some((bundle) => bundle.id === normalizedId)) {
        throw new ToolExecutionError(`Bundle id already loaded: ${normalizedId}`);
      }
      const remoteBundle = await expectedToolOperation(
        () => fetchGitHubBundle({
          id: normalizedId,
          url: args.url,
          include: args.include || [],
          exclude: args.exclude || [],
        }),
        { translateTypeError: true },
      );
      state.remoteBundles.push(remoteBundle);
      state.rebuildIndex();
      return jsonContent(remoteBundle.remoteSource);
    },
  },
  list_remote_bundles: {
    ...defineTool(
      "List metadata for remote bundles currently loaded into the server.",
      READ_ONLY,
    ),
    handler: (state) => jsonContent(
      state.remoteBundles.map((bundle) => Object.assign({ id: bundle.id }, bundle.remoteSource)),
    ),
  },
};

module.exports = { tools };
