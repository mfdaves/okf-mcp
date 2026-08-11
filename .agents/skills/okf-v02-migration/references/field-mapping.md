# OKF v0.2 Stage-A Field Mapping

| Legacy input | Native v0.2 addition | Preconditions | Retained by migration |
| --- | --- | --- | --- |
| `timestamp` | `generated.at` | Valid ISO datetime and a confirmed truthful `generated.by` actor mapping | Yes |
| `# Citations` list | `sources[]` with `resource` and an optional literal title | Every entry has a stable, unambiguous resource; native `sources` is absent | Yes |
| Undeclared root index | `okf_version: "0.2"` | All Stage-A child proposals accepted, no blockers, whole bundle validates | N/A |

Do not infer author, usage count, last modified time, usage windows, verification events, status, or `stale_after` from legacy prose. Native fields already present are authoritative and are never overwritten by the migration planner.

Generated concepts must be changed in their generator and regenerated. Remote concepts are reported but never proposed or written by this workflow.

## Actor mapping JSON

Keys may be a canonical concept URI, compatibility path URI, bundle-relative path, or `$default`. Every value must contain an exact actor and explicit confirmation:

```json
{
  "okf://finance/metrics/revenue": {
    "by": "process:nightly-import",
    "confirmed": true
  }
}
```

Allowed actor forms are `human:<id>`, `process:<id>`, and `<provider>/<model>`. A plausible name is not evidence: never set `confirmed` until the catalog owner confirms the mapping is truthful.
