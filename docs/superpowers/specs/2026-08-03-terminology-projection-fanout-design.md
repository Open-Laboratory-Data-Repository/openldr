# Terminology → warehouse projection (1→N fan-out) — design

**Date:** 2026-08-03
**Status:** Design agreed. Not implemented.
**Parent:** `2026-08-03-clinical-report-cell-status-and-ranges-design.md` §2.3 — this slice replaces
that section's cost estimate, which was an undercount.
**Unblocks:** S2a (reference ranges), S2b (result classification), and the agreed AMR organism
slice (`2026-07-16-amr-organism-semantics-design.md`), which assumes this machinery and never
costed it.

---

## 0. The premise that changed

§2.3 of the parent spec said the shared machinery was "both switches in `relational/index.ts`, new
dimension tables in `ExternalSchema`, an external migration". **That is an undercount.** The
projection write path is structurally 1-resource→1-row and cannot express a dimension.

Measured by reading the code, 2026-08-03:

| Fact | Evidence |
|---|---|
| A projection produces exactly ONE row | `RelationalResult = { table: keyof ExternalSchema; row: Record<string, unknown> }` — `relational/index.ts:19-22` |
| The writer upserts that single row | `write()` → `upsert(p.table, [p.row])` — `relational-writer.ts:33` |
| Deletion is by RESOURCE id | `deleteById()` → `deleteFrom(table).where('id','=',id)` — `relational-writer.ts:53` |
| The cycle only ever writes-or-deletes one resource | `applyProjection` — `projection/cycle.ts:31-36` |
| Terminology is dropped before any of this | `default: return null` — `relational/index.ts:36`; the sibling switch `tableForResourceType` at `:50` |

A ValueSet expands to N codes. Under the current contract:

- **A shrinking ValueSet silently re-admits removed codes.** `write` upserts the current N rows;
  the previously-written extras are never deleted. This confirms the risk recorded as *unverified*
  in the AMR organism notes — it is real, and it is a correctness defect, not a tidiness one.
- **Deleting the ValueSet leaves the dimension populated**, because `deleteById` matches one `id`.

⚠ Both failure modes are **silent**. Nothing errors; the report simply keeps joining a code the
operator removed. For a clinical vocabulary that is the same bug class as the antibiogram drop that
started [[dont-hardcode-use-terminology]].

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Extend `projectResource` to 1→N** rather than adding a second projection mechanism. One write path stays one write path, and the AMR slice inherits the fix. |
| D2 | **The writer gains delete-not-in-set semantics**, scoped to the owning resource. Correctness, not tidiness — see §0. |
| D3 | **This slice ships the machinery ALONE.** Ranges and classification are a separate, much simpler plan on top. |

## 2. The contract change

`RelationalResult` becomes row-plural and carries an optional ownership scope:

```
RelationalResult = {
  table: keyof ExternalSchema;
  rows: Record<string, unknown>[];
  /** When present, the writer deletes every row in `table` matching this scope that is NOT in
   *  `rows`. Absent for fact tables, whose rows are owned one-per-resource as today. */
  scope?: { column: string; value: unknown };
}
```

- **Fact tables are unaffected**: `patients`, `lab_results`, … return `{ table, rows: [row] }` with
  no `scope`, and the writer's behaviour for them is byte-for-byte what it is today.
- **A terminology dimension** returns `{ table: 'terminology_codes', rows: [...N], scope: { column:
  'value_set_id', value: <resource id> } }`.
- `deleteById(resourceType, id)` must delete by **scope** for scoped tables and by `id` for the
  rest, so removing a ValueSet clears its codes.

⚠ **This widens a type consumed by every projection call site.** Per [[plans-cite-or-flag]] rule 8,
the verification is `turbo typecheck` across every package that builds it — vitest strips types and
will not see it. Known consumers: `relational-writer.ts`, `projection/cycle.ts`,
`bootstrap/src/db-context.ts:45`, `bootstrap/src/index.ts:493`.

## 3. Open questions to settle IN the plan, not before

1. **Does `reprojectAll` still behave?** It calls `writeMany` over every resource in
   `fhir_resources` (`cycle.ts:85`). With fan-out plus delete-not-in-set, two ValueSets projected in
   the same batch must not delete each other's rows. The scope is per-resource, so the writer must
   group by scope, not by table alone. **This is the single most likely place to introduce a bug.**
   ⚠ `reprojectAll` has **no production callers** (grep: only `cycle.ts` and a comment in
   `provenance.ts`), so a defect here would not surface until someone runs a rebuild.
2. **Batch upsert dialect parity.** `upsert` fans out to `insertBatchPg` / `mergeBatchMssql` /
   `insertBatchMysql` (`relational-writer.ts:25-27`). A scoped delete must work on all three, or the
   MSSQL/MySQL targets diverge. Do not assume; check each.
3. **What is the dimension's primary key?** `deleteById`'s `where('id','=',id)` implies every
   external table has an `id`. A `(value_set_id, system, code)` dimension needs either a synthetic
   `id` or a relaxation of that assumption.

## 4. Explicitly NOT in this slice

Reference ranges, `ObservationDefinition`, result classification, the report-side join, and the
units mojibake. This slice ends when a ValueSet's expansion appears in the warehouse, stays in step
when the ValueSet changes, and disappears when it is deleted.

## 5. Notes carried from the research pass

- **`ObservationDefinition` is gated on the ingest path only.** `validateResource` returns
  `not-supported` for unregistered types (`fhir/src/validate.ts:28`) and 14 types are registered;
  `ObservationDefinition` is not. But terminology resources are written by the admin store via
  `valueSetToFhirResource` (`terminology-admin-store.ts:6`), which bypasses that gate. Registering a
  schema is required only if ranges may arrive by FHIR ingest — a design choice for the S2a plan.
- **Reports genuinely cannot reach internal terminology.** Query execution is
  `runConnectorSql({ connectorId, sql })` (`dashboards/src/custom-query-run.ts:48,65`) against the
  external warehouse. The dimension is mandatory, not a convenience.
- **`value_sets` still has no runtime consumer** — exactly 4 files touch it (migration 014, the
  migration index, the schema, the admin store). This slice is terminology's first real consumer.
- External migrations currently run to `010_diagnostic_report_facility.ts`; a new one is `011`.
