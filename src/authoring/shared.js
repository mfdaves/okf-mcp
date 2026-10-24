"use strict";

const crypto = require("node:crypto");

const MAX_EFFECT_ITEMS = 20;
const MAX_EFFECT_TEXT = 240;

class AuthoringPolicyError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "AuthoringPolicyError";
    if (code) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

class AuthoringOperationalError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthoringOperationalError";
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function commandOutput(result) {
  return String((result && (result.stderr || result.stdout)) || "").trim().slice(0, 4000);
}

function commandFailure(result, fallback) {
  return commandOutput(result)
    || (result && result.error && result.error.message)
    || fallback;
}

function commandSucceeded(result) {
  return Boolean(result && !result.error && result.status === 0);
}

function revisionFor(text) {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function byteLength(text) {
  return Buffer.byteLength(String(text || ""), "utf8");
}

function sortedUnique(values) {
  return Array.from(new Set(values)).sort();
}

module.exports = {
  AuthoringOperationalError,
  AuthoringPolicyError,
  MAX_EFFECT_ITEMS,
  MAX_EFFECT_TEXT,
  byteLength,
  commandFailure,
  commandOutput,
  commandSucceeded,
  hasOwn,
  isPlainObject,
  revisionFor,
  sortedUnique,
};
