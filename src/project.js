"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatterYaml } = require("./parser");

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
];

function configId(value, fallback) {
  const raw = String(value || fallback || "").trim();
  return raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || fallback || "bundle";
}

function isInsidePath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveProjectPath(projectRoot, value, field, errors) {
  if (!value || path.isAbsolute(String(value))) {
    errors.push({
      code: "invalid_project_path",
      field,
      path: value || "",
      message: `${field} must be a relative path inside the project root.`,
    });
    return null;
  }
  const resolved = path.resolve(projectRoot, value);
  if (!isInsidePath(projectRoot, resolved)) {
    errors.push({
      code: "project_path_outside_root",
      field,
      path: value,
      message: `${field} resolves outside the project root.`,
    });
    return null;
  }
  return resolved;
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
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : findProjectConfig(process.cwd());
  if (!resolvedPath) {
    throw new Error("No okf.project.yaml or okf.project.json found. Pass --project or --bundle.");
  }
  const rawConfig = readConfigFile(resolvedPath);
  const errors = [];
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    errors.push({ code: "invalid_project_config", message: "Project config must be an object." });
  }
  const config = (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) ? {} : rawConfig;
  validateRelationTypes(config, errors);
  const relationTypes = new Set(DEFAULT_RELATION_TYPES.concat(Array.isArray(config.relationTypes) ? config.relationTypes.map(String) : []));
  const bundles = normalizeBundles(config, resolvedPath, errors);
  const remoteBundles = normalizeRemoteBundles(config, errors);
  const allBundleIds = new Set(bundles.map((bundle) => bundle.id));
  remoteBundles.forEach((bundle) => {
    if (allBundleIds.has(bundle.id)) {
      errors.push({ code: "duplicate_bundle_id", bundle: bundle.id, message: "Remote bundle id duplicates a local bundle id." });
    }
    allBundleIds.add(bundle.id);
  });
  validatePlugins(config, path.dirname(resolvedPath), allBundleIds, errors);
  return {
    path: resolvedPath,
    root: path.dirname(resolvedPath),
    project: config.project || config.name || path.basename(path.dirname(resolvedPath)),
    bundles,
    remoteBundles,
    relationTypes: Array.from(relationTypes),
    plugins: Array.isArray(config.plugins) ? config.plugins : [],
    errors,
    raw: config,
  };
}

module.exports = {
  DEFAULT_RELATION_TYPES,
  findProjectConfig,
  isInsidePath,
  loadProjectConfig,
  resolveProjectPath,
};
