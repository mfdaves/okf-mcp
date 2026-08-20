"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatterYaml, splitFrontmatter } = require("./parser");

const DEFAULT_RELATION_TYPES = [
  "depends_on",
  "produces",
  "consumes",
  "persists_to",
  "materializes_to",
  "configured_by",
  "checked_by",
  "owned_by",
  "supersedes",
  "related_to",
  "contains",
  "contained_by",
  "foreign_key_to",
];

function configId(value, fallback) {
  const raw = String(value || fallback || "").trim();
  return raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || fallback || "bundle";
}

function isInsidePath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeProjectPath(projectRoot, value, field) {
  const label = field || "project path";
  if (!value || path.isAbsolute(String(value))) {
    const error = new Error(`${label} must be a relative path inside the project root.`);
    error.code = "invalid_project_path";
    throw error;
  }
  const realRoot = fs.realpathSync(projectRoot);
  const resolved = path.resolve(realRoot, String(value));
  if (!isInsidePath(realRoot, resolved)) {
    const error = new Error(`${label} resolves outside the project root.`);
    error.code = "project_path_outside_root";
    throw error;
  }
  const relative = path.relative(realRoot, resolved);
  let current = realRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        break;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const error = new Error(`${label} cannot traverse a symbolic link inside the project root.`);
      error.code = "project_path_symlink";
      throw error;
    }
  }
  return resolved;
}

function resolveProjectPath(projectRoot, value, field, errors) {
  try {
    return safeProjectPath(projectRoot, value, field);
  } catch (error) {
    errors.push({
      code: error.code || "invalid_project_path",
      field,
      path: value || "",
      message: error.message,
    });
    return null;
  }
}

function findProjectConfig(startDir) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    const yamlPath = path.join(current, "okf.project.yaml");
    const jsonPath = path.join(current, "okf.project.json");
    if (fs.existsSync(yamlPath)) {
      return yamlPath;
    }
    if (fs.existsSync(jsonPath)) {
      return jsonPath;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findOkfRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    const indexPath = path.join(current, "index.md");
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      try {
        const split = splitFrontmatter(fs.readFileSync(indexPath, "utf8"));
        if (split.frontmatter
          && Object.prototype.hasOwnProperty.call(split.frontmatter, "okf_version")) {
          return current;
        }
      } catch {
        // Discovery is best effort; validation reports malformed root indexes.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function readConfigFile(configPath) {
  const absolutePath = path.resolve(configPath);
  const text = fs.readFileSync(absolutePath, "utf8");
  if (absolutePath.endsWith(".json")) {
    return JSON.parse(text);
  }
  return parseFrontmatterYaml(text);
}

function normalizeBundles(config, configPath, errors) {
  const rootDir = path.dirname(path.resolve(configPath));
  const bundles = Array.isArray(config.bundles) ? config.bundles : [];
  if (!bundles.length) {
    errors.push({ code: "missing_bundles", message: "Project config must define at least one bundle." });
  }
  const seen = new Set();
  return bundles.map((bundle, index) => {
    if (typeof bundle === "string") {
      const id = configId(path.basename(bundle), `bundle-${index + 1}`);
      if (seen.has(id)) {
        errors.push({ code: "duplicate_bundle_id", bundle: id, message: "Duplicate bundle id." });
      }
      seen.add(id);
      return {
        id,
        root: resolveProjectPath(rootDir, bundle, `bundles[${index}].root`, errors),
        include: [],
        exclude: [],
      };
    }
    const id = configId(bundle && bundle.id, `bundle-${index + 1}`);
    if (seen.has(id)) {
      errors.push({ code: "duplicate_bundle_id", bundle: id, message: "Duplicate bundle id." });
    }
    seen.add(id);
    return {
      id,
      root: resolveProjectPath(rootDir, (bundle && (bundle.root || bundle.path)) || ".", `bundles[${index}].root`, errors),
      include: Array.isArray(bundle.include) ? bundle.include : [],
      exclude: Array.isArray(bundle.exclude) ? bundle.exclude : [],
    };
  }).filter((bundle) => bundle.root);
}

function validateRelationTypes(config, errors) {
  if (config.relationTypes !== undefined && !Array.isArray(config.relationTypes)) {
    errors.push({ code: "invalid_relation_types", message: "relationTypes must be an array." });
    return;
  }
  (config.relationTypes || []).forEach((type) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(String(type))) {
      errors.push({ code: "invalid_relation_type_name", relationType: String(type), message: "Relation type names may contain only letters, numbers, underscores, dots, and hyphens." });
    }
  });
}

function validatePlugins(config, projectRoot, bundleIds, errors) {
  if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
    errors.push({ code: "invalid_plugins", message: "plugins must be an array." });
    return;
  }
  (config.plugins || []).forEach((plugin, index) => {
    const type = plugin && (plugin.type || plugin.name);
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
      errors.push({ code: "invalid_plugin", plugin: index, message: "Plugin entries must be objects." });
      return;
    }
    if (!["filesystem", "json-spec"].includes(String(type))) {
      errors.push({ code: "unknown_plugin_type", plugin: plugin.name || index, pluginType: type || "", message: "Unknown generator plugin type." });
    }
    if (!plugin.root) {
      errors.push({ code: "missing_plugin_root", plugin: plugin.name || index, message: "Plugin root is required." });
    } else {
      resolveProjectPath(projectRoot, plugin.root, `plugins[${index}].root`, errors);
    }
    if (!plugin.output) {
      errors.push({ code: "missing_plugin_output", plugin: plugin.name || index, message: "Plugin output is required." });
    } else {
      resolveProjectPath(projectRoot, plugin.output, `plugins[${index}].output`, errors);
    }
    if (plugin.bundle && !bundleIds.has(String(plugin.bundle))) {
      errors.push({ code: "unknown_plugin_bundle", plugin: plugin.name || index, bundle: String(plugin.bundle), message: "Plugin bundle does not exist in project bundles." });
    }
    if (plugin.destinationBundle && !bundleIds.has(String(plugin.destinationBundle))) {
      errors.push({ code: "unknown_plugin_destination_bundle", plugin: plugin.name || index, bundle: String(plugin.destinationBundle), message: "Plugin destinationBundle does not exist in project bundles." });
    }
  });
}

function barePackageName(value) {
  return typeof value === "string"
    && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value);
}

function normalizeProducers(config, localBundleIds, errors) {
  if (config.producers !== undefined && !Array.isArray(config.producers)) {
    errors.push({ code: "invalid_producers", message: "producers must be an array." });
    return [];
  }
  const names = new Set();
  const bundles = new Set();
  return (config.producers || []).map((producer, index) => {
    const field = `producers[${index}]`;
    if (!producer || typeof producer !== "object" || Array.isArray(producer)) {
      errors.push({ code: "invalid_producer", producer: index, message: "Producer entries must be objects." });
      return null;
    }
    const allowed = new Set(["name", "type", "package", "bundle", "config"]);
    Object.keys(producer).filter((key) => !allowed.has(key)).forEach((key) => {
      errors.push({ code: "unknown_producer_field", producer: producer.name || index, field: `${field}.${key}`, message: `Unknown producer field: ${key}` });
    });
    const name = typeof producer.name === "string" ? producer.name.trim() : "";
    const type = typeof producer.type === "string" ? producer.type.trim() : "";
    const packageName = typeof producer.package === "string" ? producer.package.trim() : "";
    const bundle = typeof producer.bundle === "string" ? producer.bundle.trim() : "";
    if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) {
      errors.push({ code: "invalid_producer_name", producer: index, field: `${field}.name`, message: "Producer name must contain only letters, numbers, underscores, dots, and hyphens." });
    } else if (names.has(name)) {
      errors.push({ code: "duplicate_producer_name", producer: name, message: "Producer names must be unique." });
    }
    if (name) names.add(name);
    if (!type || !/^[A-Za-z0-9_.-]+$/.test(type)) {
      errors.push({ code: "invalid_producer_type", producer: name || index, field: `${field}.type`, message: "Producer type must contain only letters, numbers, underscores, dots, and hyphens." });
    }
    if (!barePackageName(packageName)) {
      errors.push({ code: "invalid_producer_package", producer: name || index, field: `${field}.package`, message: "Producer package must be a bare npm package name without a subpath." });
    }
    if (!localBundleIds.has(bundle)) {
      errors.push({ code: "unknown_producer_bundle", producer: name || index, bundle, message: "Producer bundle must name a local project bundle." });
    } else if (bundles.has(bundle)) {
      errors.push({ code: "duplicate_producer_bundle", producer: name || index, bundle, message: "Only one producer may manage a local bundle." });
    }
    if (bundle) bundles.add(bundle);
    if (producer.config !== undefined && (!producer.config || typeof producer.config !== "object" || Array.isArray(producer.config))) {
      errors.push({ code: "invalid_producer_config", producer: name || index, field: `${field}.config`, message: "Producer config must be an object." });
    }
    return {
      name,
      type,
      package: packageName,
      bundle,
      config: producer.config && typeof producer.config === "object" && !Array.isArray(producer.config)
        ? producer.config
        : {},
    };
  }).filter(Boolean);
}

function normalizeRemoteBundles(config, errors) {
  const remotes = Array.isArray(config.remoteBundles) ? config.remoteBundles : [];
  if (config.remoteBundles !== undefined && !Array.isArray(config.remoteBundles)) {
    errors.push({ code: "invalid_remote_bundles", message: "remoteBundles must be an array." });
    return [];
  }
  const seen = new Set();
  return remotes.map((remote, index) => {
    const id = configId(remote && remote.id, `remote-${index + 1}`);
    if (seen.has(id)) {
      errors.push({ code: "duplicate_remote_bundle_id", bundle: id, message: "Duplicate remote bundle id." });
    }
    seen.add(id);
    const provider = String((remote && remote.provider) || "github");
    if (provider !== "github") {
      errors.push({ code: "unsupported_remote_provider", bundle: id, provider, message: "Only github remote bundles are supported." });
    }
    if (!remote || !remote.url) {
      errors.push({ code: "missing_remote_url", bundle: id, message: "Remote bundle url is required." });
    }
    return {
      id,
      provider,
      url: remote && remote.url ? String(remote.url) : "",
      include: Array.isArray(remote && remote.include) ? remote.include : [],
      exclude: Array.isArray(remote && remote.exclude) ? remote.exclude : [],
    };
  });
}

function loadProjectConfig(configPath) {
  const requestedPath = configPath
    ? path.resolve(configPath)
    : findProjectConfig(process.cwd());
  if (!requestedPath) {
    throw new Error("No okf.project.yaml or okf.project.json found. Pass --project or --bundle.");
  }
  const resolvedPath = fs.realpathSync(requestedPath);
  const rawConfig = readConfigFile(resolvedPath);
  const errors = [];
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    errors.push({ code: "invalid_project_config", message: "Project config must be an object." });
  }
  const config = (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) ? {} : rawConfig;
  validateRelationTypes(config, errors);
  if (config.strictLinks !== undefined && typeof config.strictLinks !== "boolean") {
    errors.push({ code: "invalid_strict_links", field: "strictLinks", message: "strictLinks must be a boolean." });
  }
  const relationTypes = new Set(DEFAULT_RELATION_TYPES.concat(Array.isArray(config.relationTypes) ? config.relationTypes.map(String) : []));
  const bundles = normalizeBundles(config, resolvedPath, errors);
  const remoteBundles = normalizeRemoteBundles(config, errors);
  const localBundleIds = new Set(bundles.map((bundle) => bundle.id));
  const allBundleIds = new Set(bundles.map((bundle) => bundle.id));
  remoteBundles.forEach((bundle) => {
    if (allBundleIds.has(bundle.id)) {
      errors.push({ code: "duplicate_bundle_id", bundle: bundle.id, message: "Remote bundle id duplicates a local bundle id." });
    }
    allBundleIds.add(bundle.id);
  });
  validatePlugins(config, path.dirname(resolvedPath), allBundleIds, errors);
  const producers = normalizeProducers(config, localBundleIds, errors);
  return {
    path: resolvedPath,
    root: path.dirname(resolvedPath),
    project: config.project || config.name || path.basename(path.dirname(resolvedPath)),
    bundles,
    remoteBundles,
    relationTypes: Array.from(relationTypes),
    plugins: Array.isArray(config.plugins) ? config.plugins : [],
    producers,
    strictLinks: Boolean(config.strictLinks),
    errors,
    raw: config,
  };
}

module.exports = {
  DEFAULT_RELATION_TYPES,
  findOkfRoot,
  findProjectConfig,
  isInsidePath,
  loadProjectConfig,
  resolveProjectPath,
  safeProjectPath,
};
