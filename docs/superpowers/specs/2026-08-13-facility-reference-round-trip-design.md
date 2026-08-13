# A picked value does not survive being read back

**Slice 1 of 2.** Slice 2 (merging the two code columns) is sketched at the end and is not designed
here.

Follows `2026-08-13-manual-national-registration-design.md`, merged as `9e59e5a8`. That slice closed
the audit's three defects **at the API**, proven against the real 3788-row Zambia export. It did not
make the Edit sheet usable, because it was verified with `curl` and never with the mouse.

Found 2026-08-13 by pressing Save. Measured on a live install carrying the 3788 imported rows plus
one manually-created facility.

---

## The one defect, at two layers

A facility's `level`, `status` and `country` are picked from a ValueSet. The picker produces a coding
object — `{system, code, display}`. The column that stores it is `text`, so only one string survives.
Everything downstream then disagrees about which string that should have been.

`splitFacilityAnswers` flattens the answer to its **display**, falling back to `code`
(`packages/db/src/facility-answers.ts:134-141`). The comment there states the reason: the column
stays human-readable, because existing reports group by the rendered level and status text. That
decision is sound and this slice does not touch it.

Both consumers of that column expect the other string.

### D1 — the Edit sheet cannot save any facility

Not just imported facilities. **Any** facility. Measured on an imported row (`fac-ffba14a83e48c1e5`)
and on the manually-created one.

Save issues no request at all. The form blocks first, on Country, Status and Level:

```
select a value from the list
```

- The sheet seeds a reference field with the stored string — `'Active'`,
  `'Level IA2 (Dispensary Laboratory)'` (`apps/studio/src/facilities/FacilityDialog.tsx:70`).
- `validate` demands an object for a reference field that has a source
  (`apps/studio/src/forms-runtime/runtime.ts:47-51`).
- `isCodingAnswer` is false for any string — it wants `{system, code}`
  (`packages/forms/src/reference-source.ts:71-73`).

Creating works, because the picker supplies a real coding. **Editing** is what is broken, and has
been since status and level became `reference` fields in migrations 072/073.

`ReferencePicker` already tolerates a raw string for display purposes
(`apps/studio/src/forms-runtime/ReferencePicker.tsx:26-36`). That is why the boxes look correctly
filled while the form refuses to submit — the operator sees values and a dead Save.

**Operator-observed:** Country, Status and Level had to be re-picked before Save did anything.
Clearing a box to re-pick it empties it, so the message is sometimes `required` and sometimes
`select a value from the list`. One cause, two faces.

### D2 — the vocabulary guard refuses the value set's own displays

`resolveControlledFields` builds its canonical set from the expansion's **codes**
(`packages/bootstrap/src/facility-controlled-fields.ts:130-131`) and compares the stored string
against it.

**Measured.** A create carrying the value set's own displays returned
`level 'Health Center' is not a recognised canonical level value`. It passed only when the *code* was
submitted as the answer — which then stores the code in the column and makes the display column
unreadable, defeating the reason the column holds displays at all.

The manually-created facility on this install carries `Level IA2 (Dispensary Laboratory)`, which the
guard also rejects. So this is not an import artefact; it refuses hand-entered data too.

---

## The fix

One idea, applied at both layers: **a stored string is matched against the value set, and a match is
accepted.** Neither layer gets to assume the string is a code.

### 1. Reference answers are resolved on load

Resolve each seeded reference field's stored string back to a coding, using the same per-field
endpoint the picker already searches — `/api/forms/:formId/fields/:fieldId/reference-search`. An
exact match on display wins, else an exact match on code. No match leaves the raw string alone, and
the field then honestly reports that a value must be picked, because the vocabulary genuinely does
not contain it.

**Not** by relaxing `validate` to accept a bare string. That check is what stops a capture form
storing free text where a coded answer is required; disarming it would trade this defect for a worse
one.

**Location: `FormRuntime`, not `FacilityDialog`.** Every consumer that seeds a form from stored
scalars carries this bug latent — the Users sheet seeds the same way. Fixing it in the facilities
sheet would be the duplicated copy. The cost is a wider blast radius: this touches every form, so it
needs tests at the runtime level, not only through the facilities sheet.

Resolution is per reference field with a resolvable source, once per form load, and its failure must
degrade to today's behaviour rather than blocking the sheet.

### 2. The guard accepts a canonical display as well as a canonical code

Add the expansion's displays to the canonical set in `resolveControlledFields`, so a value that came
out of the picker is recognised as what it is.

⚠ **That function has two callers with opposite policies.** The routes refuse a non-canonical value;
the import only warns and writes the raw string through
(`packages/bootstrap/src/facility-controlled-fields.ts:157-159`). Widening the canonical set moves
both: a file whose spelling exactly matches a canonical display stops being reported as unmapped.
That is correct — it *is* canonical — but the import's warning counts change, and the tests pinning
those numbers must move with it deliberately, not be adjusted until they pass.

Nothing stored changes. No migration. Reports keep grouping on readable text.

---

## Deliberately not in scope

- **Storing codes instead of displays.** It would remove the seam at its source rather than teaching
  two layers to tolerate it. It costs a data migration plus every report that groups on the rendered
  text — the constraint is written into `packages/db/src/facility-answers.ts:138`. Worth doing one
  day; not while the screen cannot save.
- **Merging `local_code` and `national_code`.** Slice 2, below.
- **Adoption** — a facility acquiring a national code. Blocked today by a refusal added in the
  previous slice. It dissolves in slice 2 rather than needing its own fix.
- **`page-targets.ts` still requires `localCode`** for a facilities-targeted form. Slice 2 changes
  that list anyway.

---

## Traps

1. **Verify with the mouse.** The previous slice reported the sheet as rendering correctly and never
   pressed Save. No claim about the Edit sheet counts here unless a real click produced it.
2. **D1 is not facilities-specific.** A fix proven only through the facilities sheet is not proven.
3. **`resolveControlledFields` serves a refusing caller and a warning caller.** Check what the import
   reports after the change, not just what the routes accept.
4. **The three fields fail differently depending on operator sequence** — `select a value from the
   list` before clearing, `required` after. A fix that silences only one of those has not fixed it.

## Verification

- **Live, with the mouse:** open an imported facility, press Save, change nothing. It must save.
- **Live, with the mouse:** open the manually-created facility, press Save, change nothing. It must
  save. Both, because D1 is not import-specific.
- **Live:** create a facility picking Country, Status and Level from their pickers. It must save, and
  the stored columns must still read as displays.
- **Runtime tests** for the reference round trip, at the `FormRuntime` level, covering match on
  display, match on code, and no match.
- **Import tests** re-pinned for the changed unmapped counts, with the new numbers explained.
- Anything not proven by a click or a command is written down as **HONEST NON-PROOF**.

---

## Slice 2 — sketch only, not designed here

One code column, agreed with the operator on 2026-08-13:

- `facility_code` and `facility_system` replace `local_code` and `national_code`. Unique on the pair.
  This is `Location.identifier`'s own shape — `Identifier{system, value}` — which two discriminated
  identifier fields never were.
- **Not** named `system_code`: `coding_systems.system_code` already exists and holds the short code
  `ZM_MFL`, while the URI lives in `coding_systems.url`
  (`packages/db/src/migrations/internal/012_terminology_admin.ts:58`). The facility column holds the
  **URI**, because `idFor`, `observedFieldSystem` and `resolveFacilityRegisterForImport` all key on it.
- `local_code` is removed. An LIS's own code belongs on the Observed side, in
  `facility_map.source_code`, and always did.
- Rows carrying both codes today keep the national one and park the local one in `extras`. The
  importer preserves a hand-assigned local code through re-import
  (`packages/bootstrap/src/facility-classify.ts:38-41`), so such rows exist on a live deployment even
  though this install has none.
- `lab.facilitySystem` in Settings, beside `lab.logo`, holds this install's default register so the
  operator does not retype it. It must store a **pointer to a registered register**, never free text:
  `idFor` hashes the system string without normalising it, so a typed label mints a second permanent
  identity — the defect migration 082 had to clean up.
- The importer resolves an existing row by `(system, code)` before falling back to the derived id.
  This is safe because `idFor` is computed in exactly three places and nothing ever looks a row **up**
  by recomputing it (`facility-csv.ts:414`, `facility-release.ts:175`,
  `apps/server/src/facilities-routes.ts:1320`).
- Cost: roughly 14 source files, a data migration on a table that runs 13k rows at national scale, and
  a column in the **external** database (`facility_map.local_code`). `facility-reconcile.ts` alone
  holds 29 references.
