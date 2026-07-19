"use strict";

const CONFORMANCE_WARNING_CODES = new Set([
  "missing_frontmatter",
  "missing_type",
]);

const PROJECT_INVALID_WARNING_CODES = new Set([
  "broken_link",
  "invalid_id",
  "link_outside_root",
]);

function inBundle(entry, bundle) {
  return !bundle || (entry && entry.bundle === bundle);
}

function diagnosticKey(entry) {
  return [
    entry.layer || "",
    entry.code || "",
    entry.bundle || "",
    entry.path || "",
    entry.href || "",
    entry.target || "",
    entry.relationType || "",
    entry.message || "",
  ].join("\u0000");
}

function normalizeDiagnostic(entry, defaults) {
  return Object.assign({
    code: "validation_diagnostic",
    severity: "warning",
    layer: "project",
    message: "",
  }, defaults || {}, entry || {});
}

function validateIndex(index, bundle) {
  const source = index || {};
  const errors = (source.errors || []).filter((entry) => inBundle(entry, bundle));
  const warnings = (source.warnings || []).filter((entry) => inBundle(entry, bundle));
  const documents = (source.documents || []).filter((doc) => !bundle || doc.bundle === bundle);
  const diagnostics = [];
  const seen = new Set();

  function add(entry, defaults) {
    const diagnostic = normalizeDiagnostic(entry, defaults);
    const key = diagnosticKey(diagnostic);
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(diagnostic);
    }
  }

  documents.forEach((doc) => {
    (doc.conformanceDiagnostics || doc.diagnostics || []).forEach((entry) => {
      add(entry, {
        bundle: doc.bundle,
        path: doc.path,
        severity: "error",
        layer: "conformance",
        invalidatesProject: true,
      });
    });
  });

  errors.forEach((entry) => {
    const conformance = entry.code === "parse_error";
    add(entry, {
      severity: "error",
      layer: conformance ? "conformance" : "project",
      invalidatesProject: true,
    });
  });

  warnings.forEach((entry) => {
    if (CONFORMANCE_WARNING_CODES.has(entry.code)) {
      add(entry, {
        severity: "error",
        layer: "conformance",
        invalidatesProject: true,
      });
      return;
    }
    add(entry, {
      severity: "warning",
      layer: "project",
      invalidatesProject: PROJECT_INVALID_WARNING_CODES.has(entry.code),
    });
  });

  const conformanceErrors = diagnostics.filter((entry) => (
    entry.layer === "conformance" && entry.severity === "error"
  ));
  const projectDiagnostics = diagnostics.filter((entry) => entry.layer === "project");
  const conformant = conformanceErrors.length === 0;
  const validForProject = conformant
    && errors.length === 0
    && !diagnostics.some((entry) => entry.invalidatesProject);

  return {
    conformant,
    validForProject,
    valid: validForProject,
    diagnostics,
    conformanceErrors,
    projectDiagnostics,
    errors,
    warnings,
  };
}

module.exports = {
  validateIndex,
};
