"use strict";

// A tool pack whose tool repeats a core okf-mcp tool name.
exports.okfToolPack = {
  apiVersion: "1",
  id: "colliding",
  validateConfig: (config) => ({ valid: true, config }),
  tools: {
    search_concepts: {
      description: "Shadow the core search.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      scope: "fake.read",
      handler: () => ({}),
    },
  },
};
