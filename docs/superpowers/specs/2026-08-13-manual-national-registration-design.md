# Manual national registration, and the three defects on the Edit sheet

Scope agreed 2026-08-13, from `docs/audit/2026-08-13-edit-sheet-after-an-import.md`.

The audit found three defects on one screen. Checking them found a fourth, larger one behind
them: **a facility cannot be registered by hand against a national register at all.** That is the
real subject of this slice. The three defects follow from it.

---

## What the checks changed

The audit is evidence, not a work order. Four rows, three confirmed, one refuted.

| ID | Finding | Verdict | Proof |
|----|---------|---------|-------|
| F3 | Vocabulary guard refuses the `level` the import wrote | CONFIRMED | `apps/server/src/facilities-routes.ts:585-604`, called at `:1334` |
| F1 | "Facility code" blank on every imported row | CONFIRMED | `apps/studio/src/pages/Facilities.tsx:967` vs `073:442` |
| F2a | The facilities route enforces no required field | CONFIRMED | `validateAnswers` appears in `forms-routes.ts`, never in `facilities-routes.ts` |
| F2b | Required is cosmetic, "only bites when someone trusts it" | REFUTED | `apps/studio/src/forms-runtime/runtime.ts:38-41` and `FormRuntime.tsx:211-214` block submit |

Three corrections that shaped this design.

**The UI already blocks, before the server ever sees the request.** Save proxies into FormRuntime's
own `onSubmit`, which runs `validate()` and returns early on any required error. So on an imported
row the operator gets red markers on Facility code and Region, and no network call. F2 blocks
before F3. Fixing F3 alone would not have unblocked anyone.

**F3's cause is one layer earlier than the audit says.** The guard already limits itself to fields
the caller submitted (`facilities-routes.ts:582-584`) precisely so an unrelated edit is not blocked
by an old value. The sheet defeats that: `seedAnswers` loads every field off the facility
(`FacilityDialog.tsx:64`) and `handleSubmit` posts them all back (`:231-238`). So `level` counts as
submitted on every edit, untouched or not. The server can tell the difference — PUT already loads
`before`.

**"Facility code = the master code" is already the system's own rule.** `registryPreferredCode(row)`
is `localCode ?? nationalCode` (`packages/db/src/facility-observed.ts:170`), and it is the single
definition of a registry row's public code. The terminology projection uses it, the Facilities table
uses it, and Observed mappings are authored against it. The Edit sheet is the only place that does
not. The audit's own suggestion — that binding the sheet to the fallback was "probably wrong" — is
refuted by that line.

---

## The identity rule

This is the load-bearing part. Everything else is small.

The registry has two doors and two identity rules for one master list:

| Door | id |
|---|---|
| CSV import | `fac-sha256(nationalSystem\|nationalCode)` — `packages/terminology/src/facility-csv.ts:151` |
| Manual create | `randomUUID()` — `apps/server/src/facilities-routes.ts:1211` |

The repo already decided which is right. Migration 082's `planMoves` re-keys manual rows and says
why (`082_facility_canonical_identity.ts:161-168`): a row that names a register and a code within
it should be filed under the register's canonical identity, whoever typed it in, or the same
facility exists twice. It also settles the no-code case at `:155-159` — a row with a register but
no national code keeps its id, because `idFor` has nothing to hash.

082 is a one-shot migration. It fixed the rows that existed. POST still mints `randomUUID()`, so
every facility hand-registered since is mis-keyed and nothing will fix it.

**The rule this slice implements:** derive the id from the register and the national code when both
are present; keep the random id otherwise.

Two things make this smaller than expected. POST already accepts `nationalSystem` and
`nationalCode` — both are in `CORE_FACILITY_KEYS`, so `splitFacilityAnswers` writes them. Only the
form offers no field. And `resolveFacilityRegisterForImport`
(`packages/db/src/facility-register-sources.ts:80`) is already the single gate that refuses an
unknown or deactivated register, with its own two messages.

### The data-loss path this opens

`facilityRegistry.upsert` is `onConflict('id').doUpdateSet(...)`
(`packages/db/src/facility-registry-store.ts:469`). Today that is safe, because a random id never
collides. **The moment POST derives the id, a create that lands on an existing imported facility
overwrites it silently** — no error, no audit of what was lost.

So change 1 is not "derive the id". It is "derive the id **and stop upsert from being reachable
from a create**".

---

## What gets built

Six changes. Numbered by dependency, not by priority.

### 1. POST derives the id, and refuses a collision

`apps/server/src/facilities-routes.ts`, POST handler.

- When `record.nationalSystem` and `record.nationalCode` are both non-empty: resolve the register
  through `resolveFacilityRegisterForImport` and refuse with its message if unknown or deactivated.
  Mint `idFor(nationalSystem, nationalCode)`.
- Otherwise: keep `randomUUID()`, unchanged.
- **Before writing, refuse if a row with the derived id already exists.** 409, reusing
  `mapFacilityDbError`'s existing wording, which already names both codes. A create must never
  reach `upsert`'s `doUpdateSet` on a derived id.

The `⛔` comment at `:1206` says the id is always generated here because a client-chosen id could
overwrite an imported row. That reasoning survives — this id is still server-derived, by the same
function the importer uses. The comment needs rewriting to say so, not deleting.

### 2. PUT never changes the national code or the register

If the submission's `nationalCode` or `nationalSystem` differs from `before`, refuse with 400 and
say it is part of the row's identity.

This defers re-keying entirely, which is the point. The id is referenced by
`facility_map.registry_id`, by `facility_concept_projection`, and by mappings authored against the
projected code. Re-keying a live row is its own slice.

**Accepted cost, stated plainly:** a facility created without a national code can never acquire one.
The operator must delete and recreate it. That is worse than re-keying and better than a stale id.

The fields still render on the Edit sheet, seeded with the stored value. An untouched submission
equals `before` and is not refused. A changed one gets an explicit 400 explaining why. This is
deliberately unlike F2's markers: those promised a constraint nothing checked, this one checks and
explains. Two alternatives were considered and rejected — adding `readOnly` to the forms engine (new
capability, every form inherits it) and hiding the fields on edit (needs new `FormRuntime` prop
surface, and `visibleIds` would not know about it).

### 3. PUT checks a controlled field only when it changed

Pass `before` into `controlledFieldsError` on PUT and filter to fields whose submitted value differs
from the stored one. POST is unchanged — there is no `before`.

This is F3. It restores the intent already written at `:582-584`, which the client defeated.

### 4. PUT enforces required only for what changed

Wire `validateAnswers` (`packages/forms/src/validate-answers.ts`) into the facilities route.

- POST enforces every required field. A create must be complete.
- PUT enforces required only for fields this submission changed. A pre-existing gap on an imported
  row never blocks an unrelated edit, but the operator cannot blank a required field.

This is F2a, and it honours the trap the audit named. Changes 2, 3 and 4 all key off the same
question — what did this submission actually change — so they share one comparison against `before`
rather than three.

### 5. Migration 085 — the form

085 is free. 084 is the highest on `main`, and `origin/claude/cdr-turnaround-fix-2hzjh8` adds no
migration past it (checked).

Following the shape-matching pattern 071 and 073 already use, so a form an operator has edited is
never rewritten:

- `fld-fac-local-code` — relabel to "Local code", `required: false`, `cardinality.min: 0`.
- `fld-fac-region` — `required: false`, `cardinality.min: 0`.
- add `fld-fac-national-system`, `apiProperty: 'nationalSystem'`.
- add `fld-fac-national-code`, `apiProperty: 'nationalCode'`.

`packages/forms/src/samples/forms.ts` carries the same seed and must move with it. 071's own comment
warns about that desync.

`local_code` keeps its column. It is UNIQUE on its own (`070:12`), it satisfies the
`facility_registry_has_a_code` CHECK (`070:47`), the importer deliberately excludes it from
`COMPARED` and preserves it through re-import (`facility-classify.ts:38-41`), and dropping it would
change the projected code of every row that has one — which is what Observed mappings point at. What
it loses is only its current role: being required, being the sole code on the form, and being called
"Facility code" while the master code has no field at all.

### 6. Sheet wiring, i18n, docs, mobile

- `FacilityDialog` already fetches `listFacilityImportSources()` for the provenance panel. Feed that
  list to the national-system field's suggestions rather than a second fetch.
- **No new studio i18n keys.** Field labels come from the seeded form's `displayLabel`, which is data
  in `form_definitions`, not an i18n key. Route refusals are plain English strings, matching every
  other error in `facilities-routes.ts`.
- **Docs are English-only on disk.** `apps/studio/src/docs/0.1.0/` has only `en/`, and
  `registry.ts:344` falls back to English for every other locale. So this is two files —
  `apps/studio/src/docs/0.1.0/en/facilities.md` and `apps/web/src/docs/0.1.0/facilities.md` — not
  six. Translating the doc set is real work, but it is a separate slice and predates this one.
- Sheet checked at 375×812. Two new rows in a label-left grid.

---

## Deliberately not in scope

- **Re-keying an existing row.** Change 2 refuses instead. Named above with its cost.
- **A `facilities create` CLI command.** None exists today — the CLI has import, import-run,
  import-sources and scan. §6's parity rule covers admin, settings, danger-zone and maintenance
  surfaces; registering one facility by hand is none of those. Adding it is scope growth, not parity.
- **"Last import — Never imported" on a facility that was imported.** Visible in the operator's own
  screenshot. Already open as I2 in the canonical-identity notes.
- **Zone/Region/District/Council labels are fixed i18n keys**, so a Zambian operator maps Province
  onto "Zone" and still reads "Zone". Deferred by operator decision on 2026-08-12.
- **A read-only field type in the forms engine.** Rejected under change 2.

---

## Traps

1. **`upsert` is `doUpdateSet` on id conflict.** A derived id turns create into overwrite. Change 1
   is unsafe without the existence check.
2. **`validateAnswers` has no visibility check.** The studio's `validate` skips hidden fields
   (`runtime.ts:33`); `validateAnswers` does not. Wiring it server-side enforces required on a
   hidden field the client never enforced. The shipped form has no visibility rules, so this is
   inert today and live the moment an operator adds one.
3. **The sheet submits every field, always.** Any guard written as "only what the caller submitted"
   is disarmed from this client. That is what broke F3; changes 2, 3 and 4 must all compare against
   `before`, never against presence.
4. **pg-mem is not Postgres.** It will not demonstrate the partial unique index on
   `(national_system, national_code)`, and it has no correlated-subquery support. The collision
   behaviour in change 1 needs a real-Postgres test or it is unproven.
5. **Migration numbering.** 085 is free today. Re-check before writing it if any branch merges
   first — a gap blocks boot and pg-mem cannot catch it.

---

## Verification, and what each layer will not prove

- **Route tests** are the only thing that pins the wire shape. `typecheck` green proves nothing
  about it.
- **Change 1's collision refusal needs real Postgres.** Trap 4. A pg-mem test that passes is not
  evidence.
- **The three-way `before` comparison** (changes 2, 3, 4) is route-testable end to end.
- **The migration** needs a test that an operator-edited form is left alone, in the same shape 071
  and 073 already test.
- **Mobile**: `resize_window` at 375×812 catches layout and tap targets. It cannot see the
  `vh`-vs-`dvh` class of bug. Nothing here is bottom-anchored, so that limit should not bite — if it
  does, only a real phone can confirm it.
- **The live check that matters**: import the Zambia file again, open a facility, save without
  touching anything. It must succeed. Then register one by hand against the same register and
  confirm a re-import matches it instead of duplicating or erroring.
