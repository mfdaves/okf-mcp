"use strict";

const { proposalServiceFor } = require("../authoring/proposal-policy");
const { canWrite, principalWriteContext } = require("./principal");

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
    items: Object.assign({ type: "string" }, config.nonEmptyItems ? { minLength: 1 } : {}),
    ...(config.minItems === undefined ? {} : { minItems: config.minItems }),
  };
}

function objectParameter(description, extra) {
  return Object.assign(
    {
      type: "object",
      description,
      additionalProperties: true,
    },
    extra || {},
  );
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

function defineTool(description, annotations, properties, required, schemaExtras, outputSchema) {
  return {
    description,
    annotations,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: properties || {},
      ...(required?.length ? { required } : {}),
      ...(schemaExtras || {}),
    },
    ...(outputSchema ? { outputSchema } : {}),
  };
}

// Availability gates. A tool names one as its `enabled` predicate; tools/list
// advertises, and a call reaches, only the tools whose gate passes for the
// running server state and the principal the call runs for (plan I-2a).
const GATES = {
  always: () => true,
  // Listing and previewing producers run them with the server's own source
  // credentials (an administrator key, for instance). Over stdio the
  // process's one principal does so as before; over HTTP it needs okf.write.
  producer: (state, principal) =>
    Boolean(state?.producerService && (state.transport !== "http" || canWrite(principal))),
  producerWrite: (state, principal) =>
    Boolean(state?.producerService && state.allowWrite && state.actor && canWrite(principal)),
  projectHelper: (state) => Boolean(state?.authoringService),
  // Stored proposals can hold complete candidate Markdown, which the REST
  // authoring API guards with its write token. Over stdio the process's one
  // principal reads them as before; over HTTP the principal needs okf.write.
  proposalRead: (state, principal) =>
    Boolean(state?.authoringService && (state.transport !== "http" || canWrite(principal))),
  authoringMutation: (state) => Boolean(state?.authoringService && state.allowAuthoring),
  computationAuthoring: (state) =>
    Boolean(state?.authoringService && state.allowAuthoring && state.allowComputationAuthoring),
  liveWrite: (state, principal) =>
    Boolean(state?.allowWrite && state.liveAuthoringService && canWrite(principal)),
  // A runtime remote load changes the index every principal of the process
  // reads. Over stdio the process has one principal, so --allow-remote-tool
  // is enough; over HTTP the principal must also hold okf.write.
  runtimeRemote: (state, principal) =>
    Boolean(state?.allowRuntimeRemoteLoad && (state.transport !== "http" || canWrite(principal))),
};

function toolEnabled(tool, state, principal) {
  return (tool.enabled || GATES.always)(state, principal);
}

// Advertised tools/list order. It predates the split into area modules and is
// kept verbatim so clients that cache the listing see the same sequence;
// composition fails fast when a module and this list disagree.
const TOOL_ORDER = [
  "list_bundles",
  "list_concepts",
  "get_concept",
  "search_concepts",
  "get_context",
  "list_types",
  "list_tags",
  "list_relation_types",
  "list_edge_kinds",
  "get_provenance",
  "inspect_attested_computation",
  "read_bundle_asset",
  "read_git_source",
  "prepare_attested_computation",
  "check_computation_receipt",
  "check_v02_migration",
  "load_remote_bundle",
  "list_remote_bundles",
  "okf_validate_concept",
  "okf_suggest_concept_path",
  "okf_propose_concept",
  "okf_propose_update",
  "okf_propose_attested_computation",
  "okf_propose_v02_migration",
  "okf_list_proposals",
  "okf_get_proposal",
  "okf_accept_proposal",
  "okf_reject_proposal",
  "okf_validate_changes",
  "okf_apply_changes",
  "okf_list_producers",
  "okf_preview_producer",
  "okf_run_producer",
  "get_graph",
  "get_neighbors",
  "get_subgraph",
  "find_paths",
  "graph_summary",
  "validate_bundle",
  "validate_project",
  "export_graph",
  // Gated on a configured embedder (WP3c); appended so existing positions hold.
  "embedding_status",
];

function composeRegistry(modules) {
  const tools = {};
  modules.forEach((module) => {
    Object.keys(module.tools).forEach((name) => {
      if (tools[name]) {
        throw new Error(`Duplicate MCP tool definition: ${name}`);
      }
      if (typeof module.tools[name].handler !== "function") {
        throw new Error(`MCP tool ${name} has no handler.`);
      }
      tools[name] = module.tools[name];
    });
  });
  const missing = TOOL_ORDER.filter((name) => !tools[name]);
  const unlisted = Object.keys(tools).filter((name) => !TOOL_ORDER.includes(name));
  if (missing.length || unlisted.length) {
    throw new Error(
      `MCP tool registry mismatch: missing ${missing.join(", ") || "none"}; ` +
        `unlisted ${unlisted.join(", ") || "none"}`,
    );
  }
  return { names: TOOL_ORDER.slice(), tools };
}

function jsonContent(value, options) {
  const result = {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
  if (options?.structured) {
    result.structuredContent = value;
  }
  if (options?.isError) {
    result.isError = true;
  }
  return result;
}

async function expectedToolOperation(operation, options) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      throw error;
    }
    const programmingError =
      error instanceof ReferenceError ||
      error instanceof SyntaxError ||
      error instanceof RangeError ||
      (error instanceof TypeError && !options?.translateTypeError);
    if (programmingError) {
      throw error;
    }
    throw new ToolExecutionError(
      error?.message ? error.message : String(error),
      error?.code,
      error?.details,
    );
  }
}

// The proposal service a call uses: the configured one, acting for the
// principal's actor (proposedBy and policy verdicts name it).
function requireAuthoring(state, principal) {
  if (!state.authoringService) {
    throw new Error(
      "OKF authoring is not configured. Start the server with --root or --project to enable writable concept proposals.",
    );
  }
  return proposalServiceFor(state.authoringService, principal?.actor);
}

// The context a live write hands the authoring service: the server's remote
// snapshots plus the principal's actor and git author.
function writeContext(state, principal) {
  return Object.assign(
    { additionalBundles: state.remoteBundles },
    principalWriteContext(principal),
  );
}

module.exports = {
  DESTRUCTIVE_WRITE,
  GATES,
  LOCAL_WRITE,
  PRODUCER_PREVIEW,
  PRODUCER_RUN,
  READ_ONLY,
  REMOTE_LOAD,
  TOOL_ORDER,
  ToolExecutionError,
  booleanParameter,
  collectionPatchParameter,
  composeRegistry,
  defineTool,
  detailParameter,
  expectedToolOperation,
  integerParameter,
  jsonContent,
  nonEmptyStringParameter,
  objectParameter,
  optionalBooleanParameter,
  relationParameter,
  requireAuthoring,
  sourceParameter,
  stringArrayParameter,
  stringParameter,
  toolEnabled,
  writeContext,
};
