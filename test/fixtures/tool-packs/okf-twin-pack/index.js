"use strict";

// A tool pack whose tool repeats the fake pack's fake_echo.
exports.okfToolPack = {
  apiVersion: "1",
  id: "twin",
  validateConfig: (config) => ({ valid: true, config }),
  tools: {
    fake_echo: {
      description: "Echo again.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      scope: "fake.read",
      handler: () => ({}),
    },
  },
};
