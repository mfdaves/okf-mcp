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
  const args = parseArgs([
    "--authoring",
    "--allow-remote-tool",
    "--parameters-file",
    "-",
    "--receipt-file",
    "receipt.json",
    "--version",
  ]);
  assert.equal(args.authoring, true);
  assert.equal(args.allowRemoteTool, true);
  assert.equal(args.version, true);
  assert.equal(args.parametersFile, "-");
  assert.equal(args.receiptFile, "receipt.json");
  assert.equal(args.maxContentBytes, 65536);
  assert.equal(parseArgs(["--max-content-bytes", "1048576"]).maxContentBytes, 1048576);

  assert.throws(
    () => parseArgs(["--unknown"]),
    (error) => error instanceof UsageError
      && error.exitCode === 2
      && exitCodeForError(error) === 2
      && /Unknown option/.test(error.message),
  );
  assert.throws(() => parseArgs(["--max-content-bytes", "1048577"]), /1 through 1048576/);
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
  assert.match(text, /--parameters-file <path\|->/);
  assert.match(text, /--receipt-file <path\|->/);
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

test("CLI treats malformed structured command arguments as usage errors", async () => {
  const fixture = makeProject();
  await assert.rejects(
    main(["--project", fixture.projectPath, "migrate", "preview", "cli", "{bad"]),
    (error) => error instanceof UsageError
      && exitCodeForError(error) === 2
      && /actor mappings must be valid JSON/.test(error.message),
  );
  await assert.rejects(
    main(["--project", fixture.projectPath, "migrate", "preview", "cli", "[]"]),
    (error) => error instanceof UsageError
      && exitCodeForError(error) === 2
      && /actor mappings must be a JSON object/.test(error.message),
  );
});

test("single-root migration preview does not require a bundle id", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-cli-root-migration-"));
  fs.writeFileSync(path.join(root, "index.md"), [
    "---",
    "okf_version: \"0.2\"",
    "---",
    "",
    "# Index",
    "",
    "- [Alpha](alpha.md)",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "alpha.md"), [
    "---",
    "type: Reference",
    "title: Alpha",
    "---",
    "",
    "# Alpha",
    "",
  ].join("\n"), "utf8");
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    const output = await captureStdout(() => main([
      "--root",
      root,
      "migrate",
      "preview",
      '{"$default":{"by":"human:owner","confirmed":true}}',
    ]));
    assert.equal(process.exitCode, 0);
    assert.match(output, /"targetVersion": "0\.2"/);
    assert.match(output, new RegExp(`"bundle": "${path.basename(root)}"`));
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("CLI graph and concept commands reject reserved or unknown concept identities", async () => {
  const fixture = makeProject();
  fs.writeFileSync(path.join(fixture.bundle, "index.md"), "# Index\n\n- [Alpha](alpha.md)\n", "utf8");
  await assert.rejects(
    main(["--project", fixture.projectPath, "concept", "okf://cli/index.md"]),
    /not a valid OKF concept/,
  );
  await assert.rejects(
    main(["--project", fixture.projectPath, "neighbors", "okf://cli/index.md"]),
    /not a valid OKF concept/,
  );
  await assert.rejects(
    main(["--project", fixture.projectPath, "paths", "okf://cli/missing", "okf://cli/missing"]),
    /Unknown OKF concept URI/,
  );
});
