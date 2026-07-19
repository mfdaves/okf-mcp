---
name: okf-mcp-release
description: Prepare, audit, publish, and verify okf-mcp npm prereleases and stable releases. Use for okf-mcp release readiness, version bumps, npm identity changes, trusted publishing, tarball inspection, npx verification, MCP capability checks, stdio protocol smoke tests, self-OKF validation, or MCP Registry metadata synchronization.
---

# okf-mcp Release

Release only from the `okf-mcp` repository root. Treat package identity, npm publication, Git tags, and registry publication as externally visible changes that require explicit user authorization.

## Gather Release Inputs

Determine:

- target version and npm dist-tag;
- final npm package name and authenticated owner;
- expected Git branch, commit, and tag;
- whether this is a prerelease, stable release, or audit only;
- whether MCP Registry publication is in scope.

Call `localDocs.list_sources` before broad discovery. Use a registered `okf-mcp` source when available; do not create one implicitly. Read these durable contracts through OKF when relevant:

- `okf://okf-mcp/distribution/reference-bundle`
- `okf://okf-mcp/interfaces/mcp-tools`
- `okf://okf-mcp/specs/concept-format`
- `okf://okf-mcp/policies/authoring-safety`

Verify implementation claims in the current source after reading concepts.

## Hard Stops

Stop before changing identity or publishing when any condition holds:

- `npm whoami` is unauthenticated or does not own the selected scope;
- the selected package name has unresolved ownership or tombstone status;
- the worktree contains unrelated changes;
- the target npm version or Git tag already exists;
- source tests, self-OKF validation, package smoke, or stdio checks fail;
- package, lockfile, CLI, MCP, or registry versions disagree;
- `server.json` and `mcpName` disagree when registry publication is enabled.

Never print npm tokens, copy credentials into files, rewrite an existing release tag, or republish an existing version.

## Capability Gate

Confirm discovery and direct invocation enforce the same matrix:

| Mode | Proposal mutations | Runtime remote load | Configured remote reads |
| --- | --- | --- | --- |
| default | disabled | disabled | enabled |
| `--authoring` | enabled | disabled | enabled |
| `--allow-remote-tool` | disabled | enabled | enabled |
| both flags | enabled | enabled | enabled |

Project-only validation, path suggestion, and proposal-reading tools may appear without `--authoring`. A disabled tool must reject a direct `tools/call`.

## Source And Artifact Gate

Run:

```bash
npm ci
npm test
npm run self:validate
npm run package:smoke
npm run pack:check
```

Require all of the following:

- remote concepts and relationships survive an accepted local proposal;
- unsupported MCP protocol versions return an initialization error;
- a real newline-delimited stdio session initializes, lists tools, and calls a read-only tool;
- YAML accepts supported standard structures and preserves unknown keys;
- validation reports `conformant` separately from `validForProject`;
- valid `index.md` and `log.md` pass, malformed reserved files fail conformance;
- the generated tarball installs into a fresh temporary project without using the source checkout;
- both installed binaries report the package version;
- the packed self-OKF project is present and validates;
- tests, proposal records, credentials, and unrelated development files are absent from the tarball.

Use Node 22 and Node 24 for runtime CI. Use Node 24 with npm 11.5.1 or newer for trusted publication.

## Prerelease

After the gate passes and identity is confirmed:

1. Update all identity-bearing metadata together.
2. Set a fresh prerelease version such as `0.3.2-rc.1`.
3. Re-run the complete source and artifact gate.
4. Commit and tag the exact verified state.
5. Bootstrap a new npm package manually with two-factor authentication when trusted publishing cannot create it.
6. Configure this repository's `release.yml` as the npm trusted publisher.
7. For subsequent releases, dispatch `release.yml` with the exact Git tag and npm dist-tag.
8. Verify the registry artifact with exact-version `npx`.
9. Connect an MCP client to the `npx` command and repeat initialize, tool-list, resource-read, and read-only tool checks.

Do not promote merely because `npm publish` succeeded.

## Stable Promotion

Create a new stable version; do not retag prerelease bytes.

1. Set the stable version.
2. Repeat the entire gate from a clean checkout.
3. Dispatch `release.yml` for the exact stable tag under `latest`.
4. Verify exact-version and dist-tag installations.
5. Confirm Git HEAD, remote branch, release tag, and npm integrity identify the verified release.

Publish MCP Registry metadata only after npm verification. Synchronize `package.json` name/version/`mcpName`, MCP `serverInfo`, and `server.json` before calling the registry publisher.

## Report

Return:

- release identity: package, version, dist-tag, commit, Git tag;
- gate results: tests, OKF, capability matrix, stdio, tarball, clean install;
- external verification: npm and npx, plus registry when applicable;
- confirmed blockers and the exact user or account action required;
- final worktree and remote alignment.
