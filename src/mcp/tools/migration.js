"use strict";

const { checkV02Migration } = require("../../migration");
const {
  GATES,
  LOCAL_WRITE,
  READ_ONLY,
  ToolExecutionError,
  defineTool,
  expectedToolOperation,
  jsonContent,
  nonEmptyStringParameter,
  objectParameter,
  requireAuthoring,
  stringArrayParameter,
  stringParameter,
} = require("../registry");

const tools = {
  check_v02_migration: {
    ...defineTool(
      "Analyze a local or remote bundle for safe staged OKF v0.2 migration without creating proposals or writes.",
      READ_ONLY,
      {
        bundle: nonEmptyStringParameter("Bundle id to analyze; optional when exactly one root is loaded."),
        actorMappings: objectParameter("Mappings keyed by URI, path, or $default; each value requires by plus confirmed: true."),
        generatedPaths: stringArrayParameter("Paths generated elsewhere and therefore skipped from direct proposals.", { nonEmptyItems: true }),
      },
      [],
    ),
    handler: async (state, args) => {
      const index = state.index;
      const bundleId = args.bundle || (index.bundles.length === 1 ? index.bundles[0].id : "");
      if (!bundleId) {
        throw new ToolExecutionError("A bundle id is required when more than one OKF root is loaded.");
      }
      if (!index.bundles.some((bundle) => bundle.id === bundleId)) {
        throw new ToolExecutionError(`Unknown OKF bundle: ${bundleId}`);
      }
      return jsonContent(await expectedToolOperation(
        () => checkV02Migration(index, Object.assign({}, args, { bundle: bundleId })),
        { translateTypeError: true },
      ));
    },
  },
  okf_propose_v02_migration: {
    ...defineTool(
      "Create a review-only Stage-A migration manifest plus individual child proposals; never accept them automatically.",
      LOCAL_WRITE,
      {
        bundle: nonEmptyStringParameter("Writable root id; optional when exactly one local root is configured."),
        actorMappings: objectParameter("Mappings keyed by URI, path, or $default; each value requires by plus confirmed: true."),
        generatedPaths: stringArrayParameter("Generated concept paths that must be migrated through their generator.", { nonEmptyItems: true }),
        message: stringParameter("Optional migration review note."),
      },
      [],
    ),
    enabled: GATES.authoringMutation,
    handler: async (state, args) => {
      const result = await expectedToolOperation(
        () => requireAuthoring(state).proposeV02Migration(args),
      );
      return jsonContent(result, { isError: result.created === false });
    },
  },
};

module.exports = { tools };
