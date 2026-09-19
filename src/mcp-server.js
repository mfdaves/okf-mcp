"use strict";

const fs = require("node:fs");
const path = require("path");
const {
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
  fromJsonSchema,
} = require("@modelcontextprotocol/server");
const { StdioServerTransport, serveStdio } = require("@modelcontextprotocol/server/stdio");
const {
  attachProject,
  buildIndex,
  conceptSignals,
  conceptSummary,
  loadProjectBundles,
  recoverConceptLocator,
  resolveConcept,
  validateIndex,
} = require("./indexer");
const { searchConcepts } = require("./search");
const { MAX_QUERY_CHARACTERS, MAX_QUERY_TERMS } = require("./search-index");
const { exportGraph, findPaths, getGraph, getNeighbors, getSubgraph, graphSummary } = require("./graph");
const { fetchGitHubBundle, fetchRemoteBundles, sanitizeRemoteId } = require("./remote");
const { ConceptAuthoringService } = require("./authoring");
const {
  LiveAuthoringService,
  MAX_CHANGES,
  MAX_COMMIT_MESSAGE_BYTES,
} = require("./live-authoring");
const { FileConceptStore } = require("./store");
const { loadProjectConfig } = require("./project");
const { ProducerService, producerReceipt } = require("./producers");
const {
  checkComputationReceipt,
  getProvenance,
  inspectAttestedComputation,
  prepareAttestedComputation,
  readBundleAsset,
} = require("./computation");
const { checkV02Migration } = require("./migration");
const { describeConceptGitSources, readConceptGitSource } = require("./git-source");
const packageMetadata = require("../package.json");

const MAX_MCP_MESSAGE_BYTES = 1024 * 1024;

class ToolExecutionError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "ToolExecutionError";
    if (typeof code === "string" && code) {
      this.code = code;
    }
    if (details !== undefined) {
      this.details = details;
    }
  }
}

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
const PRODUCER_PREVIEW = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const PRODUCER_RUN = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

function stringParameter(description, extra) {
  return Object.assign({ type: "string", description }, extra || {});
}

function nonEmptyStringParameter(description, extra) {
  return stringParameter(description, Object.assign({ minLength: 1 }, extra || {}));
}

function integerParameter(description, minimum, maximum, defaultValue) {
  return {
    type: "integer",
    description,
    minimum,
    ...(maximum === undefined ? {} : { maximum }),
    default: defaultValue,
  };
}

function booleanParameter(description) {
  return { type: "boolean", description, default: false };
}

function optionalBooleanParameter(description) {
  return { type: "boolean", description };
}

function stringArrayParameter(description, options) {
  const config = options || {};
  return {
    type: "array",
    description,
    items: Object.assign(
      { type: "string" },
      config.nonEmptyItems ? { minLength: 1 } : {},
    ),
    ...(config.minItems === undefined ? {} : { minItems: config.minItems }),
  };
}

function objectParameter(description, extra) {
  return Object.assign({
    type: "object",
    description,
    additionalProperties: true,
  }, extra || {});
}

function detailParameter(description) {
  return stringParameter(description, { enum: ["compact", "full"], default: "compact" });
}

function relationParameter(description) {
  return {
    type: "object",
    description,
    additionalProperties: false,
    properties: {
      type: nonEmptyStringParameter("Typed relation name."),
      target: nonEmptyStringParameter("Relation target URI or bundle-local path."),
      label: stringParameter("Optional human-readable relation label."),
      description: stringParameter("Optional relation explanation."),
    },
    required: ["type", "target"],
  };
}

function sourceParameter(description) {
  return {
    description,
    anyOf: [
      nonEmptyStringParameter("Source resource URI or bundle-local path."),
      objectParameter("Structured OKF source entry."),
    ],
  };
}

function collectionPatchParameter(description, item) {
  return {
    type: "object",
    description,
    additionalProperties: false,
    minProperties: 1,
    properties: {
      add: { type: "array", items: item },
      remove: { type: "array", items: item },
    },
  };
}

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

function defineTool(description, annotations, properties, required, schemaExtras, outputSchema) {
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
    ...(outputSchema ? { outputSchema } : {}),
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
      query: stringParameter(`Optional all-term text query matched against concept metadata and content; maximum ${MAX_QUERY_TERMS} terms.`, { maxLength: MAX_QUERY_CHARACTERS }),
      bundle: nonEmptyStringParameter("Limit results to this bundle id."),
      type: nonEmptyStringParameter("Limit results to this exact concept type."),
      tag: nonEmptyStringParameter("Limit results to concepts containing this tag."),
      detail: detailParameter("Compact returns only URI, title, type, and description; full includes navigation metadata and signals."),
      limit: integerParameter("Maximum number of concepts to return.", 1, 250, 25),
      offset: integerParameter("Number of matching concepts to skip before returning results.", 0, undefined, 0),
    },
  ),
  get_concept: defineTool(
    "Read one valid OKF concept, including its frontmatter, Markdown body, and links.",
    READ_ONLY,
    {
      id: nonEmptyStringParameter("Portable extensionless Concept ID or bundle-relative Markdown path."),
      uri: nonEmptyStringParameter("Canonical or path based okf URI for the concept."),
      bundle: nonEmptyStringParameter("Bundle id used with path when uri is not supplied."),
      path: nonEmptyStringParameter("Bundle relative Markdown path used with bundle when uri is not supplied."),
    },
    [],
    {
      anyOf: [
        { required: ["id"] },
        { required: ["uri"] },
        { required: ["bundle", "path"] },
      ],
    },
  ),
  search_concepts: defineTool(
    "Search OKF concepts and return ranked summaries using text and structured filters.",
    READ_ONLY,
    {
      query: stringParameter(`All-term text query matched against concept metadata and content; maximum ${MAX_QUERY_TERMS} terms.`, { maxLength: MAX_QUERY_CHARACTERS }),
      bundle: nonEmptyStringParameter("Limit results to this bundle id."),
      types: stringArrayParameter("Limit results to any of these concept types.", { nonEmptyItems: true }),
      tagsAny: stringArrayParameter("Require at least one of these tags.", { nonEmptyItems: true }),
      tagsAll: stringArrayParameter("Require all of these tags.", { nonEmptyItems: true }),
      pathPrefix: stringParameter("Limit results to bundle relative paths beginning with this prefix."),
      relationType: nonEmptyStringParameter("Limit results to concepts with an outgoing relation of this type."),
      frontmatter: objectParameter("Exact frontmatter filters; array fields use contains matching."),
      linkedTo: nonEmptyStringParameter("Require an outgoing edge to this concept URI."),
      linkedFrom: nonEmptyStringParameter("Require an incoming edge from this concept URI."),
      orphanOnly: booleanParameter("Return only concepts without incoming or outgoing resolved edges."),
      statuses: stringArrayParameter("Limit results to lifecycle statuses.", { nonEmptyItems: true }),
      trustTiers: stringArrayParameter("Limit results to unverified, machine-confirmed, or human-reviewed trust tiers.", { nonEmptyItems: true }),
      freshness: stringArrayParameter("Limit results to unspecified, fresh, stale, or invalid freshness states.", { nonEmptyItems: true }),
      asOf: nonEmptyStringParameter("UTC ISO date or datetime used for deterministic freshness evaluation."),
      hasSources: optionalBooleanParameter("Require concepts to have or not have normalized sources."),
      runtime: nonEmptyStringParameter("Limit results to this Attested Computation runtime."),
      attestationReady: optionalBooleanParameter("Require static Attested Computation readiness."),
      generatedBy: nonEmptyStringParameter("Limit results to this generator actor."),
      verifiedBy: nonEmptyStringParameter("Limit results to concepts verified by this actor."),
      detail: detailParameter("Compact returns only URI, title, type, and description; full includes ranking, navigation metadata, and signals."),
      limit: integerParameter("Maximum number of concepts to return.", 1, 250, 25),
      offset: integerParameter("Number of matching concepts to skip before returning results.", 0, undefined, 0),
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
  list_edge_kinds: defineTool(
    "Count standard semantic and extension edge kinds in the current graph.",
    READ_ONLY,
  ),
  get_provenance: defineTool(
    "Trace normalized source provenance through internal concepts without fetching external resources.",
    READ_ONLY,
    {
      uri: nonEmptyStringParameter("Canonical or compatibility OKF URI of the root concept."),
      maxDepth: integerParameter("Maximum internal source depth.", 0, 10, 3),
      maxNodes: integerParameter("Maximum provenance nodes.", 1, 1000, 100),
      includeExternal: booleanParameter("Include URL and opaque provenance leaves without fetching them."),
    },
    ["uri"],
  ),
  inspect_attested_computation: defineTool(
    "Statically inspect an Attested Computation contract and indexed inert artifacts; never execute it.",
    READ_ONLY,
    {
      uri: nonEmptyStringParameter("Canonical or compatibility URI of the Attested Computation."),
      asOf: nonEmptyStringParameter("UTC ISO date or datetime for freshness evaluation."),
      includeComputation: booleanParameter("Include bounded inline or text computation content."),
      maxContentBytes: integerParameter("Maximum computation bytes to include.", 1, 1048576, 65536),
    },
    ["uri"],
  ),
  read_bundle_asset: defineTool(
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
  read_git_source: defineTool(
    "Read one pinned sources[].git entry from an explicitly mapped checkout or bare repository without fetching.",
    READ_ONLY,
    {
      concept: nonEmptyStringParameter("Concept ID, Markdown path, custom ID, or compatibility URI declaring the source."),
      sourceId: nonEmptyStringParameter("Exact sources[].id value to read."),
      maxContentBytes: integerParameter("Maximum Git blob bytes to read.", 1, 1048576, 65536),
    },
    ["concept", "sourceId"],
  ),
  prepare_attested_computation: defineTool(
    "Check declared parameters and produce non-executing digests without echoing parameter values.",
    READ_ONLY,
    {
      uri: nonEmptyStringParameter("Canonical or compatibility URI of the Attested Computation."),
      parameters: objectParameter("Parameter values keyed only by declared names."),
      asOf: nonEmptyStringParameter("UTC ISO date or datetime for freshness evaluation."),
    },
    ["uri", "parameters"],
  ),
  check_computation_receipt: defineTool(
    "Check receipt field presence only; never attest, echo values, or persist the receipt.",
    READ_ONLY,
    {
      uri: nonEmptyStringParameter("Canonical or compatibility URI of the Attested Computation."),
      receipt: objectParameter("Ephemeral receipt object; only its field names are returned."),
    },
    ["uri", "receipt"],
  ),
  check_v02_migration: defineTool(
    "Analyze a local or remote bundle for safe staged OKF v0.2 migration without creating proposals or writes.",
    READ_ONLY,
    {
      bundle: nonEmptyStringParameter("Bundle id to analyze; optional when exactly one root is loaded."),
      actorMappings: objectParameter("Mappings keyed by URI, path, or $default; each value requires by plus confirmed: true."),
      generatedPaths: stringArrayParameter("Paths generated elsewhere and therefore skipped from direct proposals.", { nonEmptyItems: true }),
    },
    [],
  ),
  load_remote_bundle: defineTool(
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
  list_remote_bundles: defineTool(
    "List metadata for remote bundles currently loaded into the server.",
    READ_ONLY,
  ),
  okf_validate_concept: defineTool(
    "Validate a proposed new OKF concept without writing a proposal or concept file.",
    READ_ONLY,
    {
      bundle: nonEmptyStringParameter("Writable root id; optional when exactly one local root is configured."),
      path: nonEmptyStringParameter("Safe bundle relative Markdown path for the concept."),
      frontmatter: objectParameter("Complete YAML frontmatter represented as a JSON object."),
      body: stringParameter("Markdown body for the concept."),
    },
    ["path", "frontmatter"],
  ),
  okf_suggest_concept_path: defineTool(
    "Suggest a safe bundle relative Markdown path from a concept type and title.",
    READ_ONLY,
    {
      bundle: nonEmptyStringParameter("Writable root id; optional when exactly one local root is configured."),
      type: nonEmptyStringParameter("Concept type used to build the path."),
      title: nonEmptyStringParameter("Concept title used to build the file name."),
      prefix: stringParameter("Optional bundle relative directory prefix."),
    },
    ["type", "title"],
  ),
  okf_propose_concept: defineTool(
    "Create a reviewable proposal for a new OKF concept without writing the concept file.",
    LOCAL_WRITE,
    {
      bundle: nonEmptyStringParameter("Writable root id; optional when exactly one local root is configured."),
      path: nonEmptyStringParameter("Safe bundle relative Markdown path for the new concept."),
      frontmatter: objectParameter("Complete YAML frontmatter represented as a JSON object."),
      body: stringParameter("Markdown body for the new concept."),
      message: stringParameter("Optional review note explaining why the concept should be created."),
    },
    ["path", "frontmatter"],
  ),
  okf_propose_update: defineTool(
    "Create a reviewable update proposal for an existing OKF concept while preserving unspecified content.",
    LOCAL_WRITE,
    {
      uri: nonEmptyStringParameter("Canonical or path based okf URI of the existing concept."),
      frontmatter: objectParameter(
        "Frontmatter fields to add or replace; unspecified fields are preserved.",
        { minProperties: 1 },
      ),
      removeFrontmatterKeys: stringArrayParameter("Frontmatter keys to remove; the id field cannot be removed.", { minItems: 1, nonEmptyItems: true }),
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
  okf_propose_attested_computation: defineTool(
    "Create one coordinated review proposal for an Attested Computation concept and optional external computation file; never execute it.",
    LOCAL_WRITE,
    {
      bundle: nonEmptyStringParameter("Writable root id; optional when exactly one local root is configured."),
      path: nonEmptyStringParameter("Safe bundle-relative Markdown path for the computation concept."),
      frontmatter: objectParameter("Complete strict OKF v0.2 Attested Computation frontmatter."),
      body: stringParameter("Markdown body, including inline computation when no computation file is declared."),
      computationPath: nonEmptyStringParameter("Bundle-relative path of the optional external computation file."),
      computationContent: stringParameter("Text content for the optional external computation file."),
      message: stringParameter("Optional review note."),
    },
    ["path", "frontmatter"],
  ),
  okf_propose_v02_migration: defineTool(
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
  okf_list_proposals: defineTool(
    "List compact metadata for stored authoring proposals.",
    READ_ONLY,
    {
      bundle: nonEmptyStringParameter("Limit results to proposals for this bundle id."),
      status: stringParameter("Limit results to this proposal status.", { enum: ["proposed", "accepted", "rejected"] }),
    },
  ),
  okf_get_proposal: defineTool(
    "Read one authoring proposal, including its candidate content and validation result.",
    READ_ONLY,
    {
      proposalId: nonEmptyStringParameter("Identifier returned when the proposal was created."),
    },
    ["proposalId"],
  ),
  okf_accept_proposal: defineTool(
    "Accept a reviewed proposal and write its new or updated concept file after revalidation.",
    DESTRUCTIVE_WRITE,
    {
      proposalId: nonEmptyStringParameter("Identifier of the proposed change to accept."),
    },
    ["proposalId"],
  ),
  okf_reject_proposal: defineTool(
    "Reject a reviewed proposal so it can no longer be accepted.",
    DESTRUCTIVE_WRITE,
    {
      proposalId: nonEmptyStringParameter("Identifier of the proposed change to reject."),
      reason: stringParameter("Optional explanation recorded with the rejection."),
    },
    ["proposalId"],
  ),
  okf_validate_changes: defineTool(
    "Validate a complete structured concept create or update batch without changing files.",
    READ_ONLY,
    LIVE_CHANGE_TOOL_PROPERTIES,
    ["changes"],
    undefined,
    LIVE_VALIDATE_OUTPUT,
  ),
  okf_apply_changes: defineTool(
    "Validate and apply one or more structured concept creates or updates to one local bundle as one batch.",
    DESTRUCTIVE_WRITE,
    LIVE_CHANGE_TOOL_PROPERTIES,
    ["changes"],
    undefined,
    LIVE_APPLY_OUTPUT,
  ),
  okf_list_producers: defineTool(
    "List configured producer instances without loading or executing their packages.",
    READ_ONLY,
  ),
  okf_preview_producer: defineTool(
    "Read source metadata, generate a candidate OKF 0.2 bundle, and validate its publication diff without writing files.",
    PRODUCER_PREVIEW,
    {
      producer: nonEmptyStringParameter("Configured producer instance name."),
      detail: detailParameter("Receipt detail level; full includes bounded bundle-relative changed paths."),
    },
    ["producer"],
  ),
  okf_run_producer: defineTool(
    "Regenerate, strictly validate, safely publish, and reindex one configured OKF producer.",
    PRODUCER_RUN,
    {
      producer: nonEmptyStringParameter("Configured producer instance name."),
      detail: detailParameter("Receipt detail level; full includes bounded bundle-relative changed paths."),
    },
    ["producer"],
  ),
  get_graph: defineTool(
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
  get_neighbors: defineTool(
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
  get_subgraph: defineTool(
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
  find_paths: defineTool(
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
  graph_summary: defineTool(
    "Summarize bundle, concept, edge, type, tag, and graph health counts.",
    READ_ONLY,
  ),
  validate_bundle: defineTool(
    "Report OKF conformance separately from project validity for one bundle or the full current index.",
    READ_ONLY,
    {
      bundle: nonEmptyStringParameter("Optional bundle id to validate in isolation."),
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
      format: stringParameter("Output format for the graph.", { enum: ["json", "dot", "mermaid"], default: "json" }),
      includeExternal: booleanParameter("Include opaque external relation targets in the export."),
      includeAssets: booleanParameter("Include explicitly referenced bundle assets in the export."),
      edgeKinds: stringArrayParameter("Limit exported edges to these edge kinds.", { nonEmptyItems: true }),
      maxNodes: integerParameter("Maximum number of graph nodes to export.", 1, 1000, 100),
      maxEdges: integerParameter("Maximum number of graph edges to export.", 1, 5000, 300),
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
  "okf_propose_v02_migration",
]);
const COMPUTATION_AUTHORING_TOOL_NAMES = new Set([
  "okf_propose_attested_computation",
]);
const LIVE_WRITE_TOOL_NAMES = new Set([
  "okf_validate_changes",
  "okf_apply_changes",
]);
const RUNTIME_REMOTE_TOOL_NAMES = new Set([
  "load_remote_bundle",
]);
const PRODUCER_TOOL_NAMES = new Set([
  "okf_list_producers",
  "okf_preview_producer",
]);
const PRODUCER_WRITE_TOOL_NAMES = new Set([
  "okf_run_producer",
]);

function jsonContent(value, options) {
  const result = {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
  if (options && options.structured) {
    result.structuredContent = value;
  }
  if (options && options.isError) {
    result.isError = true;
  }
  return result;
}

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


function toolEnabled(state, name) {
  if (PRODUCER_TOOL_NAMES.has(name)) {
    return Boolean(state && state.producerService);
  }
  if (PRODUCER_WRITE_TOOL_NAMES.has(name)) {
    return Boolean(state && state.producerService && state.allowWrite && state.actor);
  }
  if (PROJECT_HELPER_TOOL_NAMES.has(name)) {
    return Boolean(state && state.authoringService);
  }
  if (AUTHORING_MUTATION_TOOL_NAMES.has(name)) {
    return Boolean(state && state.authoringService && state.allowAuthoring);
  }
  if (COMPUTATION_AUTHORING_TOOL_NAMES.has(name)) {
    return Boolean(
      state
      && state.authoringService
      && state.allowAuthoring
      && state.allowComputationAuthoring,
    );
  }
  if (LIVE_WRITE_TOOL_NAMES.has(name)) {
    return Boolean(state && state.allowWrite && state.liveAuthoringService);
  }
  if (RUNTIME_REMOTE_TOOL_NAMES.has(name)) {
    return Boolean(state && state.allowRuntimeRemoteLoad);
  }
  return true;
}

function listResources(index) {
  return {
    resources: index.documents.map((doc) => ({
      uri: canonicalResourceUri(doc.uri),
      name: doc.title,
      description: doc.description || `${doc.kind} ${doc.path}`,
      mimeType: "text/markdown",
    })),
  };
}

function canonicalResourceUri(uri) {
  try {
    return new URL(uri).href;
  } catch {
    return uri;
  }
}

function publicBundles(index, options) {
  return index.bundles.map((bundle) => {
    const documentCount = index.documents.filter((doc) => doc.bundle === bundle.id).length;
    const conceptCount = index.concepts.filter((doc) => doc.bundle === bundle.id).length;
    const assetCount = (index.assets || []).filter((asset) => asset.bundle === bundle.id).length;
    if (bundle.remote) {
      return {
        id: bundle.id,
        remote: true,
        provider: bundle.remoteSource && bundle.remoteSource.provider,
        url: bundle.remoteSource && bundle.remoteSource.url,
        ref: bundle.remoteSource && bundle.remoteSource.ref,
        path: bundle.remoteSource && bundle.remoteSource.path,
        fileCount: bundle.remoteSource && bundle.remoteSource.fileCount,
        documentCount,
        conceptCount,
        assetCount,
        okfVersion: bundle.okfVersion || null,
        versionStatus: bundle.versionStatus,
        revision: bundle.remoteSource && (bundle.remoteSource.commitSha || bundle.remoteSource.ref),
        include: bundle.include || [],
        exclude: bundle.exclude || [],
      };
    }
    const absoluteRoot = path.resolve(bundle.root);
    const projectRoot = index.project && index.project.root
      ? path.resolve(index.project.root)
      : null;
    const root = projectRoot
      ? path.relative(projectRoot, absoluteRoot).replace(/\\/g, "/") || "."
      : "<configured>";
    return {
      id: bundle.id,
      root,
      ...((options && options.includeAbsolutePaths) ? { absoluteRoot, projectRoot } : {}),
      documentCount,
      conceptCount,
      assetCount,
      okfVersion: bundle.okfVersion || null,
      versionStatus: bundle.versionStatus,
      include: bundle.include || [],
      exclude: bundle.exclude || [],
    };
  });
}

function readResource(index, uri) {
  const doc = index.byUri.get(uri)
    || index.documents.find((candidate) => canonicalResourceUri(candidate.uri) === uri);
  if (!doc) {
    throw new ResourceNotFoundError(uri);
  }
  return {
    contents: [
      {
        uri: canonicalResourceUri(doc.uri),
        mimeType: "text/markdown",
        text: doc.text,
      },
    ],
  };
}

function listConcepts(index, args) {
  const options = Object.assign({ detail: "compact" }, args || {});
  if (options.type && !options.types) {
    options.types = [options.type];
  }
  if (options.tag && !options.tagsAny) {
    options.tagsAny = [options.tag];
  }
  return searchConcepts(index, options);
}

function conceptLocator(args) {
  return args && (args.id || args.uri)
    ? (args.id || args.uri)
    : args && args.bundle && args.path
      ? `okf://${args.bundle}/${args.path}`
      : null;
}

function getConcept(index, args, repositoryMappings) {
  const locator = conceptLocator(args);
  const doc = resolveConcept(index, locator);
  if (!doc) {
    const recovery = recoverConceptLocator(index, locator, {
      bundle: args && args.bundle,
      limit: 5,
    });
    throw new ToolExecutionError(
      `Unknown OKF concept URI or ID: ${locator || "<missing>"}`,
      recovery.status === "ambiguous" ? "concept_locator_ambiguous" : "concept_not_found",
      { recovery },
    );
  }
  if (!doc.valid || doc.reserved) {
    throw new ToolExecutionError(`Locator is not a valid OKF concept: ${locator}`);
  }
  return Object.assign(conceptSummary(doc), {
    frontmatter: doc.frontmatter,
    body: doc.body,
    links: doc.links,
    signals: conceptSignals(doc, true),
    referencedAssets: (index.assets || []).filter((asset) => (
      (asset.referencedBy || []).some((reference) => reference.uri === doc.uri)
    )).map((asset) => ({
      uri: asset.uri,
      bundle: asset.bundle,
      path: asset.path,
      mimeType: asset.mimeType,
      size: asset.size,
      sha256: asset.sha256,
      roles: asset.roles,
    })),
    gitSources: describeConceptGitSources(index, doc, repositoryMappings),
  });
}

function conceptIndexIsStale(index, args) {
  const doc = resolveConcept(index, conceptLocator(args));
  if (!doc) return true;
  const bundle = (index.bundles || []).find((entry) => entry.id === doc.bundle);
  if (!bundle || bundle.remote) return false;
  try {
    return !fs.lstatSync(doc.absolutePath).isFile();
  } catch (_error) {
    return true;
  }
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

function listEdgeKinds(index) {
  const counts = {};
  index.edges.forEach((edge) => {
    if (!counts[edge.kind]) {
      counts[edge.kind] = { total: 0, resolved: 0, broken: 0 };
    }
    counts[edge.kind].total += 1;
    counts[edge.kind][edge.broken ? "broken" : "resolved"] += 1;
  });
  return counts;
}

function requireAuthoring(state) {
  if (!state.authoringService) {
    throw new Error("OKF authoring is not configured. Start the server with --root or --project to enable writable concept proposals.");
  }
  return state.authoringService;
}

function requireLiveAuthoring(state) {
  if (!state.allowWrite || !state.liveAuthoringService) {
    throw new Error("Live OKF authoring is not configured. Start the server with --write and --actor.");
  }
  return state.liveAuthoringService;
}

function rebuildStateIndex(state) {
  const index = buildIndex(
    state.localBundleArgs.concat(state.remoteBundles),
    {
      relationTypes: state.relationTypes,
      strictLinks: state.strictLinks,
      allowCustomRelationTypes: state.allowCustomRelationTypes,
    },
  );
  state.index = state.project ? attachProject(index, state.project) : index;
  return state.index;
}

async function expectedToolOperation(operation, options) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      throw error;
    }
    const programmingError = error instanceof ReferenceError
      || error instanceof SyntaxError
      || error instanceof RangeError
      || (error instanceof TypeError && !(options && options.translateTypeError));
    if (programmingError) {
      throw error;
    }
    throw new ToolExecutionError(
      error && error.message ? error.message : String(error),
      error && error.code,
      error && error.details,
    );
  }
}

function requireGraphConcept(index, uri) {
  const doc = resolveConcept(index, uri);
  if (!doc || !doc.valid || doc.reserved) {
    throw new ToolExecutionError(`Unknown valid OKF concept: ${uri || "<missing>"}`);
  }
  return doc;
}

async function callTool(state, name, args) {
  const index = state.index;
  try {
    switch (name) {
      case "list_bundles":
        return jsonContent(publicBundles(index, {
          includeAbsolutePaths: Boolean(state.allowWrite),
        }));
      case "list_concepts":
        return jsonContent(listConcepts(index, args));
      case "get_concept":
        if (conceptIndexIsStale(index, args)) rebuildStateIndex(state);
        return jsonContent(getConcept(state.index, args, state.repositoryMappings));
      case "search_concepts":
        return jsonContent(await expectedToolOperation(
          () => searchConcepts(index, Object.assign({ detail: "compact" }, args)),
          { translateTypeError: true },
        ));
      case "list_types":
        return jsonContent(listTypes(index));
      case "list_tags":
        return jsonContent(listTags(index));
      case "list_relation_types":
        return jsonContent(listRelationTypes(index));
      case "list_edge_kinds":
        return jsonContent(listEdgeKinds(index));
      case "get_provenance":
        return jsonContent(await expectedToolOperation(
          () => getProvenance(index, args.uri, args),
          { translateTypeError: true },
        ));
      case "inspect_attested_computation":
        return jsonContent(await expectedToolOperation(
          () => inspectAttestedComputation(index, args.uri, args),
          { translateTypeError: true },
        ));
      case "read_bundle_asset":
        return jsonContent(await expectedToolOperation(
          () => readBundleAsset(index, args),
          { translateTypeError: true },
        ));
      case "read_git_source":
        return jsonContent(await expectedToolOperation(
          () => readConceptGitSource(
            index,
            args.concept,
            args.sourceId,
            state.repositoryMappings,
            { maxBytes: args.maxContentBytes || 65536 },
          ),
          { translateTypeError: true },
        ));
      case "prepare_attested_computation":
        return jsonContent(await expectedToolOperation(
          () => prepareAttestedComputation(index, args.uri, args.parameters, args),
          { translateTypeError: true },
        ));
      case "check_computation_receipt":
        return jsonContent(await expectedToolOperation(
          () => checkComputationReceipt(index, args.uri, args.receipt),
          { translateTypeError: true },
        ));
      case "check_v02_migration": {
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
      }
      case "list_remote_bundles":
        return jsonContent(state.remoteBundles.map((bundle) => Object.assign({ id: bundle.id }, bundle.remoteSource)));
      case "load_remote_bundle": {
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
        rebuildStateIndex(state);
        return jsonContent(remoteBundle.remoteSource);
      }
      case "okf_validate_concept":
        return jsonContent(await expectedToolOperation(
          () => requireAuthoring(state).validateConcept(args),
        ));
      case "okf_suggest_concept_path":
        return jsonContent(await expectedToolOperation(
          () => requireAuthoring(state).suggestConceptPath(args),
        ));
      case "okf_propose_concept": {
        const result = await expectedToolOperation(
          () => requireAuthoring(state).proposeConcept(args),
        );
        return jsonContent(result, { isError: result.created === false });
      }
      case "okf_propose_update": {
        const result = await expectedToolOperation(
          () => requireAuthoring(state).proposeUpdate(args),
        );
        return jsonContent(result, { isError: result.created === false });
      }
      case "okf_propose_attested_computation": {
        const result = await expectedToolOperation(
          () => requireAuthoring(state).proposeAttestedComputation(args),
        );
        return jsonContent(result, { isError: result.created === false });
      }
      case "okf_propose_v02_migration": {
        const result = await expectedToolOperation(
          () => requireAuthoring(state).proposeV02Migration(args),
        );
        return jsonContent(result, { isError: result.created === false });
      }
      case "okf_list_proposals":
        return jsonContent(await expectedToolOperation(
          () => requireAuthoring(state).listProposals(args),
        ));
      case "okf_get_proposal":
        return jsonContent(await expectedToolOperation(
          () => requireAuthoring(state).getProposal(args),
        ));
      case "okf_accept_proposal": {
        const result = await expectedToolOperation(
          () => requireAuthoring(state).acceptProposal(Object.assign({}, args, {
            allowComputation: state.allowComputationAuthoring,
          })),
        );
        if (result.accepted) {
          rebuildStateIndex(state);
        }
        return jsonContent(result, { isError: result.accepted === false });
      }
      case "okf_reject_proposal":
        return jsonContent(await expectedToolOperation(
          () => requireAuthoring(state).rejectProposal(args),
        ));
      case "okf_validate_changes": {
        const request = liveRequest(args);
        const result = await expectedToolOperation(
          () => requireLiveAuthoring(state).validateChanges(request.input, {
            additionalBundles: state.remoteBundles,
          }),
          { translateTypeError: true },
        );
        if (result.applied || result.filesChanged) {
          rebuildStateIndex(state);
        }
        return jsonContent(projectLiveReceipt(result, request.detail), { structured: true });
      }
      case "okf_apply_changes": {
        const request = liveRequest(args);
        const result = await expectedToolOperation(
          () => requireLiveAuthoring(state).applyChanges(request.input, {
            additionalBundles: state.remoteBundles,
          }),
          { translateTypeError: true },
        );
        if (result.applied || result.filesChanged) {
          rebuildStateIndex(state);
        }
        return jsonContent(projectLiveReceipt(result, request.detail), {
          structured: true,
          isError: result.applied === false,
        });
      }
      case "okf_list_producers":
        return jsonContent(state.producerService.list(), { structured: true });
      case "okf_preview_producer": {
        const result = await expectedToolOperation(
          () => state.producerService.preview(args.producer, {
            additionalBundles: state.remoteBundles,
          }),
          { translateTypeError: true },
        );
        return jsonContent(producerReceipt(result, args.detail || "compact"), { structured: true });
      }
      case "okf_run_producer": {
        const result = await expectedToolOperation(
          () => state.producerService.run(args.producer, {
            additionalBundles: state.remoteBundles,
          }),
          { translateTypeError: true },
        );
        if (result.applied) rebuildStateIndex(state);
        return jsonContent(producerReceipt(result, args.detail || "compact"), {
          structured: true,
          isError: result.applied === false,
        });
      }
      case "get_graph":
        return jsonContent(getGraph(index, args));
      case "get_neighbors":
        requireGraphConcept(index, args.uri);
        return jsonContent(getNeighbors(index, args.uri, args));
      case "get_subgraph": {
        const seeds = args.seeds || [args.uri];
        seeds.forEach((uri) => requireGraphConcept(index, uri));
        return jsonContent(getSubgraph(index, args));
      }
      case "find_paths":
        requireGraphConcept(index, args.source);
        requireGraphConcept(index, args.target);
        return jsonContent(findPaths(index, args.source, args.target, args.maxPaths, args));
      case "graph_summary":
        return jsonContent(graphSummary(index));
      case "validate_bundle":
        if (args.bundle && !index.bundles.some((bundle) => bundle.id === args.bundle)) {
          throw new ToolExecutionError(`Unknown OKF bundle: ${args.bundle}`);
        }
        return jsonContent(validateIndex(index, args.bundle));
      case "validate_project":
        return jsonContent(validateIndex(index));
      case "export_graph":
        return {
          content: [
            {
              type: "text",
              text: exportGraph(index, args),
            },
          ],
        };
      default:
        throw new Error(`Unknown registered MCP tool: ${name}`);
    }
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
  const relationTypes = (options && options.relationTypes)
    || (project && project.relationTypes);
  const allowCustomRelationTypes = Boolean(
    (options && options.allowCustomRelationTypes)
    || (project && project.rootMode),
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
  };
  if (!state.producerService && project && (project.producers || []).length
    && authoringService && authoringService.store) {
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
    const store = options.authoringStore || FileConceptStore.fromProject(options.projectPath, { proposalRoot: options.proposalRoot });
    const authoringService = options.authoringService || new ConceptAuthoringService(store);
    const liveAuthoringService = options.liveAuthoringService || (options.allowWrite
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
    });
  }
  if (options && options.rootPath) {
    const store = options.authoringStore || FileConceptStore.fromRoot(options.rootPath, {
      proposalRoot: options.proposalRoot,
      strictLinks: options.strictLinks,
    });
    const authoringService = options.authoringService || new ConceptAuthoringService(store);
    const liveAuthoringService = options.liveAuthoringService || (options.allowWrite
      ? new LiveAuthoringService(store, { actor: options.actor, gitCommit: options.gitCommit })
      : null);
    const localBundleArgs = store.getBundles();
    const remoteBundles = await fetchRemoteBundles(options.remoteBundles || []);
    const initialIndex = attachProject(buildIndex(localBundleArgs.concat(remoteBundles), {
      relationTypes: store.getRelationTypes(),
      strictLinks: options.strictLinks,
      allowCustomRelationTypes: true,
    }), store.project);
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
    });
  }
  const remoteBundles = await fetchRemoteBundles((options && options.remoteBundles) || []);
  const localBundleArgs = (bundleArgs || []).slice();
  const liveAuthoringService = options && options.liveAuthoringService
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
  });
}

function registerMcpInterface(state) {
  const server = new McpServer({
    name: "okf-mcp",
    version: packageMetadata.version,
  }, {
    capabilities: {
      resources: { listChanged: false },
      tools: { listChanged: false },
    },
  });
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
  TOOL_NAMES.filter((name) => toolEnabled(state, name)).forEach((name) => {
    const definition = TOOL_DEFINITIONS[name];
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
            return jsonContent({
              error: "Internal tool error",
              tool: name,
            }, { isError: true });
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
  return serveStdio(
    () => registerMcpInterface(state),
    { legacy: "serve", transport },
  );
}

module.exports = {
  createMcpServer,
  runStdioServer,
};
