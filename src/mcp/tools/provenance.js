"use strict";

const { getProvenance, readBundleAsset } = require("../../computation");
const { readConceptGitSource } = require("../../git-source");
const {
  READ_ONLY,
  booleanParameter,
  defineTool,
  expectedToolOperation,
  integerParameter,
  jsonContent,
  nonEmptyStringParameter,
} = require("../registry");

const tools = {
  get_provenance: {
    ...defineTool(
      "Trace normalized source provenance through internal concepts without fetching external resources.",
      READ_ONLY,
      {
        uri: nonEmptyStringParameter("Canonical or compatibility OKF URI of the root concept."),
        maxDepth: integerParameter("Maximum internal source depth.", 0, 10, 3),
        maxNodes: integerParameter("Maximum provenance nodes.", 1, 1000, 100),
        includeExternal: booleanParameter(
          "Include URL and opaque provenance leaves without fetching them.",
        ),
      },
      ["uri"],
    ),
    handler: async (state, args) =>
      jsonContent(
        await expectedToolOperation(() => getProvenance(state.index, args.uri, args), {
          translateTypeError: true,
        }),
      ),
  },
  read_bundle_asset: {
    ...defineTool(
      "Read one explicitly referenced, already indexed bundle asset with digest verification and byte bounds.",
      READ_ONLY,
      {
        uri: nonEmptyStringParameter("Indexed okf-asset URI."),
        bundle: nonEmptyStringParameter("Bundle id used with path when uri is omitted."),
        path: nonEmptyStringParameter("Bundle-relative indexed asset path used with bundle."),
        maxContentBytes: integerParameter("Maximum asset bytes to return.", 1, 1048576, 65536),
      },
      [],
      { anyOf: [{ required: ["uri"] }, { required: ["bundle", "path"] }] },
    ),
    handler: async (state, args) =>
      jsonContent(
        await expectedToolOperation(() => readBundleAsset(state.index, args), {
          translateTypeError: true,
        }),
      ),
  },
  read_git_source: {
    ...defineTool(
      "Read one pinned sources[].git entry from an explicitly mapped checkout or bare repository without fetching.",
      READ_ONLY,
      {
        concept: nonEmptyStringParameter(
          "Concept ID, Markdown path, custom ID, or compatibility URI declaring the source.",
        ),
        sourceId: nonEmptyStringParameter("Exact sources[].id value to read."),
        maxContentBytes: integerParameter("Maximum Git blob bytes to read.", 1, 1048576, 65536),
      },
      ["concept", "sourceId"],
    ),
    handler: async (state, args) =>
      jsonContent(
        await expectedToolOperation(
          () =>
            readConceptGitSource(
              state.index,
              args.concept,
              args.sourceId,
              state.repositoryMappings,
              { maxBytes: args.maxContentBytes || 65536 },
            ),
          { translateTypeError: true },
        ),
      ),
  },
};

module.exports = { tools };
