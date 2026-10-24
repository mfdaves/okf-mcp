"use strict";

const { MAX_CHANGES, MAX_COMMIT_MESSAGE_BYTES } = require("../../live-authoring");
const {
  DESTRUCTIVE_WRITE,
  GATES,
  READ_ONLY,
  collectionPatchParameter,
  defineTool,
  detailParameter,
  expectedToolOperation,
  jsonContent,
  nonEmptyStringParameter,
  objectParameter,
  optionalBooleanParameter,
  relationParameter,
  sourceParameter,
  stringArrayParameter,
  stringParameter,
} = require("../registry");

const LIVE_CREATE_CHANGE = {
  type: "object",
  additionalProperties: false,
  properties: {
    op: { type: "string", const: "create", description: "Create a new concept." },
    path: nonEmptyStringParameter("Optional safe bundle-relative Markdown path; derived from type and title when omitted."),
    type: nonEmptyStringParameter("Concept type."),
    title: nonEmptyStringParameter("Concept title."),
    description: stringParameter("Optional concept description."),
    body: stringParameter("Optional Markdown body; defaults to an H1 using the title."),
    tags: stringArrayParameter("Initial tags.", { nonEmptyItems: true }),
    sources: {
      type: "array",
      description: "Initial source resources or structured source entries.",
      items: sourceParameter("Source entry."),
    },
    relations: {
      type: "array",
      description: "Initial typed relationships.",
      items: relationParameter("Typed relation."),
    },
    metadata: objectParameter("Optional extension frontmatter; managed concept fields are rejected."),
  },
  required: ["op", "type", "title"],
};

const LIVE_UPDATE_CHANGE = {
  type: "object",
  additionalProperties: false,
  minProperties: 3,
  properties: {
    op: { type: "string", const: "update", description: "Update an existing concept in place." },
    uri: nonEmptyStringParameter("Canonical or compatible URI of the existing concept."),
    title: nonEmptyStringParameter("Replacement title."),
    description: stringParameter("Replacement description."),
    body: stringParameter("Replacement Markdown body."),
    tags: collectionPatchParameter(
      "Tags to add and/or remove; additions win when a tag appears in both lists.",
      nonEmptyStringParameter("Tag."),
    ),
    sources: collectionPatchParameter(
      "Sources to add/replace and/or remove by id or resource.",
      sourceParameter("Source entry or selector."),
    ),
    relations: collectionPatchParameter(
      "Relations to add/replace and/or remove by exact type plus target.",
      relationParameter("Typed relation."),
    ),
    metadata: objectParameter("Extension frontmatter fields to add or replace; managed fields are rejected."),
    removeMetadataKeys: stringArrayParameter("Extension frontmatter keys to remove; managed fields are rejected.", { nonEmptyItems: true }),
  },
  required: ["op", "uri"],
};

const LIVE_CHANGES_DESCRIPTION = [
  `One through ${MAX_CHANGES} concept create or update operations handled as one batch.`,
  "Create grammar: { op: 'create', type, title, path?, description?, body?, tags?: string[], sources?: (string | structured source object)[], relations?: { type, target, label?, description? }[], metadata?: object }.",
  "Update grammar: { op: 'update', uri, title?, description?, body?, tags?: { add?: string[], remove?: string[] }, sources?: { add?: (string | source object)[], remove?: (string | { id } | { resource })[] }, relations?: { add?: relation[], remove?: relation[] }, metadata?, removeMetadataKeys? }; relation = { type, target, label?, description? }; include at least one update field.",
].join(" ");

const LIVE_CHANGE_TOOL_PROPERTIES = {
  bundle: nonEmptyStringParameter("Writable bundle id; optional when exactly one local root is configured."),
  detail: detailParameter("Receipt detail level; compact removes repeated planning fields while full preserves the v0.7 receipt layout."),
  message: stringParameter("Optional Git commit summary when automatic commits are enabled.", {
    maxLength: MAX_COMMIT_MESSAGE_BYTES,
  }),
  changes: {
    type: "array",
    description: LIVE_CHANGES_DESCRIPTION,
    minItems: 1,
    maxItems: MAX_CHANGES,
    items: { oneOf: [LIVE_CREATE_CHANGE, LIVE_UPDATE_CHANGE] },
  },
};

const LIVE_CHANGE_EFFECTS_OUTPUT = {
  type: "object",
  description: "Compact structured summary of the fields changed by this operation.",
  additionalProperties: true,
  properties: {
    changedFields: stringArrayParameter("Substantive concept fields changed, excluding server-managed generation provenance."),
    bodyChanged: optionalBooleanParameter("Whether the Markdown body changed."),
    tags: objectParameter("Tags added and removed by the operation."),
    sources: objectParameter("Sources added and removed by the operation."),
    relations: objectParameter("Added, removed, and updated relation values as structured { type, target, label?, description? } objects."),
    metadata: objectParameter("Metadata fields set and removed by the operation."),
  },
};

const LIVE_CHANGE_SUMMARY_OUTPUT = {
  type: "object",
  description: "Compact receipt for one validated or applied concept operation.",
  additionalProperties: true,
  properties: {
    op: stringParameter("Operation kind."),
    bundle: stringParameter("Target bundle id."),
    path: stringParameter("Bundle-relative concept path."),
    absolutePath: stringParameter("Absolute target concept filename."),
    uri: stringParameter("Canonical concept URI."),
    title: stringParameter("Resulting concept title."),
    baseRevision: {
      description: "Source revision before the operation; null for creates.",
      oneOf: [{ type: "string" }, { type: "null" }],
    },
    candidateRevision: stringParameter("Revision of the validated candidate bytes."),
    effects: LIVE_CHANGE_EFFECTS_OUTPUT,
  },
};

const LIVE_CHANGE_OUTPUT_PROPERTIES = {
  status: stringParameter("Validation or application outcome."),
  readyToApply: optionalBooleanParameter("Whether policy, graph, revision, and configured Git preconditions currently allow apply."),
  filesChanged: optionalBooleanParameter("Whether filesystem changes remain when the request returns."),
  snapshot: objectParameter("Full-receipt time-of-check metadata for this planning result."),
  preconditions: objectParameter("Full-receipt revision and Git preconditions checked for the batch."),
  generated: objectParameter("Server-owned generation actor and timestamp."),
  target: objectParameter("Absolute bundle, repository, and affected-file locations."),
  durability: objectParameter("Working-tree and automatic-commit durability state."),
  changes: {
    type: "array",
    description: "Compact operation receipts.",
    items: LIVE_CHANGE_SUMMARY_OUTPUT,
  },
  validation: objectParameter("Complete future-graph validation result."),
  git: objectParameter("Git policy and commit result."),
};

const LIVE_VALIDATE_OUTPUT = {
  type: "object",
  description: "Read-only validation receipt for a structured concept batch.",
  additionalProperties: true,
  properties: Object.assign({
    valid: optionalBooleanParameter("Whether authoring policy and the complete future graph are valid, independent of transient Git readiness."),
  }, LIVE_CHANGE_OUTPUT_PROPERTIES),
};

const LIVE_APPLY_OUTPUT = {
  type: "object",
  description: "Application, target, durability, and validation receipt for a structured concept batch.",
  additionalProperties: true,
  properties: Object.assign({
    applied: optionalBooleanParameter("Whether the complete batch was applied."),
  }, LIVE_CHANGE_OUTPUT_PROPERTIES),
};

function liveRequest(args) {
  const input = Object.assign({}, args || {});
  const detail = input.detail || "compact";
  delete input.detail;
  return { input, detail };
}

function projectLiveReceipt(receipt, detail) {
  if (detail === "full") return receipt;
  const compact = structuredClone(receipt);
  const preconditionGit = compact.preconditions && compact.preconditions.git;
  if (preconditionGit || compact.git) {
    compact.git = Object.assign({}, preconditionGit || {}, compact.git || {});
  }
  delete compact.snapshot;
  delete compact.preconditions;
  if (compact.target) delete compact.target.absolutePaths;
  if (compact.durability) delete compact.durability.filesChanged;
  (compact.changes || []).forEach((change) => {
    delete change.bundle;
    const effects = change.effects;
    if (!effects) return;
    ["beforeRevision", "afterRevision", "bytesBefore", "bytesAfter"].forEach((key) => delete effects[key]);
    if (effects.bodyChanged === false) delete effects.bodyChanged;
    ["tags", "sources", "relations", "metadata"].forEach((name) => {
      const group = effects[name];
      if (!group) return;
      Object.keys(group).forEach((key) => {
        const list = group[key];
        if (!list || !Array.isArray(list.values)) return;
        if (!list.omitted) delete list.omitted;
        if (!list.values.length && !list.omitted) delete group[key];
      });
      if (!Object.keys(group).length) delete effects[name];
    });
  });
  return compact;
}

function requireLiveAuthoring(state) {
  if (!state.allowWrite || !state.liveAuthoringService) {
    throw new Error("Live OKF authoring is not configured. Start the server with --write and --actor.");
  }
  return state.liveAuthoringService;
}

const tools = {
  okf_validate_changes: {
    ...defineTool(
      "Validate a complete structured concept create or update batch without changing files.",
      READ_ONLY,
      LIVE_CHANGE_TOOL_PROPERTIES,
      ["changes"],
      undefined,
      LIVE_VALIDATE_OUTPUT,
    ),
    enabled: GATES.liveWrite,
    handler: async (state, args) => {
      const request = liveRequest(args);
      const result = await expectedToolOperation(
        () => requireLiveAuthoring(state).validateChanges(request.input, {
          additionalBundles: state.remoteBundles,
        }),
        { translateTypeError: true },
      );
      if (result.applied || result.filesChanged) {
        state.rebuildIndex();
      }
      return jsonContent(projectLiveReceipt(result, request.detail), { structured: true });
    },
  },
  okf_apply_changes: {
    ...defineTool(
      "Validate and apply one or more structured concept creates or updates to one local bundle as one batch.",
      DESTRUCTIVE_WRITE,
      LIVE_CHANGE_TOOL_PROPERTIES,
      ["changes"],
      undefined,
      LIVE_APPLY_OUTPUT,
    ),
    enabled: GATES.liveWrite,
    handler: async (state, args) => {
      const request = liveRequest(args);
      const result = await expectedToolOperation(
        () => requireLiveAuthoring(state).applyChanges(request.input, {
          additionalBundles: state.remoteBundles,
        }),
        { translateTypeError: true },
      );
      if (result.applied || result.filesChanged) {
        state.rebuildIndex();
      }
      return jsonContent(projectLiveReceipt(result, request.detail), {
        structured: true,
        isError: result.applied === false,
      });
    },
  },
};

module.exports = { tools };
