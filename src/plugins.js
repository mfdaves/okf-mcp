"use strict";

const fs = require("fs");
const path = require("path");
const { safeProjectPath } = require("./project");
const { renderFrontmatter } = require("./authoring");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function slug(value) {
  return String(value || "concept").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "concept";
}

function conceptMarkdown(frontmatter, bodyLines) {
  const lines = ["---", renderFrontmatter(frontmatter), "---", ""];
  return lines.concat(bodyLines || []).join("\n") + "\n";
}

function generatedMetadata(plugin) {
  return {
    by: `process:okf-mcp/${plugin.name || plugin.type || "generator"}`,
  };
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
  return safeProjectPath(
    project.root,
    plugin.output,
    `Plugin ${plugin.name || plugin.type || "<unnamed>"} output`,
  );
}

function sourceRoot(project, plugin) {
  if (!plugin.root) {
    throw new Error(`Plugin ${plugin.name || plugin.type || "<unnamed>"} is missing root.`);
  }
  return safeProjectPath(
    project.root,
    plugin.root,
    `Plugin ${plugin.name || plugin.type || "<unnamed>"} root`,
  );
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
      resource: `repo://${relative}`,
      sources: [{ resource: `repo://${relative}`, title }],
      generated: generatedMetadata(plugin),
      // Compatibility extension retained for existing generated catalogs.
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
      resource: `repo://${relative}`,
      sources: [{ resource: `repo://${relative}`, title: key }],
      generated: generatedMetadata(plugin),
      // Compatibility extension retained for existing generated catalogs.
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
  if (Array.isArray(project && project.errors) && project.errors.length) {
    throw new Error("Cannot run generator plugins while the project configuration is invalid.");
  }
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
