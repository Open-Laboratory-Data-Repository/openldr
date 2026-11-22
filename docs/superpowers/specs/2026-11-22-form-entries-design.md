# Form entries: design

Status: APPROVED by the operator on 2026-11-22. No code written.
Date: 2026-11-22.
Relates to: `2026-11-22-profile-packs-design.md` (merged), `2026-11-18-roles-scope-design.md`
(the facility limit), `2026-07-31-form-capture-persistence-design.md` (how a submission saves).

## 1. What this is and why

The collection site profile gives a clerk a role, a short sidebar and a form. The operator
looked at the clerk's screen on 2026-11-22 and asked three things:

- Should a clerk see every form?
- Can a clerk see what was entered at their site?
- Can a clerk enter the same order twice?

The answers today are yes, no and yes. A clerk who cannot see, correct or avoid repeating an
entry does not have a usable workplace.

The user actions that are broken today:

- A clerk saves an order and cannot find it again. Nothing lists it.
- A clerk saves the same requisition number twice and gets two orders.
- A clerk who mistypes an entry has no way to withdraw it.
- A clerk sees forms for registering users and facilities.

This is the first of two pieces. The second is the patient on an order: every order entered
through a form has no patient today (`packages/forms/src/extract/extract.ts:229` writes
"Unknown subject"). That piece has its own design later.

## 2. Gap check

| Claim | Verdict | Proof |
|---|---|---|
| Nothing lists what was entered through a form | CONFIRMED | The only form-response route is the one that submits: `apps/server/src/forms-routes.ts:460`. No GET returns submissions. |
| A repeated requisition number is saved twice | CONFIRMED | Proof run of 2026-11-22: requisition CS-0001 submitted twice, both answered 201, two orders exist. Log in the scratch folder `standalone-proof2/logs/`. |
| An order does not record who typed it | CONFIRMED | The submit route puts the username only on the saved form copy: `forms-routes.ts:508` to `511`. The order table has no such column. |
| A user cannot be tied to a site | REFUTED | A user's data limit lists facilities, districts and regions: `packages/bootstrap/src/data-scope.ts:1`. Every request carries it as `req.user.dataScope`: `apps/server/src/auth-plugin.ts:229`. |
| The data limit already filters forms | REFUTED, so the gap is real | It filters dashboards (`apps/server/src/dashboards-routes.ts:89`), plugin pages and CLI routes. Nothing in `forms-routes.ts` reads it. |
| "Entered in error" needs a new status | REFUTED | The FHIR order already has it: `packages/fhir/src/resources/service-request.ts:12`. So does the saved form copy: `packages/fhir/src/resources/questionnaire-response.ts:23`. |
| The seeded forms are plain data entry forms | REFUTED in part | Two of the three drive app pages. "Users" drives the Users page and "Facility" drives the Facilities page: `packages/bootstrap/src/seed.ts:54` to `61`. Only "Lab order" is data entry. |
| A clerk sees the seeded forms | CONFIRMED | Proof run: the Sample Clerk listed four published forms. A form with no access list is open to every role with `forms.view`: `packages/bootstrap/src/form-access.ts:15`. |

## 3. Goals, non-goals, anti-goals

Goals:

- A clerk sees the entries made at their site, newest first, with who made each.
- A requisition number cannot be saved twice at one site, even when two people save at once.
- A clerk can mark an entry as entered in error. It stays visible, struck through, and its
  number becomes free again.
- A clerk tied to one site does not pick the site on the form. It is filled in and locked.
- A clerk does not see the forms that drive app pages, or the seeded Lab order.

Non-goals for this version:

- Editing a saved entry. A lab may already hold the order.
- The patient on an order. Second piece.
- Entries made before this ships. No lab has installed CE, so there are none to carry.
- Setting up a new site's tests and facilities. That belongs with the first-run screen.
- Showing entries in the warehouse reports. Reports already read the order table.

Anti-goals:

- The repeat check must not be a search followed by a save. Two saves at once would both pass.
- The entries list must not show a site's entries to a user limited to another site.
- Marking in error must not delete anything. The record of what was typed stays.
- No clinical vocabulary in the core (AGENTS.md section 8). "Entered in error" is a FHIR
  status, not a new code.

## 4. Approaches

**A. Read the saved form copies.** No new table, and past entries show. The repeat check
becomes a search then a save, which two clerks can beat. Finding entries by site means
reading inside each saved copy.

**B. Read the order table in the warehouse.** No new table. It does not record who typed the
entry, covers only forms that make orders, and the warehouse may be another database, so
the app cannot make a number unique there.

**C. An entries table, written when a form saves.** One row per submission. The list is one
query. A unique rule makes a repeat impossible. The status lives on the row. The cost is one
migration, and entries from before the table do not show.

The operator picked C on 2026-11-22.

## 5. The design

### 5.1 The entries table

One row for each saved submission, in the internal database.

| Column | Holds |
|---|---|
| id | The entry's id |
| form_id | The form |
| facility_id | The site the entry names: the facility register's row id for the facility picked on the form. Null when the form has no facility field. |
| facility_code, facility_name | The facility's code and name at the time, for display only |
| entry_key | The requisition number, from the field bound to the order's identifier. Null when the form has none. |
| summary | A few answers to show in the list, as the form saved them. See 5.3. |
| entered_by | The user's id |
| entered_by_name | The user's display name at the time |
| entered_at | When |
| status | `active`, `incomplete` or `entered-in-error` |
| status_by, status_at, status_reason | Who marked it, when, and why |
| saved | The ids of the records the save made: the form copy, the order, and any sample or result. Filled after the save. |

The repeat rule: at most one row that is `active` or `incomplete` for each `form_id`,
`facility_id` and `entry_key`, where the key is not null. This is a unique index in the
database. A row marked in error no longer blocks the number.

The row stores the register's row id, not the code. A data limit lists register row ids
(`packages/bootstrap/src/data-scope.ts:79`), and a code can change meaning when a second
register adds the same one (`data-scope.ts:72`). The row id stays the same.

Two forms may use the same number. Two sites may use the same number. A form with no
requisition field has no repeat check.

The entry row and the saved records must agree. The submit route writes the row first, inside
the same request, before it runs the save. If the row is refused as a repeat, nothing is
saved.

A save can fail after some records were stored. The route already knows this
(`apps/server/src/forms-routes.ts:568` to `585`). So:

- If the save fails and nothing was stored, the row is removed and the number is free.
- If the save fails and something was stored, the row stays with status `incomplete`. It still
  holds the number, because an order may exist. The list shows it with a "not fully saved"
  mark. A user who may mark entries in error can mark it, which frees the number.

The repeat refusal uses its own error code, `entry-repeat`. The route already answers 409 when
the ingest workflow is off (`forms-routes.ts:556`), and the form must tell the two apart.

### 5.2 The site

A user's data limit already lists the facilities they may see. This design reads it in two
places.

**On the form.** When the user's limit names exactly one facility, the form's facility field
is filled with it and cannot be changed. The server checks this too. A submission that names
another facility is refused with `this entry names a facility outside your limit`. A user
whose limit names several facilities picks among those. A user with no limit picks any.

**In the list.** A limited user sees entries whose `facility_id` is inside their limit, and
entries they made themselves. A user with no limit sees all. So an entry on a form with no
facility field is seen by the person who made it and by users with no limit.

Districts and regions in a limit count too. The builder turns the limit into register row
ids from the register itself. It does not reuse the dashboards' function, which drops any
facility the warehouse has not seen yet (`data-scope.ts:87`). That would hide a new site's
first entry from its own clerk.

**A free-text facility field.** A facility field with no source saves a name and no register
row (`packages/forms/src/extract/extract.ts:193`). A limited user cannot submit a form like
that. The refusal says `this form's facility field is free text, so it cannot be used by a
user limited to a site`. A user limited to nothing at all is refused too.

### 5.3 The list

On the form's page, beside the entry form. The page gains two tabs.

```
Lab request                                            ...
[ New entry ]  [ Entries ]
---------------------------------------------------------
Search requisition                        [ Filter ]
---------------------------------------------------------
REQUISITION   SUMMARY               ENTERED         BY          ...
CS-0003       HIV VL, Amina J.      22 Nov 14:20    proofclerk  ...
CS-0002       CD4, Juma K.          22 Nov 14:05    proofclerk  ...
CS-0001       entered in error      22 Nov 13:50    aisha       ...
---------------------------------------------------------
3 entries                                    1 to 3 of 3
```

The third row is struck through on screen.

- Newest first. `entered_at` then `id`, so the order is stable.
- `TablePagination`, `StripedEmpty` when empty, `LoadingState` while loading.
- The row's dots menu has "View" and "Mark as entered in error".
- "View" opens a Sheet with every answer as it was typed, read only.
- The filter offers status and the person who entered.
- The summary shows up to three answers. Which ones is the form author's choice: a field can
  be flagged "show in entries list" in the form builder. With none flagged, the list shows
  the first three answered fields. The builder decides the flag's name.
- A phone shows the requisition, the summary and the date. The other columns drop.

A user needs `forms.view` to see the list, and must be allowed to open the form.

### 5.4 The repeat refusal

Saving a number that is already active at that site answers 409:

```
CS-0001 was already entered on 22 Nov 2026 at 13:50 by aisha.
```

The form shows this beside the requisition field, with a link "View that entry" that opens
the Sheet. Nothing is saved.

### 5.5 Marking in error

A new capability, `forms.void_entries`. A user needs it and must be able to see the entry.

- The prompt is a Dialog, because it is a destructive confirm. It asks for a reason, which is
  required.
- The row's status becomes `entered-in-error`, with who, when and why.
- Every record the entry made gets the FHIR status `entered-in-error`: the form copy, the
  order, and any sample or result. The row's `saved` column says which records those are. They
  are saved again through the ingest pipeline, so the warehouse order row's `status` column
  changes too.
- Reports are not changed by this design. See 5.5a.
- The number is free to use again.
- It cannot be undone in this version. The prompt says so.
- It is audited as `form.entry.void`, with the row before and after.

### 5.5a Voided orders and reports

Nothing in the reports or dashboards skips an order with status `entered-in-error` today. A
search found no reader of that status. So after this design a voided order still counts in
every existing report until that report filters on status. Reports are content and live in
pack repos. The operator decided on 2026-11-22 that reports do not change in this design.
Making the built-in reports and the country packs leave voided orders out is later work.

The collection site pack's Sample Clerk role gains `forms.void_entries`. The pack repo
changes for that. CE does not name the role.

### 5.6 The forms a clerk should not see

- "Users" and "Facility" drive app pages. They stay installed and those pages keep working.
  The Forms list hides them from a user who does not hold `forms.edit`.
- "Lab order" gets an access list on a new install: Lab Technician and Lab Manager may open
  and submit it. An Administrator always passes. An install that already has the form is
  not changed.

A pack still cannot change a form it did not make. This is a change to what CE seeds.

### 5.7 CLI

- `openldr forms entries <form> [--facility <code>] [--status active|entered-in-error] [--json]`
  lists entries.
- `openldr forms void-entry <id> --reason <text> --force` marks one in error. It refuses
  without `--force`.

Both call the same code as the routes, in `@openldr/bootstrap`, and audit through `cliActor()`.
In served mode the caller's data limit applies. A local run sees everything.

### 5.8 Definition of done

- UI as in 5.3 to 5.5, following AGENTS.md section 5.
- CLI as in 5.7.
- Docs in en, fr and pt: the in-app Forms guide gains the Entries tab, the repeat message and
  marking in error. The web doc on profile packs says the clerk role may hold
  `forms.void_entries`.
- Mobile at 375 wide.
- Changelog after the merge to `main`.

## 6. Calls I made, for the operator to check

- Entries are grouped by site, not by person. The list shows who.
- The repeat check is per form and per site.
- A new capability, `forms.void_entries`, so a role can enter without being able to withdraw.
- Marking in error needs a reason and cannot be undone.
- The two page-driving forms are hidden from the Forms list, not locked.
- The seeded Lab order is limited to Lab Technician and Lab Manager on a new install only.
- A form with no requisition field has no repeat check, and still gets an entries list.
- A save that fails after storing something leaves an `incomplete` entry that holds the number.
- A limited user also sees entries they made themselves.
- A limited user cannot submit a form whose facility field is free text.
- Marking in error marks the sample and results too, not only the order.
- Reports keep counting a voided order until they filter on status.

## 7. Left to the builder

- How the route learns what a failed save stored.
- The name of the "show in entries list" flag and where it sits in the form builder.
- The exact wording of each message, in three languages.
- Whether the Entries tab shows a count.
- The migration number. Check unmerged branches first. The latest on `main` is 135.

## 8. Verification

- Route tests pin the list, the 409 and the void wire shapes.
- pg-mem tests cover the rules. pg-mem has a stable scan order, so the list's order needs its
  unique tiebreaker checked by reading the query, not by a test.
- The unique index must be proven on real Postgres: two saves of one number at once, one 201
  and one 409. pg-mem cannot show this.
- On a clean standalone run: a clerk limited to one site enters an order, sees it in the list,
  is refused a repeat, marks it in error, and enters the number again.
- Bottom-anchored UI needs a real phone. Say so if any is added.
