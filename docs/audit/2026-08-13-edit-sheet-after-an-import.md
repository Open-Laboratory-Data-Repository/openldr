# The Edit sheet after an import

Import 3788 real facilities, open any one of them, and three separate things are wrong on the same
screen. None is a regression. The import is what made them visible at scale.

Found 2026-08-13 during a live run of the Zambia MFL export (3788 rows) against a dev stack, after
the facility import column/value mapping slice merged (`edfe5915`). Every number below is measured
against the resulting database, not inferred.

**This is evidence, not a work order.** Scope is the operator's call.

---

## F1. "Facility code" is blank on every imported facility, while the table shows a code

The table's CODE column falls back across two different fields:

```
{f.localCode ?? f.nationalCode ?? '—'}     apps/studio/src/pages/Facilities.tsx:967
```

The Edit sheet's "Facility code" field is bound to `localCode` **alone** (`apiProperty: 'localCode'`
on `fld-fac-local-code`).

An imported row has no `localCode` and never will. The parser refuses to invent one, on purpose.
`packages/terminology/src/facility-csv.test.ts` pins it: *"gives an imported row NO local code, a
national register has no concept of one"*. So the table shows the **national** code and the sheet
shows nothing.

**Measured:** 3788 of 3788 imported rows have `local_code` NULL, and every one displays a code in
the table. The one manually-created facility has a real `localCode` (`111317-4`) and looks correct,
which is why this reads as "imported data is broken" rather than "these are two fields".

**What would fix it:** either bind the sheet to the same fallback the table uses, or label them
differently so "CODE" and "Facility code" are not read as the same thing. The first is probably
wrong. Editing a national code through a field labelled local code would be worse.

## F2. Required markers that nothing enforces

The Facility form marks eight fields required. Two of them are fields the import path cannot supply:

| Field | Form | Import contract | Imported rows affected |
|---|---|---|---|
| `localCode` ("Facility code") | `required: true` | never produced, see F1 | 3788 / 3788 |
| `region` ("Region") | `required: true` | Zambia has no tier between Province and District | 3788 / 3788 |

The red `!` markers in the sheet promise a constraint. **Nothing checks it on this path.**

- `validateAnswers` (`packages/forms/src/validate-answers.ts`) exists and does flag missing required
  fields, but it is wired into `apps/server/src/forms-routes.ts:321` and
  `packages/bootstrap/src/form-validate-service.ts`, **not** into `apps/server/src/facilities-routes.ts`.
- The dialog's Save is gated on `formReady` (`apps/studio/src/facilities/FacilityDialog.tsx:252`),
  which is `!schemaLoading && !noForm && schema !== null`. That is schema loading, not validity.

**Measured, not inferred.** A `PUT /api/facilities/:id` carrying empty `fld-fac-local-code` and
empty `fld-fac-region` returned **HTTP 200 and saved**, leaving both columns NULL.

So the operator cannot tell which fields actually matter. That is worse than a hard block, because a
hard block at least tells the truth.

**What would fix it:** decide which of the two the form is for. Either enforce required on the
facilities route (and then `region` must stop being required, or no Zambian facility can ever be
edited), or stop rendering a required marker the path does not honour.

The two changes interact. Making the route enforce required **without** first relaxing `region` would
turn F2 from a cosmetic lie into a hard lock-out on 3788 rows.

## F3. The vocabulary guard blocks editing an imported facility outright

Before either of the above can even be reached, the save is refused:

```
PUT /api/facilities/fac-ffba14a83e48c1e5
→ 400 {"error":"level 'Health Centre' is not a recognised canonical level value"}
```

`Health Centre` is the value the import legitimately wrote. Unmapped values are written through raw
by design. `applyControlledFields` never blocks and never blanks
(`packages/bootstrap/src/facility-controlled-fields.ts:155`). The edit path then refuses the very
value the import path was designed to keep.

The same save succeeded once `level` was changed to the canonical `health-center`.

**So an imported facility cannot be edited at all until its vocabulary is mapped**, and mapping is
optional by design. Two subsystems each behaving correctly, disagreeing at the seam.

This matches the known open item about the vocabulary guard blocking legacy edits; this is it
reproducing on fresh data rather than legacy rows.

---

## Why these surfaced together

The import is the first thing that creates facilities at scale from a source that does not carry
local codes, does not have a region tier, and uses its own vocabulary. Each of the three is a
reasonable local decision. The Edit sheet is where all three meet, and where the operator sees
them.

Ranking by what an operator hits first: **F3 blocks outright**, F1 looks like data loss, F2 is a
lie that only bites when someone trusts it.

## Deliberately not covered

- The Facilities page still labels the admin levels Zone/Region/District/Council from fixed i18n
  keys (`apps/studio/src/pages/Facilities.tsx:855`), so a Zambian operator maps Province → Zone and
  still reads "Zone". Deferred by operator decision on 2026-08-12; F2 is a different problem that
  happens to involve the same field.
- 12 rows in the Zambia source carry malformed coordinates (8 missing a decimal point such as
  `29580210`; 4 with an embedded space such as `26. 998300`). That is a source-data defect for the
  Zambia team, not an OpenLDR one. The parser refuses them correctly.
