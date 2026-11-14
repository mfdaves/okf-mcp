"use strict";

// A tool pack for okf-mcp's tests (plan D1): tool-pack API v1.
const crypto = require("node:crypto");

// What the handlers saw, for tests running the server in the same process.
const events = [];

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function schema(properties, required) {
  return { type: "object", properties, required: required || [], additionalProperties: false };
}

exports.events = events;
exports.okfToolPack = {
  apiVersion: "1",
  id: "fake",
  validateConfig(config) {
    if (!config || typeof config.label !== "string") {
      return { valid: false, diagnostics: [{ code: "missing_label" }] };
    }
    return { valid: true, config: { label: config.label.toUpperCase(), keyEnv: config.keyEnv } };
  },
  tools: {
    fake_echo: {
      description: "Echo the text back with the caller's identity.",
      annotations,
      inputSchema: schema(
        {
          text: { type: "string", maxLength: 50 },
          pair: {
            type: "array",
            prefixItems: [{ type: "string" }, { type: "integer" }],
            minItems: 2,
            maxItems: 2,
          },
        },
        ["text"],
      ),
      outputSchema: {
        type: "object",
        properties: { text: { type: "string" }, label: { type: "string" } },
        required: ["text"],
      },
      scope: "fake.read",
      handler(args, ctx) {
        return {
          text: args.text,
          label: ctx.config.label,
          actor: ctx.principal.actor,
          scopes: ctx.principal.scopes,
          hasSubjectToken: typeof ctx.subjectToken === "string",
          subjectTokenSha256: ctx.subjectToken
            ? crypto.createHash("sha256").update(ctx.subjectToken).digest("hex")
            : null,
          secretLength: ctx.getSecret(ctx.config.keyEnv).length,
        };
      },
    },
    fake_fail: {
      description: "Fail in the requested way.",
      annotations,
      inputSchema: schema(
        {
          mode: {
            type: "string",
            enum: ["coded", "plain", "badcode", "secret", "throwstring", "long"],
          },
        },
        ["mode"],
      ),
      scope: "fake.read",
      handler(args, ctx) {
        if (args.mode === "secret") return ctx.getSecret("HOME");
        if (args.mode === "throwstring") throw `raw ${ctx.subjectToken}`;
        const error = new Error(`Catalog text of the north region ${ctx.subjectToken}`);
        if (args.mode === "coded") {
          error.code = "access_denied";
          error.details = {
            section: "crons",
            count: 2,
            token: ctx.subjectToken || "none",
            secret: ctx.getSecret(ctx.config.keyEnv),
            nested: { a: 1 },
          };
        }
        if (args.mode === "badcode") error.code = "Access Denied";
        if (args.mode === "long") {
          error.code = "query_error";
          error.details = { short: "a".repeat(499), exact: "b".repeat(500), long: "c".repeat(501) };
        }
        throw error;
      },
    },
    fake_slow: {
      description: "Wait, unless the call is aborted.",
      annotations,
      inputSchema: schema({ ms: { type: "integer", minimum: 1 } }, ["ms"]),
      scope: "fake.read",
      handler(args, ctx) {
        events.push("start");
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ done: true }), args.ms);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            events.push("aborted");
            resolve({ aborted: true });
          });
        });
      },
    },
    fake_admin: {
      description: "A tool for a narrower scope.",
      annotations,
      inputSchema: schema({}),
      scope: "fake.admin",
      handler() {
        return { ok: true };
      },
    },
    fake_whoami: {
      description: "Act for the signed-in caller.",
      annotations,
      inputSchema: schema({}),
      scope: "okf.read",
      requiresSubjectToken: true,
      handler(args, ctx) {
        return { subject: ctx.principal.subject, hasSubjectToken: Boolean(ctx.subjectToken) };
      },
    },
  },
};
