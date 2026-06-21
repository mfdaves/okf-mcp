"use strict";

const fs = require("fs");
const path = require("path");
const { isInsidePath } = require("./project");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function slug(value) {
  return String(value || "concept").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "concept";
}

function yamlScalar(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(String(value || ""));
}

function yamlValue(lines, key, value) {
  if (Array.isArray(value)) {
    lines.push(`${key}:`);
    value.forEach((entry) => {
      if (entry && typeof entry === "object") {
        const entries = Object.entries(entry);
        const first = entries.shift();
        lines.push(`  - ${first[0]}: ${yamlScalar(first[1])}`);
        entries.forEach(([childKey, childValue]) => {
          lines.push(`    ${childKey}: ${yamlScalar(childValue)}`);
        });
      } else {
        lines.push(`  - ${yamlScalar(entry)}`);
      }
    });
    return;
  }
  lines.push(`${key}: ${yamlScalar(value)}`);
}

function conceptMarkdown(frontmatter, bodyLines) {
  const lines = ["---"];
  Object.keys(frontmatter).forEach((key) => yamlValue(lines, key, frontmatter[key]));
  lines.push("---", "");
  return lines.concat(bodyLines || []).join("\n") + "\n";
}

function walkFiles(root, extensions) {
  const out = [];
  if (!fs.existsSync(root)) {
    return out;
  }
  fs.readdirSync(root, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push.apply(out, walkFiles(full, extensions));
      return;
    }
    if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  });
  return out.sort();
}

function outputRoot(project, plugin) {
  if (!plugin.output) {
    throw new Error(`Plugin ${plugin.name || plugin.type || "<unnamed>"} is missing output.`);
  }
  if (path.isAbsolute(String(plugin.output))) {
    throw new Error(`Plugin ${plugin.name || plugin.type || "<unnamed>"} output must be relative to the project root.`);
  }
  const resolved = path.resolve(project.root, plugin.output);
  if (!isInsidePath(project.root, resolved)) {
    throw new Error(`Plugin ${plugin.name || plugin.type || "<unnamed>"} output resolves outside the project root.`);
  }
  return resolved;
}

function sourceRoot(project, plugin) {
  if (!plugin.root) {
    throw new Error(`Plugin ${plugin.name || plugin.type || "<unnamed>"} is missing root.`);
  }
  if (path.isAbsolute(String(plugin.root))) {
    throw new Error(`Plugin ${plugin.name || plugin.type || "<unnamed>"} root must be relative to the project root.`);
  }
  const resolved = path.resolve(project.root, plugin.root);
  if (!isInsidePath(project.root, resolved)) {
    throw new Error(`Plugin ${plugin.name || plugin.type || "<unnamed>"} root resolves outside the project root.`);
  }
  return resolved;
}

function writeGeneratedFiles(root, files) {
  ensureDir(root);
  const written = [];
  files.forEach((content, relativePath) => {
    const full = path.join(root, relativePath);
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, content, "utf8");
    written.push(full);
  });
  return written;
}

function generateFilesystemConcepts(project, plugin) {
  const root = sourceRoot(project, plugin);
  const out = new Map();
  const extensions = Array.isArray(plugin.extensions) ? plugin.extensions.map((ext) => ext.startsWith(".") ? ext : `.${ext}`) : [".md"];
  walkFiles(root, extensions).forEach((filePath) => {
    const relative = normalizeSlashes(path.relative(project.root, filePath));
    const title = path.basename(filePath);
    const idSlug = slug(relative.replace(/\.[^.]+$/, ""));
    out.set(`${idSlug}.md`, conceptMarkdown({
      id: `okf://${plugin.bundle || "generated"}/${idSlug}`,
      type: plugin.conceptType || "Repository File",
      title,
      description: `Repository file ${relative}.`,
      source: `repo://${relative}`,
      tags: Array.isArray(plugin.tags) ? plugin.tags : ["generated", "file"],
    }, [
      `# ${title}`,
      "",
      `Repository file: \`${relative}\``,
      "",
    ]));
  });
  return {
    output: outputRoot(project, plugin),
    files: out,
  };
}

function pickSpecKey(json, filePath) {
  return json.key || json.name || json.id || path.basename(filePath, path.extname(filePath));
}

function generateJsonSpecConcepts(project, plugin) {
  const root = sourceRoot(project, plugin);
  const out = new Map();
  walkFiles(root, [".json"]).forEach((filePath) => {
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    const key = pickSpecKey(json, filePath);
    const relative = normalizeSlashes(path.relative(project.root, filePath));
    const destination = json.destination && json.destination.table ? json.destination.table : json.table || json.tablename || "";
    const relations = destination && plugin.destinationBundle
      ? [{ type: "persists_to", target: `okf://${plugin.destinationBundle}/${slug(destination)}` }]
      : [];
    out.set(`${slug(key)}.md`, conceptMarkdown({
      id: `okf://${plugin.bundle || "generated"}/${slug(key)}`,
      type: plugin.conceptType || "JSON Spec",
      title: key,
      description: json.description || `Generated concept for JSON spec ${key}.`,
      source: `repo://${relative}`,
      tags: Array.isArray(plugin.tags) ? plugin.tags : ["generated", "spec"],
      relations,
    }, [
      `# ${key}`,
      "",
      json.description || `Generated concept for JSON spec \`${key}\`.`,
      "",
      `Source: \`${relative}\``,
      "",
    ]));
  });
  return {
    output: outputRoot(project, plugin),
    files: out,
  };
}

function generateProject(project) {
  const results = [];
  project.plugins.forEach((plugin) => {
    const type = plugin.type || plugin.name;
    const generated = type === "filesystem"
      ? generateFilesystemConcepts(project, plugin)
      : type === "json-spec"
        ? generateJsonSpecConcepts(project, plugin)
        : null;
    if (!generated) {
      throw new Error(`Unknown OKF generator plugin: ${type}`);
    }
    const written = writeGeneratedFiles(generated.output, generated.files);
    results.push({
      plugin: plugin.name || type,
      type,
      output: normalizeSlashes(path.relative(project.root, generated.output)),
      files: written.length,
    });
  });
  return results;
}

module.exports = {
  conceptMarkdown,
  generateProject,
  generateFilesystemConcepts,
  generateJsonSpecConcepts,
};
