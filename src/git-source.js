"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync: nodeSpawnSync } = require("node:child_process");
const { resolveConcept } = require("./indexer");

const DEFAULT_MAX_GIT_SOURCE_BYTES = 1024 * 1024;
const MAX_GIT_SOURCE_BYTES = 1024 * 1024;
const DEFAULT_GIT_TIMEOUT_MS = 10000;
const MAX_GIT_TIMEOUT_MS = 60000;

class GitSourceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "GitSourceError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sourceError(code, message, details) {
  return new GitSourceError(code, message, details);
}

function normalizeLines(value) {
  if (value === undefined || value === null) {
    return null;
  }
  let start;
  let end;
  if (Array.isArray(value) && value.length === 2) {
    [start, end] = value;
  } else if (isPlainObject(value)) {
    start = value.from === undefined ? value.start : value.from;
    end = value.to === undefined ? value.end : value.to;
  } else {
    throw sourceError(
      "git_source_invalid_lines",
      "git.lines must be a two-item [start, end] list or a mapping with start and end.",
    );
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw sourceError(
      "git_source_invalid_lines",
      "git.lines uses inclusive, one-based safe integers with end not less than start.",
    );
  }
  return { start, end };
}

function safeGitPath(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw sourceError("git_source_invalid_path", "git.path must be a non-empty repository-relative POSIX path.");
  }
  if (value.includes("\\") || /[\x00-\x1f\x7f]/.test(value) || path.posix.isAbsolute(value)) {
    throw sourceError("git_source_invalid_path", "git.path must be a safe repository-relative POSIX path.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")
    || path.posix.normalize(value) !== value) {
    throw sourceError("git_source_invalid_path", "git.path cannot contain empty, dot, or parent components.");
  }
  if (Buffer.byteLength(value, "utf8") > 4096) {
    throw sourceError("git_source_invalid_path", "git.path exceeds the 4096-byte safety limit.");
  }
  return value;
}

function validateGitSource(source) {
  if (!isPlainObject(source)) {
    throw sourceError("git_source_invalid", "A Git source entry must be a mapping.");
  }
  if (typeof source.resource !== "string" || !source.resource.trim()) {
    throw sourceError(
      "git_source_repository_missing",
      "A Git source entry requires resource to identify its repository concept.",
    );
  }
  if (!isPlainObject(source.git)) {
    throw sourceError("git_source_metadata_missing", "A Git source entry requires a git mapping.");
  }

  const requestedRevision = typeof source.git.revision === "string"
    ? source.git.revision.trim()
    : "";
  const pinned = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(requestedRevision);
  return {
    repositoryConceptId: source.resource.trim(),
    revision: pinned ? requestedRevision.toLowerCase() : null,
    pinned,
    path: safeGitPath(source.git.path),
    lines: normalizeLines(source.git.lines),
  };
}

function mappingFor(repositoryMappings, conceptId) {
  if (repositoryMappings instanceof Map) {
    return repositoryMappings.has(conceptId) ? repositoryMappings.get(conceptId) : undefined;
  }
  if (isPlainObject(repositoryMappings)
    && Object.prototype.hasOwnProperty.call(repositoryMappings, conceptId)) {
    return repositoryMappings[conceptId];
  }
  return undefined;
}

function pathFromMapping(mapping) {
  if (typeof mapping === "string") {
    return mapping;
  }
  if (!isPlainObject(mapping)) {
    return null;
  }
  return mapping.path || mapping.checkout || mapping.repositoryPath || mapping.gitDir || null;
}

function resolveRepositoryPath(repositoryMappings, conceptId) {
  const mapping = mappingFor(repositoryMappings, conceptId);
  if (mapping === undefined) {
    return null;
  }
  const configuredPath = pathFromMapping(mapping);
  if (typeof configuredPath !== "string" || !configuredPath || !path.isAbsolute(configuredPath)) {
    throw sourceError(
      "git_source_invalid_repository_mapping",
      `Repository mapping for ${conceptId} must contain an explicit absolute path.`,
    );
  }
  try {
    const resolved = fs.realpathSync(configuredPath);
    if (!fs.statSync(resolved).isDirectory()) {
      return null;
    }
    return resolved;
  } catch (error) {
    if (error && ["ENOENT", "ENOTDIR"].includes(error.code)) {
      return null;
    }
    throw error;
  }
}

function boundedInteger(value, fallback, maximum, label) {
  const normalized = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TypeError(`${label} must be a safe integer from 1 through ${maximum}.`);
  }
  return normalized;
}

function gitEnvironment(extra) {
  const environment = Object.assign({}, process.env, extra || {});
  [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
    "GIT_DIR",
    "GIT_EXEC_PATH",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_WORK_TREE",
  ].forEach((name) => {
    delete environment[name];
  });
  Object.keys(environment).forEach((name) => {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)) {
      delete environment[name];
    }
  });
  environment.GIT_ALLOW_PROTOCOL = "";
  environment.GIT_LITERAL_PATHSPECS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_PAGER = "cat";
  environment.GIT_PROTOCOL_FROM_USER = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.LC_ALL = "C";
  return environment;
}

function runGit(repositoryPath, args, options, maxBuffer) {
  const config = options || {};
  const spawnSync = config.spawnSync || nodeSpawnSync;
  const result = spawnSync(
    config.gitBinary || "git",
    ["--no-pager", "-C", repositoryPath].concat(args),
    {
      encoding: null,
      env: gitEnvironment(config.env),
      maxBuffer,
      shell: false,
      timeout: config.timeoutMs,
      windowsHide: true,
    },
  );
  if (!result || typeof result !== "object") {
    throw sourceError("git_source_process_error", "Git returned no process result.");
  }
  if (result.error) {
    const code = result.error.code === "ETIMEDOUT"
      ? "git_source_timeout"
      : result.error.code === "ENOBUFS"
        ? "git_source_output_too_large"
        : "git_source_process_error";
    throw sourceError(code, `Git source inspection failed: ${result.error.message}`);
  }
  if (result.signal) {
    throw sourceError("git_source_process_error", "Git source inspection was terminated.");
  }
  return {
    ok: result.status === 0,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ""),
  };
}

function decodeAscii(buffer, code, label) {
  if (!Array.from(buffer).every((byte) => (
    byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)
  ))) {
    throw sourceError(code, `${label} was not valid ASCII.`);
  }
  return buffer.toString("ascii");
}

function parseTreeEntry(buffer, expectedPath) {
  if (!buffer.length) {
    return null;
  }
  if (buffer[buffer.length - 1] !== 0 || buffer.subarray(0, -1).includes(0)) {
    throw sourceError("git_source_invalid_tree_output", "Git returned malformed tree output.");
  }
  const record = buffer.subarray(0, -1);
  const tab = record.indexOf(9);
  if (tab < 0) {
    throw sourceError("git_source_invalid_tree_output", "Git returned malformed tree output.");
  }
  const header = decodeAscii(
    record.subarray(0, tab),
    "git_source_invalid_tree_output",
    "Git tree metadata",
  );
  const match = header.match(/^([0-7]{6}) ([a-z]+) ([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/);
  if (!match) {
    throw sourceError("git_source_invalid_tree_output", "Git returned malformed tree metadata.");
  }
  let returnedPath;
  try {
    returnedPath = new TextDecoder("utf-8", { fatal: true }).decode(record.subarray(tab + 1));
  } catch (error) {
    throw sourceError("git_source_invalid_tree_path", "Git returned a tree path that is not valid UTF-8.");
  }
  if (returnedPath !== expectedPath) {
    throw sourceError("git_source_tree_path_mismatch", "Git returned a different path than the requested source path.");
  }
  return {
    mode: match[1],
    type: match[2],
    oid: match[3].toLowerCase(),
  };
}

function unavailable(source, reason) {
  return {
    available: false,
    reason,
    metadata: {
      repositoryConceptId: source.repositoryConceptId,
      revision: source.revision,
      path: source.path,
      lines: source.lines,
    },
  };
}

function sliceInclusiveLines(text, lines) {
  if (!lines) {
    return text;
  }
  if (!text.length) {
    throw sourceError("git_source_lines_out_of_range", "git.lines cannot select from an empty file.");
  }
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n" && index + 1 < text.length) {
      starts.push(index + 1);
    }
  }
  if (lines.end > starts.length) {
    throw sourceError(
      "git_source_lines_out_of_range",
      `git.lines ends at ${lines.end}, but the source contains ${starts.length} lines.`,
    );
  }
  const startOffset = starts[lines.start - 1];
  const endOffset = lines.end < starts.length ? starts[lines.end] : text.length;
  return text.slice(startOffset, endOffset);
}

function blobObjectId(content, algorithm) {
  const header = Buffer.from(`blob ${content.length}\0`, "ascii");
  return crypto.createHash(algorithm).update(header).update(content).digest("hex");
}

function readGitSource(source, repositoryMappings, options) {
  const normalized = validateGitSource(source);
  if (!normalized.pinned) {
    return unavailable(normalized, "revision_unpinned");
  }
  if (mappingFor(repositoryMappings, normalized.repositoryConceptId) === undefined) {
    return unavailable(normalized, "repository_unmapped");
  }
  const repositoryPath = resolveRepositoryPath(repositoryMappings, normalized.repositoryConceptId);
  if (!repositoryPath) {
    return unavailable(normalized, "repository_unavailable");
  }

  const config = Object.assign({}, options || {});
  config.timeoutMs = boundedInteger(
    config.timeoutMs,
    DEFAULT_GIT_TIMEOUT_MS,
    MAX_GIT_TIMEOUT_MS,
    "timeoutMs",
  );
  const maxBytes = boundedInteger(
    config.maxBytes,
    DEFAULT_MAX_GIT_SOURCE_BYTES,
    MAX_GIT_SOURCE_BYTES,
    "maxBytes",
  );
  const metadataBuffer = 64 * 1024;

  const revisionType = runGit(
    repositoryPath,
    ["cat-file", "-t", normalized.revision],
    config,
    metadataBuffer,
  );
  if (!revisionType.ok) {
    return unavailable(normalized, "revision_unavailable");
  }
  if (decodeAscii(revisionType.stdout, "git_source_invalid_object_type", "Git object type").trim() !== "commit") {
    return unavailable(normalized, "revision_not_commit");
  }

  const listed = runGit(
    repositoryPath,
    ["ls-tree", "-z", "--full-tree", normalized.revision, "--", normalized.path],
    config,
    metadataBuffer,
  );
  if (!listed.ok) {
    return unavailable(normalized, "path_unavailable");
  }
  const entry = parseTreeEntry(listed.stdout, normalized.path);
  if (!entry) {
    return unavailable(normalized, "path_unavailable");
  }
  if (entry.mode === "120000") {
    throw sourceError("git_source_symlink", "Git source paths cannot resolve to symbolic links.");
  }
  if (entry.mode === "160000") {
    throw sourceError("git_source_submodule", "Git source paths cannot resolve to submodules.");
  }
  if (!["100644", "100755"].includes(entry.mode) || entry.type !== "blob") {
    throw sourceError("git_source_not_regular_file", "Git source paths must resolve to regular file blobs.");
  }

  const sized = runGit(repositoryPath, ["cat-file", "-s", entry.oid], config, metadataBuffer);
  if (!sized.ok) {
    return unavailable(normalized, "blob_unavailable");
  }
  const sizeText = decodeAscii(sized.stdout, "git_source_invalid_size", "Git blob size").trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(sizeText)) {
    throw sourceError("git_source_invalid_size", "Git returned an invalid blob size.");
  }
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size)) {
    throw sourceError("git_source_invalid_size", "Git returned an unsafe blob size.");
  }
  if (size > maxBytes) {
    throw sourceError(
      "git_source_too_large",
      `Git source is ${size} bytes and exceeds the configured ${maxBytes} byte limit.`,
      {
        actualBytes: size,
        limitBytes: maxBytes,
        maxAllowedBytes: MAX_GIT_SOURCE_BYTES,
        retryable: size <= MAX_GIT_SOURCE_BYTES,
      },
    );
  }

  const fetched = runGit(repositoryPath, ["cat-file", "blob", entry.oid], config, maxBytes + metadataBuffer);
  if (!fetched.ok) {
    return unavailable(normalized, "blob_unavailable");
  }
  if (fetched.stdout.length !== size || fetched.stdout.length > maxBytes) {
    throw sourceError("git_source_size_mismatch", "Git blob content does not match its inspected size.");
  }
  const objectAlgorithm = entry.oid.length === 64 ? "sha256" : "sha1";
  if (blobObjectId(fetched.stdout, objectAlgorithm) !== entry.oid) {
    throw sourceError("git_source_blob_mismatch", "Git blob content does not match its object ID.");
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(fetched.stdout);
  } catch (error) {
    throw sourceError("git_source_invalid_utf8", "Git source content is not valid UTF-8.");
  }
  const content = sliceInclusiveLines(text, normalized.lines);
  const sha256 = `sha256:${crypto.createHash("sha256").update(fetched.stdout).digest("hex")}`;
  const metadata = {
    repositoryConceptId: normalized.repositoryConceptId,
    revision: normalized.revision,
    revisionAlgorithm: normalized.revision.length === 64 ? "sha256" : "sha1",
    path: normalized.path,
    lines: normalized.lines,
    mode: entry.mode,
    objectType: entry.type,
    blobOid: entry.oid,
    objectAlgorithm,
    size,
    encoding: "utf-8",
    sha256,
  };
  return {
    available: true,
    content,
    blobOid: entry.oid,
    sha256,
    metadata,
  };
}

function readGitSources(sources, repositoryMappings, options) {
  if (!Array.isArray(sources)) {
    throw new TypeError("sources must be an array.");
  }
  return sources.reduce((results, source, index) => {
    if (!source || source.git === undefined) {
      return results;
    }
    results.push(Object.assign({ sourceIndex: index }, readGitSource(source, repositoryMappings, options)));
    return results;
  }, []);
}

function declaredSource(document, sourceId) {
  const sources = document && document.frontmatter && Array.isArray(document.frontmatter.sources)
    ? document.frontmatter.sources
    : [];
  const source = sources.find((entry) => (
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && String(entry.id || "") === String(sourceId || "")
  ));
  if (!source) {
    throw sourceError(
      "git_source_not_declared",
      `Concept ${document && document.conceptId || "<unknown>"} has no source with id ${sourceId || "<missing>"}.`,
    );
  }
  if (!source.git) {
    throw sourceError("git_source_not_git", `Source ${sourceId} does not declare Git metadata.`);
  }
  return source;
}

function repositoryForSource(index, source) {
  const repository = resolveConcept(index, source && source.resource);
  if (!repository || !repository.valid || repository.reserved || repository.type !== "Git Repository") {
    throw sourceError(
      "git_source_repository_invalid",
      "A Git source resource must resolve to a valid concept with type Git Repository.",
    );
  }
  return repository;
}

function readConceptGitSource(index, conceptLocator, sourceId, repositoryMappings, options) {
  const document = resolveConcept(index, conceptLocator);
  if (!document || !document.valid || document.reserved) {
    throw sourceError("git_source_concept_invalid", `Unknown valid OKF concept: ${conceptLocator || "<missing>"}`);
  }
  const source = declaredSource(document, sourceId);
  const repository = repositoryForSource(index, source);
  const result = readGitSource(Object.assign({}, source, {
    resource: repository.conceptId,
  }), repositoryMappings, options);
  return Object.assign({
    conceptId: document.conceptId,
    sourceId: String(sourceId),
    repository: {
      conceptId: repository.conceptId,
      resource: repository.frontmatter.resource || null,
    },
  }, result);
}

function describeConceptGitSources(index, document, repositoryMappings) {
  const sources = document && document.frontmatter && Array.isArray(document.frontmatter.sources)
    ? document.frontmatter.sources
    : [];
  return sources.reduce((output, source) => {
    if (!source || typeof source !== "object" || Array.isArray(source) || !source.git) {
      return output;
    }
    try {
      const repository = repositoryForSource(index, source);
      const normalized = validateGitSource(Object.assign({}, source, { resource: repository.conceptId }));
      output.push({
        id: source.id || null,
        repositoryConceptId: repository.conceptId,
        revision: normalized.revision,
        path: normalized.path,
        lines: normalized.lines,
        pinned: normalized.pinned,
        mapped: mappingFor(repositoryMappings, repository.conceptId) !== undefined,
      });
    } catch (error) {
      output.push({
        id: source.id || null,
        available: false,
        reason: error.code || "git_source_invalid",
      });
    }
    return output;
  }, []);
}

module.exports = {
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_MAX_GIT_SOURCE_BYTES,
  describeConceptGitSources,
  GitSourceError,
  MAX_GIT_SOURCE_BYTES,
  readConceptGitSource,
  readGitSource,
  readGitSources,
  resolveRepositoryPath,
  safeGitPath,
  validateGitSource,
};
