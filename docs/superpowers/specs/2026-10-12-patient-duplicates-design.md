# Patient duplicate detection design

Date: 2026-10-12
Status: draft for operator review
Builds on: `docs/superpowers/specs/2026-10-12-patient-index-design.md`

## Why

The Patient Index lists patients that arrive from a source system. In Zambia that source is a HIMS
that owns the Master Patient Index. Duplicates in it, such as one person registered twice, split a
patient's lab history across two records.

CE finds likely duplicates and lists them with the evidence. The team that owns the source fixes them
there. CE does not merge.

The user action that is broken today: nobody can see which patient records in CE look like the same
person. The Patient Index shows one record at a time.

## Why CE does not merge

Two facts, both from the code:

1. A merge in CE is undone by the next send from the source. `mergePatients` writes a new version
   of the duplicate Patient with `active: false` and a `replaced-by` link
   (`packages/db/src/fhir-store.ts:559-586`). When the HIMS sends that Patient again, ingest stores
   the HIMS version as the latest, so the duplicate is active again with no link. New requests the
   HIMS sends for the duplicate land on the duplicate.
2. The existing merge refuses on a lab with no sync site. `latestSite` returns `''` when
   `change_log.site_id` is null (`fhir-store.ts:205-214`), and the merge then throws
   `CrossSiteMergeError`.

A merge in CE for a lab where CE is the only system may come later as its own slice.

## Scope

In:

- A stored match key on `patients`, so finding same-person groups is a cheap GROUP BY.
- Two exact match rules.
- A Duplicates tab on the Patients page, a group sheet, and CSV export.
- Marking a pair of patients "not duplicates", and undoing it.
- CLI parity, docs in en, fr and pt, mobile, changelog.

Out:

- Merging in CE.
- Fuzzy name matching (sound-alike names, swapped first name and surname).
- Notifying the source system.

## What exists today

- `patients` has `surname`, `firstname`, `date_of_birth`, `sex`, `active`, `replaced_by_id`
  (`packages/db/src/schema/external.ts:11-24`). No normalised name column.
- `patient_identifiers` has one row per identifier with an index on `(system, value)`
  (`packages/db/src/migrations/external/025_patient_identifiers.ts`).
- Identifier system labels and the searchable flag come from `PatientIdentifierSystems`
  (`packages/bootstrap/src/patient-identifier-systems.ts`).
- All patient responses are built and masked in `packages/bootstrap/src/patient-index.ts`.
- The next external migration is `026`. The next internal migration is `111`. No open branch claims
  either.

## 1. Match rules

A **duplicate group** is two or more active, unmerged patients (`active = true` and
`replaced_by_id is null`) that share one key.

### Rule 1: shared identifier

Two or more patients carry the same `value` in the same `system`. Identifiers with a null system are
left out, because a bare value without a system says nothing about what it identifies. Systems marked
not searchable are left out too: an operator who has said "do not match on this" means it here as
well.

The group key is `(system, value)`.

### Rule 2: same person details

Two or more patients share the same `match_key`, and their sexes agree.

`match_key` is computed in the projector, in TypeScript, so it is the same on every dialect:

1. Take `surname`, `firstname` and `date_of_birth`.
2. If any of the three is missing or blank, the key is null and the patient takes no part in rule 2.
   A name with no date of birth matches too many unrelated people.
3. Normalise each name: Unicode NFD, remove combining marks, lowercase, collapse runs of whitespace
   to one space, trim.
4. Keep the date of birth as given (`YYYY-MM-DD`, or a shorter FHIR partial date).
5. Join as `surname|firstname|dob`.

Sex is not in the key, because "the same sex when both have one" cannot be one stored value. When
the group is read, two members are compatible when their sexes are equal, or when either is null. A
group is reported when at least one compatible pair remains. The members shown are those compatible
with at least one other member.

The group key is the `match_key`.

### Both rules

A pair can appear in a rule 1 group and a rule 2 group. Each group is listed under its own rule.
That repetition is more evidence, not a fault.

## 2. Data

### External migration 026: `patients.match_key`

- Add `match_key`, key-sized text, nullable, to `patients`.
- Add index `patients_match_key_idx` on `match_key`.
- The Patient projector fills it. Existing installs fill it with `openldr db reproject --force`. The
  upgrade note says so.
- Add it to `HARDCODED_DENY_UNION` and `PII_COLUMNS` for `patients` in
  `packages/dashboards/src/models/registry.ts`, because it holds a name and a date of birth.

### Internal migration 111: `patient_duplicate_dismissals`

| Column | Type | Note |
|---|---|---|
| `patient_a` | text, not null | the smaller of the two ids |
| `patient_b` | text, not null | the larger of the two ids |
| `reason` | text, null | free text |
| `dismissed_by` | text, not null | user name, or the CLI actor |
| `dismissed_at` | timestamp, not null | |

Primary key `(patient_a, patient_b)`. Ids are stored in sorted order so a pair has one row whichever
way round it was dismissed.

A dismissal says "these two are different people". It does not depend on the rule.

## 3. Reading the list

One bootstrap module, `packages/bootstrap/src/patient-duplicates.ts`, serves the routes and the CLI.

1. Rule 1 groups: `select system, value, patient_id from patient_identifiers` joined to active,
   unmerged patients, keeping `(system, value)` keys with two or more distinct patients.
2. Rule 2 groups: `select match_key, id, sex from patients` for active, unmerged patients, keeping
   keys with two or more patients.
3. Apply the sex rule to rule 2 groups.
4. Load dismissals for the member ids. Drop a group when every pair in it is dismissed.
5. Order groups by a hash of the group key (rule, system, value), so paging is stable and the order
   hints at no name or identifier. Page in memory.

Dismissals are in the internal db and patients in the warehouse, so steps 4 and 5 run in code. That
is fine for thousands of groups. A site with hundreds of thousands of groups would need a stored scan
instead. HONEST NON-PROOF: no site has been measured.

A `status` filter shows `open` (default), `dismissed` (every pair dismissed), or `all`.

### Response, and masking

Each group row:

- `rule`: `identifier` or `details`.
- `evidence`: for rule 1 the identifier system's label and the value; for rule 2 the names and date of
  birth.
- `members`: each member's `ref` and the same fields a patient list row has. A group shows at most 50
  members. `memberCount` is the full size of the group. Masked, members are ordered by a hash of the
  id, not the id.
- `dismissedPairs`: the count of dismissed pairs in the group.

Masking follows `patient-index.ts` exactly. Without `patients.view_identifiers`:

- Identifier evidence shows `•••` plus the last 4 characters.
- Name evidence shows the first letter then `***`. The date of birth shows the year only.
- Members are masked patient rows, with no raw id.

The masked build reuses `patient-index.ts`'s functions. It does not copy them.

## 4. Access

No new capability.

| Action | Capability |
|---|---|
| See the Duplicates tab and its groups | `patients.view` |
| Dismiss a pair, or undo a dismissal | `patients.manage` |
| Export CSV | `patients.view_identifiers` |

Audit:

- `patients.duplicate.dismiss` and `patients.duplicate.restore`, with both patient ids and the reason.
- `patients.duplicate.export`, with the group count. Never the contents.

## 5. Routes

In `apps/server/src/patient-routes.ts`:

| Route | Capability |
|---|---|
| `GET /api/patients/duplicates?status=&limit=&offset=` | `patients.view` |
| `POST /api/patients/duplicates/dismiss` with body `{ refs, reason }`, where `refs` is two or more patient refs | `patients.manage` |
| `POST /api/patients/duplicates/restore` with body `{ refs }` | `patients.manage` |
| `GET /api/patients/duplicates/export` | `patients.view_identifiers` |

Dismiss writes one row for every pair among `refs` that is not already dismissed. Restore deletes the
rows for every pair among `refs`. Both answer with the number of pairs they changed. The group sheet
sends the group's member refs; the CLI sends two.

`/duplicates` is a static path, so it never collides with `/api/patients/:ref`. A route test proves it.

Fewer than two refs, more than 50 refs, or the same ref twice, is 400. A ref that does not resolve is 404.

The export is a CSV with one row per member of each open group: `group`, `rule`, `system_label`,
`evidence`, `patient_id`, `patient_guid`, `surname`, `firstname`, `date_of_birth`, `sex`,
`managing_facility`. `group` numbers the groups 1, 2, 3 in list order so rows of one group can be read
together. It uses the same CSV writer as the test catalog export (`toCsv` in `@openldr/reporting`),
which guards cells that start with `=`, `@`, `+` or `-`.

## 6. Studio

A third tab, **Duplicates**, on `apps/studio/src/pages/Patients.tsx`. It copies the Identifier
systems tab. Follow `AGENTS.md` §5.

- Toolbar with a Status filter (Open, Dismissed, All). The tab's ⋯ menu has **Export CSV**, shown
  only with `patients.view_identifiers`.
- Columns: rule, evidence, members (count), dismissed pairs.
- Clicking a row opens a group sheet: the evidence, then one row per member with name, sex, age,
  identifiers and managing facility. Each member row has a ⋯ menu with **Open patient**, which opens
  the existing patient sheet.
- With `patients.manage`, the group sheet's ⋯ menu has **Mark as not duplicates**. It dismisses every
  undismissed pair in the group, with an optional reason. A dismissed group's menu has **Show again**,
  which removes its dismissals.
- `TablePagination`, `StripedEmpty` ("No likely duplicates."), `LoadingState`.
- Stale-response guard on load, as the other tabs have.

Dismissing a single pair inside a larger group is a CLI-only action in this slice. In the UI a group
is one decision.

## 7. CLI

`packages/cli/src/patients.ts`:

- `openldr patients duplicates list [--status open|dismissed|all] [--identifiers] [--json]`
- `openldr patients duplicates dismiss <idA> <idB> [--reason <text>]`
- `openldr patients duplicates restore <idA> <idB>`
- `openldr patients duplicates export [--out <file>]`. It is unmasked by nature, so it is audited.

The CLI takes raw patient ids, as `patients show` does.

## 8. Docs and changelog

- A Duplicates section in `apps/studio/src/docs/<current>/{en,fr,pt}/patients.md` and the web page.
- CLI reference and HTTP reference entries.
- Upgrade note: run `openldr db reproject --force` once to fill `match_key`.
- `pnpm make:changelog` after merging.

## 9. Testing

- `match_key`: case, extra spaces, accents (`Émile` and `emile` match), missing surname, first name
  or date of birth gives null, partial dates kept as given.
- Rule 1: a shared NRC across two patients, three patients, a null-system value ignored, a
  non-searchable system ignored, an inactive or merged member left out.
- Rule 2: same key with the same sex, with one sex null, with different sexes (not reported), a
  three-member group where one member conflicts.
- Dismissals: a group hides only when every pair is dismissed; pair order does not matter; restore
  brings it back; the `dismissed` and `all` filters.
- Masking: the whole masked response matches no raw name, identifier, full date of birth or id.
- Routes: capabilities, audit entries, 404 on a bad ref, `/duplicates` not read as a ref.
- CLI and studio tests.
- Migration tests for 026 and 111 on pg-mem, plus compiled SQL for MySQL and SQL Server.

Live check after merging: ingest two patients sharing an NRC and two sharing name and date of birth,
reproject, see both groups, dismiss one, export.
