---
name: okf-v02-migration
description: Safely analyze and stage an existing Open Knowledge Format catalog migration to OKF v0.2. Use only when explicitly asked to check, preview, or propose a v0.1 or mixed catalog migration.
---

# OKF v0.2 Migration

Use the package's deterministic migration checker and proposal tools. Never rewrite catalog files directly, invent provenance or verification claims, accept proposals automatically, or mutate a remote bundle.

## Workflow

1. Confirm the repository worktree state before creating proposals. Preserve unrelated changes and stop if migration targets overlap unreviewed edits.
2. Run `okf --root <catalog> migrate check`. In an optional multi-root project, run `okf --project <config> migrate check <bundle>`. Record the classification, blockers, identity collisions, generated-file skips, referenced assets, and migration readiness.
3. Resolve blockers before proposing anything:
   - Ask the catalog owner for a truthful `generated.by` actor for every legacy `timestamp`; require an explicit confirmed mapping.
   - Route generated files back to their generator instead of proposing direct edits.
   - Resolve malformed citations, conformance errors, unsafe paths, and ID or alias collisions without guessing.
   - Supply mappings as `{"<concept-uri-or-path>":{"by":"<actor>","confirmed":true}}`; `$default` may be used only after the owner confirms that one actor truthfully applies to every reported timestamp.
   - Use `human:<id>`, `process:<id>`, or `<provider>/<model>` actor syntax. The checker rejects an omitted or non-boolean confirmation.
4. Run `okf --root <catalog> migrate preview '<actor-mappings-json>'`, or supply the bundle id in multi-root project mode. Review every per-file change against [field-mapping.md](references/field-mapping.md).
5. Present the preview and wait for explicit approval before calling `okf_propose_v02_migration`. That MCP tool requires a writable local root and `--authoring`; there is intentionally no CLI command that creates proposals.
6. The proposal tool may create a migration manifest and individual child proposals only. Do not accept any child unless the user explicitly approves that proposal.
7. Accept the reserved `index.md` version proposal only after every Stage-A concept proposal is accepted and the whole bundle validates.
8. Run project validation again and report local evidence, retained legacy fields, remaining generator work, and any external or remote state not verified.

## Safety Boundaries

- Native `generated` and `sources` always win over legacy fallbacks.
- Migration adds native v0.2 fields while retaining `timestamp` and `# Citations` for compatibility.
- Do not add `verified`, credibility signals, lifecycle fields, or freshness claims unless independently authorized and evidenced.
- Never execute a computation, executor, or attester as part of migration.
- Remote bundles are report-only. Make proposals in the source repository under separate authority.
- A checker result is analysis, not approval. Proposal creation is a write; proposal acceptance is a separate explicit write.

## Completion

Report the checker classification, proposed child files, manifest ID, validation result, retained compatibility fields, and anything blocked on an owner mapping or external repository. Do not describe a migration as complete while the version-declaration proposal or validation remains pending.
