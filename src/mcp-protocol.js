"use strict";

const ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  RESOURCE_NOT_FOUND: -32002,
});

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "additionalProperties",
  "anyOf",
  "default",
  "description",
  "enum",
  "items",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "properties",
  "required",
  "type",
]);

class ProtocolError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }
}

class ToolExecutionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidRequestId(value) {
  return value === null
    || typeof value === "string"
    || (typeof value === "number" && Number.isFinite(value));
}

function validateJsonRpcEnvelope(value) {
  if (!isPlainObject(value)) {
    throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, "Invalid Request", {
      detail: "JSON-RPC messages must be objects; batch messages are not supported.",
    });
  }
  if (value.jsonrpc !== "2.0") {
    throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, "Invalid Request", {
      detail: 'jsonrpc must be exactly "2.0".',
    });
  }
  if (typeof value.method !== "string" || !value.method.trim()) {
    throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, "Invalid Request", {
      detail: "method must be a non-empty string.",
    });
  }
  if (Object.prototype.hasOwnProperty.call(value, "id") && !isValidRequestId(value.id)) {
    throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, "Invalid Request", {
      detail: "id must be a string, finite number, or null.",
    });
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "params")
    && (value.params === null || typeof value.params !== "object")
  ) {
    throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, "Invalid Request", {
      detail: "params must be an object or array when supplied.",
    });
  }
  return {
    notification: !Object.prototype.hasOwnProperty.call(value, "id"),
    id: Object.prototype.hasOwnProperty.call(value, "id") ? value.id : null,
  };
}

function protocolError(error) {
  if (error instanceof ProtocolError) {
    return error;
  }
  return new ProtocolError(ERROR_CODES.INTERNAL_ERROR, "Internal error");
}

function responseFor(id, result, error) {
  if (error) {
    const normalized = protocolError(error);
    const response = {
      jsonrpc: "2.0",
      id,
      error: {
        code: normalized.code,
        message: normalized.message,
      },
    };
    if (normalized.data !== undefined) {
      response.error.data = normalized.data;
    }
    return response;
  }
  return { jsonrpc: "2.0", id, result };
}

function assertSupportedSchema(schema, path) {
  const location = path || "#";
  if (!isPlainObject(schema)) {
    throw new Error(`Tool schema at ${location} must be an object.`);
  }
  Object.keys(schema).forEach((keyword) => {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      throw new Error(`Unsupported tool schema keyword at ${location}: ${keyword}`);
    }
  });
  if (schema.type !== undefined && !["object", "string", "integer", "boolean", "array"].includes(schema.type)) {
    throw new Error(`Unsupported tool schema type at ${location}: ${schema.type}`);
  }
  if (
    schema.additionalProperties !== undefined
    && typeof schema.additionalProperties !== "boolean"
  ) {
    throw new Error(`Tool schema additionalProperties at ${location} must be boolean.`);
  }
  if (
    schema.required !== undefined
    && (
      !Array.isArray(schema.required)
      || schema.required.some((name) => typeof name !== "string" || !name)
    )
  ) {
    throw new Error(`Tool schema required at ${location} must be an array of non-empty strings.`);
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw new Error(`Tool schema enum at ${location} must be a non-empty array.`);
  }
  ["minimum", "maximum", "minLength", "minItems", "minProperties"].forEach((keyword) => {
    if (schema[keyword] !== undefined && (!Number.isFinite(schema[keyword]) || schema[keyword] < 0)) {
      throw new Error(`Tool schema ${keyword} at ${location} must be a non-negative finite number.`);
    }
  });
  ["minLength", "minItems", "minProperties"].forEach((keyword) => {
    if (schema[keyword] !== undefined && !Number.isInteger(schema[keyword])) {
      throw new Error(`Tool schema ${keyword} at ${location} must be an integer.`);
    }
  });
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      throw new Error(`Tool schema properties at ${location} must be an object.`);
    }
    Object.entries(schema.properties).forEach(([name, child]) => {
      assertSupportedSchema(child, `${location}/properties/${escapeJsonPointer(name)}`);
    });
  }
  if (schema.items !== undefined) {
    assertSupportedSchema(schema.items, `${location}/items`);
  }
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      throw new Error(`Tool schema anyOf at ${location} must be a non-empty array.`);
    }
    schema.anyOf.forEach((branch, index) => {
      assertSupportedSchema(branch, `${location}/anyOf/${index}`);
    });
  }
}

function escapeJsonPointer(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function childPath(path, name) {
  return `${path}/${escapeJsonPointer(name)}`;
}

function addIssue(issues, path, message) {
  issues.push({ path, message });
}

function matchesType(value, type) {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
    default:
      return typeof value === type;
  }
}

function validateSchemaValue(schema, value, path, issues) {
  if (schema.type && !matchesType(value, schema.type)) {
    addIssue(issues, path, `must be ${schema.type === "integer" ? "an integer" : `a ${schema.type}`}`);
    return;
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    addIssue(issues, path, `must be one of: ${schema.enum.map(String).join(", ")}`);
  }
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
    addIssue(issues, path, `must contain at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      addIssue(issues, path, `must be greater than or equal to ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      addIssue(issues, path, `must be less than or equal to ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      addIssue(issues, path, `must contain at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchemaValue(schema.items, item, childPath(path, index), issues));
    }
  }
  if (isPlainObject(value)) {
    const properties = schema.properties || {};
    (schema.required || []).forEach((name) => {
      if (!Object.prototype.hasOwnProperty.call(value, name)) {
        addIssue(issues, childPath(path, name), "is required");
      }
    });
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      addIssue(issues, path, `must contain at least ${schema.minProperties} propert${schema.minProperties === 1 ? "y" : "ies"}`);
    }
    Object.entries(value).forEach(([name, child]) => {
      if (Object.prototype.hasOwnProperty.call(properties, name)) {
        validateSchemaValue(properties[name], child, childPath(path, name), issues);
      } else if (schema.additionalProperties === false) {
        addIssue(issues, childPath(path, name), "is not allowed");
      }
    });
  }
  if (schema.anyOf) {
    const matched = schema.anyOf.some((branch) => {
      const branchIssues = [];
      validateSchemaValue(branch, value, path, branchIssues);
      return branchIssues.length === 0;
    });
    if (!matched) {
      addIssue(issues, path, "must match at least one allowed argument shape");
    }
  }
}

function validateToolArguments(schema, value) {
  assertSupportedSchema(schema);
  const issues = [];
  validateSchemaValue(schema, value, "", issues);
  return issues;
}

module.exports = {
  ERROR_CODES,
  ProtocolError,
  ToolExecutionError,
  assertSupportedSchema,
  isPlainObject,
  isValidRequestId,
  responseFor,
  validateJsonRpcEnvelope,
  validateToolArguments,
};
