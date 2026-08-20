"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const { attachProject, buildIndex } = require("./indexer");
const { splitFrontmatter } = require("./parser");
const {
  ProducerPublicationError,
  ProducerPublisher,
  normalizeProducedFiles,
} = require("./producer-publisher");

const MAX_PRODUCER_FILES = 10000;
const MAX_PRODUCER_BYTES = 64 * 1024 * 1024;
const UNSAFE_CONFIG_KEYS = new Set([
  "catalogfile",
  "catalogpath",
  "connection",
  "connectionstring",
  "connectionuri",
  "connectionurl",
  "credentials",
  "credential",
  "databaseuri",
  "databaseurl",
  "dsn",
  "dryrun",
  "output",
  "outputdir",
  "outputpath",
  "query",
  "password",
  "secret",
  "sql",
  "token",
]);

class ProducerHostError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "ProducerHostError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function publicDiagnostic(entry) {
  const source = entry || {};
  const rawCode = typeof source.code === "string" ? source.code : "";
  const rawField = typeof source.field === "string" ? source.field : "";
  return Object.fromEntries([
    ["code", /^[a-z][a-z0-9_]{0,63}$/.test(rawCode) ? rawCode : "producer_invalid"],
    ["severity", source.severity || "error"],
    ["layer", source.layer || "producer"],
    ["path", source.path],
    ["field", /^[A-Za-z0-9_.[\]-]{1,128}$/.test(rawField) ? rawField : undefined],
  ].filter(([, value]) => value !== undefined));
}

function diagnostic(code, extra) {
  return publicDiagnostic(Object.assign({ code, severity: "error", layer: "producer" }, extra || {}));
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function loadInstalledProducer(project, packageName) {
  let resolved;
  try {
    resolved = createRequire(project.path).resolve(packageName);
  } catch {
    throw new ProducerHostError("The configured producer package is not installed in the project.", "producer_package_not_installed");
  }
  if (!path.isAbsolute(resolved)) {
    throw new ProducerHostError("The configured producer package must resolve to an installed npm package.", "invalid_producer_package");
  }
  const modulesRoot = path.join(fs.realpathSync(project.root), "node_modules");
  let realResolved;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    throw new ProducerHostError("The configured producer package could not be resolved safely.", "invalid_producer_package");
  }
  if (!isInside(modulesRoot, realResolved)) {
    throw new ProducerHostError("The configured producer package must be installed under the project node_modules directory.", "invalid_producer_package");
  }
  return require(realResolved);
}

function inspectConfig(value, envNames, pathParts) {
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (UNSAFE_CONFIG_KEYS.has(normalized)) {
      throw new ProducerHostError("Producer config contains a host-controlled or unsafe field.", "unsafe_producer_config", { field: pathParts.concat(key).join(".") });
    }
    if (/env$/i.test(key)) {
      if (typeof child !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(child)) {
        throw new ProducerHostError("Producer secret references must be valid environment variable names.", "invalid_producer_secret_reference", { field: pathParts.concat(key).join(".") });
      }
      envNames.add(child);
    }
    if (child && typeof child === "object") inspectConfig(child, envNames, pathParts.concat(key));
  });
}

function validateDescriptor(instance, moduleValue, allowedRelationTypes) {
  const descriptor = moduleValue && moduleValue.okfProducer;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new ProducerHostError("Producer package must export okfProducer.", "invalid_producer_descriptor");
  }
  if (String(descriptor.apiVersion || "") !== "1"
    || String(descriptor.okfVersion || "") !== "0.2"
    || descriptor.id !== instance.type
    || typeof descriptor.version !== "string" || !descriptor.version.trim()
    || typeof descriptor.validateConfig !== "function"
    || typeof descriptor.generate !== "function") {
    throw new ProducerHostError("Producer descriptor is incompatible with this host.", "incompatible_producer_descriptor");
  }
  const relationTypes = Array.isArray(descriptor.relationTypes) ? descriptor.relationTypes.map(String) : [];
  if (relationTypes.some((type) => !allowedRelationTypes.has(type))) {
    throw new ProducerHostError("Producer declares a relation type that the project does not allow.", "producer_relation_type_not_allowed");
  }
  return descriptor;
}

function buildCandidate(project, bundles, remoteBundles, files, stalePaths) {
  const overrides = new Map();
  files.forEach((file) => overrides.set(`${file.bundle}\u0000${file.path}`, file.content));
  const deletions = new Set(stalePaths.map((entry) => `${entry.bundle}\u0000${entry.path}`));
  return attachProject(buildIndex(bundles.concat(remoteBundles || []), {
    relationTypes: project.relationTypes,
    strictLinks: project.strictLinks,
    documentOverrides: overrides,
    documentDeletions: deletions,
  }), project);
}

function validateCandidate(index, instance, outputPaths) {
  const diagnostics = [];
  const bundle = index.bundles.find((entry) => entry.id === instance.bundle);
  if (!bundle || bundle.okfVersion !== "0.2") {
    diagnostics.push(diagnostic("producer_bundle_requires_okf_0_2", { path: "index.md" }));
  }
  const root = index.documents.find((doc) => doc.bundle === instance.bundle && doc.path === "index.md");
  if (!root) {
    diagnostics.push(diagnostic("producer_missing_root_index", { path: "index.md" }));
  } else {
    try {
      const split = splitFrontmatter(root.text);
      if (!split.frontmatter
        || Object.keys(split.frontmatter).length !== 1
        || split.frontmatter.okf_version !== "0.2") {
        diagnostics.push(diagnostic("producer_invalid_root_index", { path: "index.md" }));
      }
    } catch {
      diagnostics.push(diagnostic("producer_invalid_root_index", { path: "index.md" }));
    }
  }
  const documents = new Map(index.documents
    .filter((doc) => doc.bundle === instance.bundle)
    .map((doc) => [doc.path, doc]));
  outputPaths.forEach((relativePath) => {
    const doc = documents.get(relativePath);
    if (!doc) {
      diagnostics.push(diagnostic("producer_document_not_indexed", { path: relativePath }));
      return;
    }
    if (doc.reserved) return;
    const frontmatter = doc.frontmatter || {};
    for (const field of ["type", "title", "description"]) {
      if (typeof frontmatter[field] !== "string" || !frontmatter[field].trim()) {
        diagnostics.push(diagnostic(`producer_missing_${field}`, { path: relativePath, field }));
      }
    }
    if (doc.signals.generatedOrigin !== "native"
      || !doc.signals.generated || doc.signals.generated.valid !== true) {
      diagnostics.push(diagnostic("producer_invalid_generated", { path: relativePath, field: "generated" }));
    }
    if (doc.signals.sourcesOrigin !== "native"
      || !Array.isArray(doc.signals.sources) || doc.signals.sources.length === 0
      || doc.signals.sources.some((source) => source.valid !== true)) {
      diagnostics.push(diagnostic("producer_invalid_sources", { path: relativePath, field: "sources" }));
    }
    (doc.v02Diagnostics || []).forEach((entry) => diagnostics.push(publicDiagnostic(entry)));
  });
  const generatedPaths = new Set(outputPaths);
  (index.errors || []).filter((entry) => (
    entry.bundle === instance.bundle
    && generatedPaths.has(entry.path)
    && ["broken_relation", "missing_relation_target", "parse_error"].includes(entry.code)
  )).forEach((entry) => diagnostics.push(publicDiagnostic(entry)));
  (index.warnings || []).filter((entry) => (
    entry.bundle === instance.bundle
    && generatedPaths.has(entry.path)
    && ["broken_link", "link_outside_root", "broken_semantic_reference"].includes(entry.code)
  )).forEach((entry) => diagnostics.push(publicDiagnostic(entry)));
  const projectValidation = index.validation || require("./validation").validateIndex(index);
  if (!index.conformant || !index.validForProject) {
    projectValidation.diagnostics.forEach((entry) => diagnostics.push(publicDiagnostic(entry)));
  }
  const unique = new Map();
  diagnostics.forEach((entry) => unique.set(JSON.stringify(entry), entry));
  return {
    valid: index.conformant === true && index.validForProject === true && unique.size === 0,
    conformant: index.conformant === true,
    validForProject: index.validForProject === true,
    diagnostics: Array.from(unique.values()),
  };
}

function countsFor(changes) {
  return Object.fromEntries(Object.entries(changes).map(([key, values]) => [key, values.length]));
}

function normalizeSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProducerHostError("Producer generate() must return a numeric summary.", "invalid_producer_summary");
  }
  const entries = Object.entries(value);
  if (entries.length > 50 || entries.some(([key, count]) => (
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)
    || !Number.isSafeInteger(count)
    || count < 0
  ))) {
    throw new ProducerHostError("Producer summary entries must be bounded non-negative integers.", "invalid_producer_summary");
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

class ProducerService {
  constructor(options) {
    const config = options || {};
    this.project = config.project;
    this.store = config.store;
    this.loader = config.loader || loadInstalledProducer;
    this.env = config.env || process.env;
    this.now = config.now || (() => new Date());
    this.publisher = config.publisher || new ProducerPublisher(this.project, this.store);
    this.bundles = config.bundles || this.project.bundles.filter((bundle) => !bundle.remote);
  }

  list() {
    return (this.project.producers || []).map((producer) => ({
      name: producer.name,
      type: producer.type,
      package: producer.package,
      bundle: producer.bundle,
    }));
  }

  getInstance(name) {
    const instance = (this.project.producers || []).find((entry) => entry.name === name);
    if (!instance) throw new ProducerHostError("Unknown configured producer.", "producer_not_found");
    if ((this.project.errors || []).some((entry) => String(entry.code || "").includes("producer"))) {
      throw new ProducerHostError("Project producer configuration is invalid.", "invalid_producer_configuration");
    }
    return instance;
  }

  async prepare(name, options) {
    const instance = this.getInstance(name);
    let descriptor;
    try {
      descriptor = validateDescriptor(
        instance,
        await this.loader(this.project, instance.package),
        new Set(this.project.relationTypes || []),
      );
    } catch (error) {
      if (error instanceof ProducerHostError) throw error;
      throw new ProducerHostError("The configured producer package could not be loaded.", "producer_load_failed");
    }
    const envNames = new Set();
    inspectConfig(instance.config, envNames, ["config"]);
    let configValidation;
    try {
      configValidation = await descriptor.validateConfig(structuredClone(instance.config));
    } catch {
      throw new ProducerHostError("Producer configuration validation failed unexpectedly.", "producer_config_validation_failed");
    }
    if (!configValidation || configValidation.valid !== true) {
      const entries = Array.isArray(configValidation && configValidation.diagnostics)
        ? configValidation.diagnostics.slice(0, 100).map((entry) => diagnostic(
          typeof entry.code === "string" ? entry.code : "producer_config_invalid",
          typeof entry.field === "string" ? { field: entry.field } : undefined,
        ))
        : [diagnostic("producer_config_invalid")];
      return { instance, descriptor, valid: false, readyToApply: false, diagnostics: entries };
    }
    const normalizedConfig = configValidation.config === undefined
      ? structuredClone(instance.config)
      : configValidation.config;
    const accessedSecrets = [];
    const getSecret = (secretName) => {
      if (!envNames.has(secretName)) {
        throw new ProducerHostError("Producer requested a secret not referenced by its configuration.", "producer_secret_not_allowed");
      }
      const value = this.env[secretName];
      if (typeof value !== "string" || value.length === 0) {
        throw new ProducerHostError("A configured producer secret is unavailable.", "producer_secret_unavailable");
      }
      accessedSecrets.push(value);
      return value;
    };
    let generated;
    const generatedAt = this.now().toISOString();
    try {
      generated = await descriptor.generate({
        bundleId: instance.bundle,
        config: structuredClone(normalizedConfig),
        generatedAt,
        getSecret,
        signal: options && options.signal || new AbortController().signal,
      });
    } catch (error) {
      if (error instanceof ProducerHostError) throw error;
      throw new ProducerHostError("Producer execution failed.", "producer_execution_failed");
    }
    let files;
    let summary;
    try {
      files = normalizeProducedFiles(generated && generated.files);
      summary = normalizeSummary(generated && generated.summary);
    } catch (error) {
      if (error instanceof ProducerPublicationError || error instanceof ProducerHostError) {
        return { instance, descriptor, valid: false, readyToApply: false, diagnostics: [publicDiagnostic(error)] };
      }
      throw error;
    }
    if (files.length > MAX_PRODUCER_FILES
      || files.reduce((total, file) => total + Buffer.byteLength(file.content), 0) > MAX_PRODUCER_BYTES) {
      return { instance, descriptor, valid: false, readyToApply: false, diagnostics: [diagnostic("producer_output_too_large")] };
    }
    if (accessedSecrets.some((secret) => files.some((file) => secret && file.content.includes(secret)))) {
      return { instance, descriptor, valid: false, readyToApply: false, diagnostics: [diagnostic("producer_secret_leak")] };
    }
    let inspection;
    try {
      inspection = this.publisher.inspect(Object.assign({}, instance, { version: descriptor.version }), files);
    } catch (error) {
      if (error instanceof ProducerPublicationError) {
        return { instance, descriptor, files, valid: false, readyToApply: false, diagnostics: [publicDiagnostic(error)] };
      }
      throw new ProducerHostError("Producer publication preflight failed.", "producer_publication_preflight_failed");
    }
    const candidateFiles = files.map((file) => Object.assign({ bundle: instance.bundle }, file));
    const stalePaths = inspection.changes.delete.map((relativePath) => ({ bundle: instance.bundle, path: relativePath }));
    const candidate = buildCandidate(
      this.project,
      this.bundles,
      options && options.additionalBundles || [],
      candidateFiles,
      stalePaths,
    );
    const validation = validateCandidate(candidate, instance, files.map((file) => file.path));
    return {
      instance,
      descriptor,
      files,
      changes: inspection.changes,
      counts: countsFor(inspection.changes),
      valid: validation.valid,
      readyToApply: validation.valid,
      conformant: validation.conformant,
      validForProject: validation.validForProject,
      diagnostics: validation.diagnostics,
      summary,
      generatedAt,
    };
  }

  async preview(name, options) {
    return this.prepare(name, options);
  }

  async run(name, options) {
    return this.store.withWriteLock(async () => {
      const prepared = await this.prepare(name, options);
      if (!prepared.readyToApply) return Object.assign({}, prepared, { applied: false });
      const producer = Object.assign({}, prepared.instance, { version: prepared.descriptor.version });
      let changes;
      try {
        changes = await this.publisher.publish(producer, prepared.files, async () => {
          const persisted = buildCandidate(
            this.project,
            this.bundles,
            options && options.additionalBundles || [],
            [],
            [],
          );
          const validation = validateCandidate(persisted, prepared.instance, prepared.files.map((file) => file.path));
          if (!validation.valid) {
            throw new ProducerHostError("Persisted producer output failed validation.", "persisted_producer_validation_failed");
          }
        });
      } catch (error) {
        if (error instanceof ProducerPublicationError) {
          return Object.assign({}, prepared, {
            applied: false,
            diagnostics: prepared.diagnostics.concat(publicDiagnostic(error)),
          });
        }
        if (error instanceof ProducerHostError) throw error;
        throw new ProducerHostError("Producer publication failed.", "producer_publication_failed");
      }
      return Object.assign({}, prepared, {
        changes,
        counts: countsFor(changes),
        applied: true,
      });
    });
  }
}

module.exports = {
  MAX_PRODUCER_BYTES,
  MAX_PRODUCER_FILES,
  ProducerHostError,
  ProducerService,
  buildCandidate,
  loadInstalledProducer,
  normalizeSummary,
  publicDiagnostic,
  validateCandidate,
  validateDescriptor,
};
