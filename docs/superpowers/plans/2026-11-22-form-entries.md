# Form entries implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clerk sees what was entered at their site, cannot save a requisition number twice, and can mark an entry as entered in error.

**Architecture:** One new table, `form_entries`, gets a row for each saved form submission. A unique index makes a repeat impossible. The submit route writes the row before it runs the save. A user's existing data limit decides which entries they see and which facility a form may name. Marking in error re-saves the entry's records with the FHIR status `entered-in-error`.

**Tech stack:** TypeScript, zod, Kysely on Postgres, Fastify, React with shadcn, vitest, pg-mem.

**Spec:** `docs/superpowers/specs/2026-11-22-form-entries-design.md`. Read it before any task. It is the authority.

## Global constraints

- Work on branch `feat/form-entries`. A worktree reads the dev `.env`, so nothing may open the dev databases. Never use ports 3000, 5433, 3210 or 54320.
- Migration `136_form_entries`. Checked on 2026-11-22: no branch claims 136. Check again before adding it.
- The repeat check is a unique index, never a search then a save.
- Entry statuses are exactly `active`, `incomplete`, `entered-in-error`.
- The row stores the facility register's row id as `facility_id`. Code and name are for display.
- A limited user sees entries whose `facility_id` is inside their limit, and entries they made.
- Marking in error deletes nothing.
- Reports and dashboards are not changed.
- No clinical vocabulary in CE source. `entered-in-error` is a FHIR status.
- Studio: actions in a dots menu, sheets not dialogs except a destructive confirm, shadcn only, `TablePagination` on every table, `StripedEmpty` and `LoadingState`, strings in en, fr and pt.
- Shared logic lives in `@openldr/bootstrap` so the route and the CLI call the same code. CLI commands audit through `cliActor()`. Destructive commands refuse without `--force`.
- No em dashes in anything written. No `Co-Authored-By` trailer.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`. Never read `$?` through a pipe.

## Review focus

1. Two submissions of one requisition number at the same instant. One saves, one gets 409 `entry-repeat`. Proven on real Postgres. (Tasks 1 and 11)
2. A save that fails after storing an order. The entry stays as `incomplete` and still blocks the number. (Task 4)
3. A user limited to site A asks for the entries of site B, by list filter and by entry id. Refused or empty, never shown. (Task 5)
4. A limited user submits naming a facility outside their limit, or on a form whose facility field is free text. Refused, nothing saved. (Task 4)
5. Marking in error an entry already marked, or an `incomplete` entry with no saved records. No crash, a clear answer. (Task 6)

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/src/migrations/internal/136_form_entries.ts` | The table and its unique index |
| `packages/db/src/form-entry-store.ts` | Read and write entries |
| `packages/rbac/src/catalog.ts`, `presets.ts` | The `forms.void_entries` capability |
| `packages/forms/src/entry-fields.ts` | Which fields of a form are its facility, its requisition number and its list summary |
| `packages/bootstrap/src/form-entries.ts` | The rules: site check, list filter, record, finish, void |
| `apps/server/src/forms-routes.ts` | Submit wiring |
| `apps/server/src/form-entry-routes.ts` | List, read, void, entry context |
| `packages/bootstrap/src/seed.ts` | The seeded Lab order's access list |
| `packages/cli/src/form-entries.ts` | The two CLI commands |
| `apps/studio/src/pages/FormCapture.tsx`, `apps/studio/src/forms-entries/*` | The tabs, the list, the sheet, the dialog |

---

### Task 1: The entries table and store

**Files:**
- Create: `packages/db/src/migrations/internal/136_form_entries.ts`, `packages/db/src/form-entry-store.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/form-entry-store.test.ts`

**Interfaces:**
- Produces:

```ts
export type FormEntryStatus = 'active' | 'incomplete' | 'entered-in-error';
export interface FormEntrySaved { responseId: string | null; resources: { resourceType: string; id: string }[] }
export interface FormEntry {
  id: string; formId: string;
  facilityId: string | null; facilityCode: string | null; facilityName: string | null;
  entryKey: string | null; summary: { label: string; value: string }[];
  enteredBy: string; enteredByName: string; enteredAt: string;
  status: FormEntryStatus; statusBy: string | null; statusAt: string | null; statusReason: string | null;
  saved: FormEntrySaved | null;
}
export interface NewFormEntry { formId: string; facilityId: string | null; facilityCode: string | null; facilityName: string | null; entryKey: string | null; summary: { label: string; value: string }[]; enteredBy: string; enteredByName: string }
export class FormEntryRepeat extends Error { constructor(readonly existing: FormEntry) }
export interface FormEntryFilter { formId: string; facilityIds?: string[]; orEnteredBy?: string; status?: FormEntryStatus; enteredBy?: string; search?: string; limit: number; offset: number }
export interface FormEntryStore {
  /** Throws FormEntryRepeat when the unique index refuses it. */
  create(input: NewFormEntry): Promise<FormEntry>;
  get(id: string): Promise<FormEntry | null>;
  list(filter: FormEntryFilter): Promise<{ entries: FormEntry[]; total: number }>;
  setSaved(id: string, saved: FormEntrySaved, status: 'active' | 'incomplete'): Promise<FormEntry>;
  remove(id: string): Promise<void>;
  /** Null when the entry is already entered-in-error. */
  void(id: string, by: { id: string; reason: string }): Promise<FormEntry | null>;
}
export function createFormEntryStore(db: Kysely<InternalSchema>): FormEntryStore;
```

The unique index: `(form_id, coalesce(facility_id, ''), entry_key)` where `entry_key is not null and status in ('active', 'incomplete')`. `create` catches the unique violation, reads the row that holds the number, and throws `FormEntryRepeat` with it. `list` orders by `entered_at desc, id desc`. With `facilityIds` and `orEnteredBy` both set, a row matches if either does. `search` matches `entry_key` by prefix, case-insensitive.

- [ ] **Step 1: Write failing tests:** create then get; a second active row with the same form, facility and key throws `FormEntryRepeat` carrying the first; the same key at another facility saves; the same key on another form saves; a null key never repeats; after `void` the key saves again; an `incomplete` row blocks the key; `list` orders newest first with `id` as tiebreaker; the `facilityIds` or `orEnteredBy` rule; `void` on a voided row returns null.
- [ ] **Step 2: Run** `pnpm --filter @openldr/db test -- form-entry-store` and see them fail.
- [ ] **Step 3: Write the migration, register it, add the table type, write and export the store.** If pg-mem cannot build the partial expression index, keep the real index in the migration, say so in a comment, and make the store's repeat detection work on both.
- [ ] **Step 4: Run** `pnpm --filter @openldr/db test` and `pnpm --filter @openldr/db typecheck`. Expect pass.
- [ ] **Step 5: Commit** `feat(db): a table of form entries, with one active entry per requisition number`

### Task 2: The capability

**Files:**
- Modify: `packages/rbac/src/catalog.ts`, `packages/rbac/src/presets.ts`
- Test: `packages/rbac/src/catalog.test.ts`, `packages/rbac/src/presets.test.ts`

**Interfaces:**
- Produces: capability key `forms.void_entries`, group `forms`, label `Mark entries as entered in error`. Lab Manager holds it. Administrator holds every key already. Lab Technician, Data Analyst and System Auditor do not.

- [ ] **Step 1: Write failing tests** for the key and for which preset roles hold it.
- [ ] **Step 2: Run** `pnpm --filter @openldr/rbac test` and see them fail.
- [ ] **Step 3: Add the key and the preset.** Check how an existing install picks up a new capability on a system role (`seedSystemRoles` in `packages/db/src/role-store.ts`) and follow it.
- [ ] **Step 4: Run the tests and typecheck.** Expect pass.
- [ ] **Step 5: Commit** `feat(rbac): a capability to mark form entries as entered in error`

### Task 3: Which fields make an entry

**Files:**
- Create: `packages/forms/src/entry-fields.ts`
- Modify: `packages/forms/src/index.ts`, the form field schema file that holds `observationExtract`, and the Questionnaire round trip in `packages/forms/src/extensions.ts`
- Test: `packages/forms/src/entry-fields.test.ts`

**Interfaces:**
- Produces:

```ts
/** A field flag: show this answer in the entries list. Round-trips through the Questionnaire. */
// on the form field schema: entriesList?: boolean
export interface EntryFields {
  /** The field bound to ServiceRequest.identifier or .identifier.value, if any. */
  keyFieldId: string | null;
  /** The facility field that fills the order's requester, if any. */
  facilityFieldId: string | null;
  /** True when that field picks from the facility register; false when it is free text. */
  facilityFromRegister: boolean;
}
export function entryFieldsOf(schema: FormSchema): EntryFields;
/** The requisition number, the picked facility coding and the list summary from one set of answers. */
export function entryValuesOf(schema: FormSchema, answers: Record<string, unknown>): {
  entryKey: string | null;
  facility: { system?: string; code: string; display?: string } | null;
  summary: { label: string; value: string }[];   // flagged fields, else the first three answered, at most three
};
```

Find the requisition and facility fields the same way the ServiceRequest extractor does (`packages/forms/src/extract/extract.ts`, the identifier binding near line 265 and the requester near line 274). Export what the extractor uses, or move it, so the rule exists once.

- [ ] **Step 1: Write failing tests:** the seeded Lab order's fields are found; a form with no order binding gives nulls; a free-text facility field gives `facilityFromRegister: false`; flagged fields make the summary in form order; with none flagged the first three answered fields are used; the flag survives a Questionnaire round trip.
- [ ] **Step 2: Run** `pnpm --filter @openldr/forms test -- entry-fields` and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @openldr/forms test` and typecheck. Expect pass.
- [ ] **Step 5: Commit** `feat(forms): find a form's requisition, facility and list summary fields`

### Task 4: Record an entry when a form saves

**Files:**
- Create: `packages/bootstrap/src/form-entries.ts`
- Modify: `packages/bootstrap/src/index.ts` (wire the store and the service onto the app context), `apps/server/src/forms-routes.ts` (the submit handler)
- Test: `packages/bootstrap/src/form-entries.test.ts`, `apps/server/src/forms-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 store, Task 3 functions, `DataScope` from `@openldr/rbac`.
- Produces:

```ts
export class EntrySiteError extends Error { constructor(message: string, readonly reason: 'outside-limit' | 'free-text-facility' | 'empty-limit') }
export interface FormEntriesService {
  /** The facility register row ids a limit covers. Null means no limit. Reads the register itself. */
  facilityIdsOf(scope: DataScope): Promise<string[] | null>;
  /** Checks the site rules, then writes the row. Throws EntrySiteError or FormEntryRepeat. */
  begin(input: { form: { id: string; schema: FormSchema }; answers: Record<string, unknown>; user: { id: string; name: string; dataScope: DataScope } }): Promise<FormEntry>;
  /** After the save: `stored` is what the save left behind. ok true means it completed. */
  finish(entryId: string, outcome: { ok: boolean; stored: FormEntrySaved }): Promise<FormEntry | null>;
}
```

`finish` rules: ok gives `active` with `saved`. Not ok with nothing stored removes the row and returns null. Not ok with something stored gives `incomplete` with `saved`.

Site rules in `begin`, with exact messages:

| Condition | Message |
|---|---|
| Limited user, limit covers no facility | `your data limit names no facility, so you cannot enter this form` |
| Limited user, the form's facility field is free text | `this form's facility field is free text, so it cannot be used by a user limited to a site` |
| Limited user, the facility named is outside the limit | `this entry names a facility outside your limit` |

The submit route: after validation and before the save, call `begin`. `EntrySiteError` answers 403 `{ error }`. `FormEntryRepeat` answers 409 `{ error: 'entry-repeat', message, entry: { id, entryKey, enteredAt, enteredByName } }` with the message `<key> was already entered on <date> at <time> by <name>.` After the save, call `finish` with what the run stored. The route already works out what a failed run stored (near lines 568 to 611); use that. The success body gains `entryId`.

- [ ] **Step 1: Write failing tests** for each row of the table, the three `finish` rules, the 409 body, the 403 body, and Review focus 2 and 4. Route tests run through the real route with a fake workflow runner.
- [ ] **Step 2: Run** the bootstrap and server test files and see them fail.
- [ ] **Step 3: Implement and wire.** Keep `return` on every reply path.
- [ ] **Step 4: Run** test, typecheck for both packages and `pnpm --filter @openldr/server lint`. Expect pass.
- [ ] **Step 5: Commit** `feat(server): a saved form records an entry, and a repeated requisition number is refused`

### Task 5: List and read entries

**Files:**
- Create: `apps/server/src/form-entry-routes.ts`
- Modify: `packages/bootstrap/src/form-entries.ts`, the file that registers routes
- Test: `apps/server/src/form-entry-routes.test.ts`, `packages/bootstrap/src/form-entries.test.ts`

**Interfaces:**
- Produces on the service: `list(input: { formId; user: { id; dataScope }; status?; enteredBy?; search?; limit; offset }): Promise<{ entries: FormEntry[]; total: number }>`, `get(id, user): Promise<FormEntry | null>` (null when the user may not see it), and `context(form, user): Promise<{ facility: { id: string; code: string; name: string } | null; locked: boolean; choices: { id: string; code: string; name: string }[] | null }>`.
- Produces on the wire:
  - `GET /api/forms/:id/entries?status=&enteredBy=&search=&limit=&offset=` returns `{ entries, total }`. Needs `forms.view` and the form open to the caller.
  - `GET /api/forms/entries/:entryId` returns the entry plus `answers`, read from the saved form copy. 404 when the caller may not see it.
  - `GET /api/forms/:id/entry-context` returns `context`. `locked` is true when the limit covers exactly one facility. `choices` lists the facilities of a limit that covers several, null for no limit.

- [ ] **Step 1: Write failing tests,** including Review focus 3 by list and by id.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test, typecheck and lint. Expect pass.
- [ ] **Step 5: Commit** `feat(server): list and read the entries of a form, within the user's data limit`

### Task 6: Mark an entry as entered in error

**Files:**
- Modify: `packages/bootstrap/src/form-entries.ts`, `apps/server/src/form-entry-routes.ts`
- Test: the two test files of Task 5

**Interfaces:**
- Produces on the service: `voidEntry(input: { entryId; reason: string; user: { id; name; dataScope }; actor: AuditActor }): Promise<{ entry: FormEntry; resaved: number } | 'not-found' | 'already-void'>`.
- Produces on the wire: `POST /api/forms/entries/:entryId/void` with `{ reason }`. Needs `forms.void_entries`. 400 for an empty reason, 404 when unseen, 409 `{ error: 'already-void' }`, else `{ entry }`.

How it re-saves: for each record in the entry's `saved`, read it from the FHIR store, set `status` to `entered-in-error` where the resource type has that status, and send them as one bundle through the same ingest workflow the submit route uses. An entry with no saved records only changes its row. The row changes first. A failed re-save is reported in the answer and audited, and the row stays voided.

Audit `form.entry.void` with the row before and after and the count re-saved.

- [ ] **Step 1: Write failing tests,** including Review focus 5.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test, typecheck and lint. Expect pass.
- [ ] **Step 5: Commit** `feat(server): mark a form entry as entered in error`

### Task 7: Which forms a user sees

**Files:**
- Modify: `apps/server/src/forms-routes.ts` (`GET /api/forms`), `packages/bootstrap/src/seed.ts`
- Test: `apps/server/src/forms-routes.test.ts`, `packages/bootstrap/src/seed.test.ts`

**Interfaces:**
- `GET /api/forms` leaves out a form that has `targetPages` set when the caller lacks `forms.edit`. `GET /api/forms/published?targetPage=` is unchanged, so the Users and Facilities pages keep working.
- On a new install the seed sets the Lab order's access list to open and submit for the `lab_technician` and `lab_manager` roles. An install that already has the form is not changed.

- [ ] **Step 1: Write failing tests:** a caller without `forms.edit` does not get Users or Facility from `GET /api/forms` and still gets them from the `targetPage` call; a fresh seed sets the list; a second seed run leaves a changed list alone.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test, typecheck and lint. Expect pass.
- [ ] **Step 5: Commit** `feat(forms): hide page forms from the forms list, and limit the seeded Lab order`

### Task 8: CLI

**Files:**
- Create: `packages/cli/src/form-entries.ts`
- Modify: `packages/cli/src/program.ts` (under the `forms` command near line 1293), `packages/cli/src/command-meta.ts`, `docs/CLI-REFERENCE.md`
- Test: `packages/cli/src/form-entries.test.ts`

**Interfaces:**
- `openldr forms entries <form> [--status active|incomplete|entered-in-error] [--entered-by <user id>] [--search <requisition prefix>] [--limit N] [--offset N] [--json]`. `<form>` is a form id or name.
- `openldr forms void-entry <id> --reason <text> --force`. Without `--force` it prints the entry and exits 1.
- Both call the service of Tasks 5 and 6. Served mode uses the caller's data limit and capabilities. A local run has no limit. Audit through `cliActor()`.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run** `pnpm --filter @openldr/cli test -- form-entries` and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test and typecheck. Expect pass.
- [ ] **Step 5: Commit** `feat(cli): list form entries and mark one as entered in error`

### Task 9: Studio

**Files:**
- Modify: `apps/studio/src/pages/FormCapture.tsx`, `apps/studio/src/api.ts`, the form builder's field editor sheet (`apps/studio/src/forms-builder/FieldEditorSheet.tsx`), `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Create: `apps/studio/src/forms-entries/EntriesTab.tsx`, `EntrySheet.tsx`, `VoidEntryDialog.tsx`
- Test: matching `.test.tsx` files

**What to build,** from spec sections 5.2 to 5.5:
- `FormCapture` gains two tabs, "New entry" and "Entries". Guard the hidden tab with `data-[state=inactive]:hidden`.
- The facility field is filled and read only when `entry-context` says `locked`. With `choices`, the picker offers only those.
- A 409 `entry-repeat` shows the message beside the requisition field with a "View that entry" link that opens the sheet. A 403 shows its message at the top of the form.
- The Entries tab: a table with requisition, summary, entered and by, a search box, a filter for status and person, `TablePagination`, `StripedEmpty`, `LoadingState`. A voided row is struck through. An `incomplete` row shows "not fully saved". The row's dots menu has "View" and, with `forms.void_entries`, "Mark as entered in error". Render the table only when it has rows. At phone width show requisition, summary and date.
- `EntrySheet` shows every answer read only, with who and when, and the void details when voided.
- `VoidEntryDialog` is a Dialog because it is a destructive confirm. Say so in a comment. It needs a reason, says it cannot be undone, and stays open with the message on failure.
- The field editor sheet gains "Show in entries list", label left and input right.

- [ ] **Step 1: Write failing tests** for the lock, the repeat message, the list states, the dots menu by capability, and the dialog.
- [ ] **Step 2: Run** the studio test files and see them fail.
- [ ] **Step 3: Implement, every string in three languages.**
- [ ] **Step 4: Run** `pnpm --filter @openldr/studio test` and typecheck. Expect pass.
- [ ] **Step 5: Commit** `feat(studio): the entries of a form, and marking one as entered in error`

### Task 10: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` and `profile-packs.md`; `apps/web/src/docs/0.1.8/{en,fr,pt}/profile-packs.md`

The Forms guide gains: the Entries tab, what a clerk limited to a site sees, the repeat message, marking in error, and the "not fully saved" mark. Say plainly that a voided order still counts in reports. The profile pack guides say a role may hold `forms.void_entries`. Follow `apps/studio/src/docs/HOW-TO-TEMPLATE.md` and `.claude/skills/unslop/SKILL.md`. Quote screen labels from the i18n files word for word.

- [ ] **Step 1: Write the changes in three languages.**
- [ ] **Step 2: Run** the studio docs tests and the web content test. Expect pass.
- [ ] **Step 3: Commit** `docs: form entries`

### Task 11: The pack, the proof and the gate

**Files:**
- Modify: repo `~/Projects/Repositories/openldr-ce-content-pack-collection-site` (the Sample Clerk gains `forms.void_entries`; version 0.3.0; the CE range names the first release with form entries, or stays as is with a note)

- [ ] **Step 1: Update, rebuild and sign the pack** with the throwaway key under the scratch folder. Commit in that repo. Do not push.
- [ ] **Step 2: Prove it on a new clean standalone run,** own data folder, own ports, `OPENLDR_SKIP_ENV_FILE=true`. As admin: install the pack, add a facility and switch on a test, create a clerk limited to that facility. As the clerk: open the entry context and see the facility locked; submit CS-0001; list entries and see it; submit CS-0001 again and get 409 `entry-repeat`; mark it in error with a reason; submit CS-0001 again and get success; list and see both rows. As a second clerk limited to another facility: list and see none; read the first clerk's entry by id and get 404.
- [ ] **Step 3: Prove the index on real Postgres.** Send two submissions of one new number at the same instant, ten times over with ten numbers. Each pair gives exactly one success and one 409, and one order.
- [ ] **Step 4: Look at it.** Start that run, open the Entries tab and the dialog at desktop width and at 375 by 812, and send the operator the screenshots.
- [ ] **Step 5: Run both gate commands** from Global constraints. Grep for `out of memory`, `VirtualAlloc` and `Test timed out` before reading a failure as a regression.
- [ ] **Step 6: Report to the operator.** Merge only when told. After a merge run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json`.

## Not proved by this plan

- A real phone. Say so for any bottom-anchored UI.
- A served CLI run against a live server.
- That reports leave voided orders out. They do not, by design.
