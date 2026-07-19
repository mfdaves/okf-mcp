"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const packageMetadata = require("../package.json");
const {
  UsageError,
  exitCodeForError,
  main,
  parseArgs,
  usage,
} = require("../src/cli");

function makeProject(options) {
  const config = options || {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-cli-contract-"));
  const bundle = path.join(root, "okf", "bundle");
  const nested = path.join(root, "nested", "deeper");
  fs.mkdirSync(bundle, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, "okf.project.yaml"), [
    "project: CliContract",
    "bundles:",
    "  - id: cli",
    "    root: okf/bundle",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(bundle, "alpha.md"), [
    "---",
    ...(config.invalid ? [] : ["type: Spec"]),
    "title: Alpha",
    "description: CLI contract fixture",
    "---",
    "",
    "# Alpha",
    "",
  ].join("\n"), "utf8");
  return { root, bundle, nested, projectPath: path.join(root, "okf.project.yaml") };
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = function write(chunk) {
    output += String(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}

test("CLI parses contract flags and rejects unknown options as usage errors", () => {
  const args = parseArgs(["--authoring", "--allow-remote-tool", "--version"]);
  assert.equal(args.authoring, true);
  assert.equal(args.allowRemoteTool, true);
  assert.equal(args.version, true);

  assert.throws(
    () => parseArgs(["--unknown"]),
    (error) => error instanceof UsageError
      && error.exitCode === 2
      && exitCodeForError(error) === 2
      && /Unknown option/.test(error.message),
  );
  assert.equal(exitCodeForError(new Error("operational")), 1);
});

test("version flags print package.json version on clean stdout", async () => {
  for (const flag of ["--version", "-v"]) {
    const output = await captureStdout(() => main([flag], { cwd: os.tmpdir() }));
    assert.equal(output, `${packageMetadata.version}\n`);
  }
});

test("usage documents version and MCP capability flags", () => {
  const text = usage();
  assert.match(text, /--version, -v/);
  assert.match(text, /--authoring/);
  assert.match(text, /--allow-remote-tool/);
  assert.match(text, /nearest okf\.project\.yaml/);
});

test("validate and search discover the nearest project config", async () => {
  const fixture = makeProject();
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    const validation = await captureStdout(() => main(["validate"], { cwd: fixture.nested }));
    assert.equal(process.exitCode, 0);
    assert.match(validation, /"valid": true/);

    const search = await captureStdout(() => main(["search", "Alpha"], { cwd: fixture.nested }));
    assert.match(search, /CLI contract fixture/);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("default MCP discovery forwards explicit capability options", async () => {
  const fixture = makeProject();
  let call;
  await main(["--authoring", "--allow-remote-tool"], {
    cwd: fixture.nested,
    runStdioServer: async (bundles, input, output, options) => {
      call = { bundles, input, output, options };
    },
  });

  assert.deepEqual(call.bundles, []);
  assert.equal(call.input, process.stdin);
  assert.equal(call.output, process.stdout);
  assert.deepEqual(call.options, {
    remoteBundles: [],
    allowAuthoring: true,
    allowRuntimeRemoteLoad: true,
    projectPath: fixture.projectPath,
  });
});

test("CLI separates usage, validation, and operational failures", async () => {
  await assert.rejects(
    main(["--unknown"]),
    (error) => error instanceof UsageError && exitCodeForError(error) === 2,
  );

  const previousExitCode = process.exitCode;
  const invalid = makeProject({ invalid: true });
  try {
    process.exitCode = 0;
    const validation = await captureStdout(() => main(["validate"], { cwd: invalid.nested }));
    assert.equal(process.exitCode, 1);
    assert.match(validation, /"valid": false/);

    const missingProject = path.join(os.tmpdir(), `okf-missing-project-${process.pid}`, "okf.project.yaml");
    await assert.rejects(
      main(["--project", missingProject, "validate"]),
      (error) => exitCodeForError(error) === 1,
    );
  } finally {
    process.exitCode = previousExitCode;
  }
});
