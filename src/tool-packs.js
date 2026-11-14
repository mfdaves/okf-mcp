"use strict";

// Tool packs (plan D1; experimental, outside the 1.0 freeze): npm packages
// that add read tools to the MCP server, loaded like producers. The trusted
// project config lists them as `toolPacks: [{ package, config, timeoutMs? }]`;
// each exact bare package name is resolved under the project's node_modules
// and must export
//
//   okfToolPack = { apiVersion: "1", id, validateConfig(config), tools,
//                   serialize? }
//   tools[name] = { description, annotations, inputSchema, outputSchema?,
//                   scope, requiresSubjectToken?, handler(args, ctx) }
//   ctx = { principal, subjectToken, config, getSecret, signal }
//
// Tool names match ^[a-z][a-z0-9_]{2,63}$ and may not repeat a core tool or
// another pack's tool; both are startup errors. Descriptions and schemas come
// from the package, never from config (B-6). A principal sees a pack tool
// when it holds okf.read and the tool's scope. A handler returns a JSON value;
// an error it throws reaches the caller only as a bounded code and scalar
// details (src/error-details.js), never its message. Calls are bounded by
// `timeoutMs` (default 30 s) and the request's abort signal. Pack tools are
// read tools: they run outside the knowledge call queue unless the pack sets
// `serialize: true`.

const { fromJsonSchema } = require("@modelcontextprotocol/server");

const { TOOL_PACK_DETAILS, boundedErrorDetails, publicErrorCode } = require("./error-details");
const { loadInstalledPackage } = require("./producers");

const TOOL_NAME = /^[a-z][a-z0-9_]{2,63}$/;
const SCOPE = /^[a-z][a-z0-9_.:-]{0,63}$/;
const MAX_DESCRIPTION_CHARS = 4096;
const MAX_RESULT_BYTES = 1024 * 1024;
// Config keys that would hold a secret inline; secrets are named by `*Env`
// keys and read with ctx.getSecret instead.
const INLINE_SECRET_KEYS = new Set([
  "apikey",
  "credential",
  "credentials",
  "password",
  "secret",
  "token",
]);

class ToolPackError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "ToolPackError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// The environment variable names the config may read through getSecret:
// the string values of keys ending in "Env". Inline secret keys are refused.
function secretNames(config, field, names) {
  for (const [key, value] of Object.entries(config || {})) {
    const at = `${field}.${key}`;
    if (INLINE_SECRET_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      throw new ToolPackError(
        "Tool pack config holds a secret inline.",
        "unsafe_tool_pack_config",
        {
          field: at,
        },
      );
    }
    if (/env$/i.test(key)) {
      if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new ToolPackError(
          "Tool pack secret references must be environment variable names.",
          "invalid_tool_pack_secret_reference",
          { field: at },
        );
      }
      names.add(value);
    } else if (value && typeof value === "object") {
      secretNames(value, at, names);
    }
  }
  return names;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The descriptor's tools, checked, in the order the package declares them.
function packTools(packageName, descriptor) {
  const incompatible = (tool) =>
    new ToolPackError(
      "Tool pack descriptor is incompatible with this host.",
      "incompatible_tool_pack",
      {
        package: packageName,
        ...(tool ? { tool } : {}),
      },
    );
  if (
    !plainObject(descriptor) ||
    descriptor.apiVersion !== "1" ||
    typeof descriptor.id !== "string" ||
    !TOOL_NAME.test(descriptor.id) ||
    typeof descriptor.validateConfig !== "function" ||
    !plainObject(descriptor.tools) ||
    (descriptor.serialize !== undefined && typeof descriptor.serialize !== "boolean")
  ) {
    throw incompatible();
  }
  return Object.entries(descriptor.tools).map(([name, tool]) => {
    if (!TOOL_NAME.test(name)) throw incompatible(name.slice(0, 64));
    const valid =
      plainObject(tool) &&
      typeof tool.description === "string" &&
      tool.description.trim().length > 0 &&
      tool.description.length <= MAX_DESCRIPTION_CHARS &&
      plainObject(tool.annotations) &&
      plainObject(tool.inputSchema) &&
      tool.inputSchema.type === "object" &&
      (tool.outputSchema === undefined ||
        (plainObject(tool.outputSchema) && tool.outputSchema.type === "object")) &&
      typeof tool.scope === "string" &&
      SCOPE.test(tool.scope) &&
      (tool.requiresSubjectToken === undefined || typeof tool.requiresSubjectToken === "boolean") &&
      typeof tool.handler === "function";
    if (!valid) throw incompatible(name);
    try {
      fromJsonSchema(tool.inputSchema);
      if (tool.outputSchema) fromJsonSchema(tool.outputSchema);
    } catch {
      throw incompatible(name);
    }
    // Copies taken now: nothing the package or its config does later changes
    // what is advertised.
    return Object.freeze({
      name,
      description: tool.description,
      annotations: structuredClone(tool.annotations),
      inputSchema: structuredClone(tool.inputSchema),
      outputSchema: tool.outputSchema ? structuredClone(tool.outputSchema) : undefined,
      scope: tool.scope,
      requiresSubjectToken: tool.requiresSubjectToken === true,
      handler: tool.handler,
    });
  });
}

// Loads every configured tool pack, or throws a ToolPackError naming the
// package and tool involved. `coreNames` are the core tool names; `loader`
// and `env` stand in for the installed-package loader and process.env.
async function loadToolPacks(project, options) {
  const config = options || {};
  const entries = project?.toolPacks || [];
  if (!entries.length) return [];
  const problems = (project.errors || []).filter((entry) => /tool_pack/.test(entry.code));
  if (problems.length) {
    throw new ToolPackError("The project's toolPacks configuration is invalid.", problems[0].code, {
      field: problems[0].field,
    });
  }
  const loader = config.loader || ((proj, name) => loadInstalledPackage(proj, name, "tool pack"));
  const env = config.env || process.env;
  const taken = new Set(config.coreNames || []);
  const packs = [];
  for (const entry of entries) {
    let moduleValue;
    try {
      moduleValue = await loader(project, entry.package);
    } catch (error) {
      throw new ToolPackError(
        "The configured tool pack package could not be loaded.",
        /^(invalid_tool_pack_package|tool_pack_package_not_installed)$/.test(error?.code)
          ? error.code
          : "tool_pack_load_failed",
        { package: entry.package },
      );
    }
    const descriptor = moduleValue?.okfToolPack;
    const tools = packTools(entry.package, descriptor);
    for (const tool of tools) {
      if (taken.has(tool.name)) {
        throw new ToolPackError(
          "A tool pack tool repeats an existing tool name.",
          "tool_pack_name_collision",
          {
            package: entry.package,
            tool: tool.name,
          },
        );
      }
      taken.add(tool.name);
    }
    const names = secretNames(entry.config, "config", new Set());
    let validation;
    try {
      validation = await descriptor.validateConfig(structuredClone(entry.config));
    } catch {
      validation = null;
    }
    if (validation?.valid !== true) {
      throw new ToolPackError(
        "The tool pack refused its configuration.",
        "invalid_tool_pack_config",
        {
          package: entry.package,
        },
      );
    }
    const packConfig = validation.config === undefined ? entry.config : validation.config;
    const secrets = new Set();
    packs.push({
      id: descriptor.id,
      package: entry.package,
      serialize: descriptor.serialize === true,
      timeoutMs: entry.timeoutMs,
      config: packConfig,
      tools,
      secrets,
      getSecret(name) {
        if (!names.has(name)) {
          throw new ToolPackError(
            "The tool pack asked for a secret its config does not name.",
            "tool_pack_secret_not_allowed",
          );
        }
        const value = env[name];
        if (typeof value !== "string" || !value) {
          throw new ToolPackError(
            "A configured tool pack secret is unavailable.",
            "tool_pack_secret_unavailable",
          );
        }
        secrets.add(value);
        return value;
      },
    });
  }
  return packs;
}

// Every scope a client may need: okf.read and okf.write, then the scopes
// the pack tools declare, in config and declaration order, each once. It is
// what an HTTP server advertises, so that a client signing in asks for them.
function advertisedScopes(packs) {
  return [
    ...new Set(
      ["okf.read", "okf.write"].concat(
        (packs || []).flatMap((pack) => pack.tools.map((tool) => tool.scope)),
      ),
    ),
  ];
}

// The scopes the pack tools declare beyond okf.*, which the stdio
// principal, the process's own operator, holds.
function toolPackScopes(packs) {
  return [...new Set((packs || []).flatMap((pack) => pack.tools.map((tool) => tool.scope)))].filter(
    (scope) => !scope.startsWith("okf."),
  );
}

function failure(name, code, details) {
  const value = {
    error: "Tool execution failed",
    tool: name,
    message: "The tool pack could not complete the call.",
    code,
    ...(details ? { details } : {}),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError: true,
  };
}

// Runs one pack tool for a principal and returns the MCP tool result.
// `options`: subjectToken (HTTP only) and the request's abort signal.
async function callPackTool(pack, tool, args, principal, options) {
  const config = options || {};
  const timeout = new AbortController();
  const signals = [timeout.signal, config.signal].filter(Boolean);
  const signal = AbortSignal.any(signals);
  const timer = setTimeout(
    () => timeout.abort(new ToolPackError("Tool pack call timed out.", "tool_pack_timeout")),
    pack.timeoutMs,
  );
  const ctx = Object.freeze({
    principal: Object.freeze({
      subject: principal.subject,
      actor: principal.actor,
      scopes: [...principal.scopes],
      ...(principal.name ? { name: principal.name } : {}),
      ...(principal.email ? { email: principal.email } : {}),
    }),
    subjectToken: config.subjectToken,
    config: structuredClone(pack.config),
    getSecret: pack.getSecret,
    signal,
  });
  const hidden = [config.subjectToken, ...pack.secrets].filter(Boolean);
  try {
    const stopped = new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const value = await Promise.race([
      Promise.resolve().then(() => tool.handler(args, ctx)),
      stopped,
    ]);
    const text = JSON.stringify(value === undefined ? null : value, null, 2);
    if (Buffer.byteLength(text) > MAX_RESULT_BYTES) {
      return failure(tool.name, "tool_pack_result_too_large");
    }
    return {
      content: [{ type: "text", text }],
      ...(tool.outputSchema ? { structuredContent: JSON.parse(text) } : {}),
    };
  } catch (error) {
    if (timeout.signal.aborted) return failure(tool.name, "tool_pack_timeout");
    if (config.signal?.aborted) return failure(tool.name, "tool_pack_cancelled");
    const code = publicErrorCode(error);
    if (!code) return failure(tool.name, "tool_pack_execution_failed");
    return failure(
      tool.name,
      code,
      boundedErrorDetails(error, [...hidden, ...pack.secrets], TOOL_PACK_DETAILS),
    );
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  ToolPackError,
  advertisedScopes,
  callPackTool,
  loadToolPacks,
  toolPackScopes,
};
