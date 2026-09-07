# Forms: a version you can see, compare and go back to

Design, 2026-09-07. Closes finding F1 from the forms feedback pass of the same date.
F2 through F5 from that pass shipped separately at `525dfce5`.

## The problem, in the operator's words

> "how does versioning work, I tried changing to v1.1 and didn't seem to do much, like can I view
> other versions?"

Both halves are fair.

Publishing does write a numbered, immutable snapshot, and the API does serve those snapshots. The
studio has no screen that lists them, no way to open one, and no way to go back to one. The single
consumer is `CompareDialog`, which silently picks the newest and offers no choice.

The box labelled Version compounds it. It is a free-text label, not the version number, and the
real version number is never rendered anywhere in the builder. So typing v1.1 changes a caption
nobody sees, and the operator reasonably concludes versioning does not work.

## RULE 0 pass

Eight premises. Each was checked before anything below was designed.

| Premise | Finding |
|---|---|
| Publishing stores a real version snapshot | **CONFIRMED.** `publish()` computes the next integer and inserts schema, questionnaire, metadata, `published_by` and `published_at` into `form_versions`, inside the same transaction that flips the form to published (`store.ts:352-389`). |
| The API already serves versions | **CONFIRMED.** `GET /api/forms/:id/versions` and `GET /api/forms/:id/versions/:version`, both on `VIEW` (`forms-routes.ts:200`, `:209`), backed by `listVersions` and `getVersion` (`store.ts:408-421`). |
| Some restore path already exists | **REFUTED, and this is the whole gap.** Every forms route is listed at `forms-routes.ts:104-306`: list, published, get, create, update, status, publish, duplicate, versions, version, delete, questionnaire, export-bundle, responses. Nothing writes a snapshot back. |
| This needs a migration | **REFUTED.** `form_versions` already carries every column the feature reads, including `published_by` (`019_form_versions.ts:17`) and the full schema and questionnaire blobs. No migration means no numeric-prefix collision with the branches in flight. |
| This needs a new capability key | **REFUTED.** Restore writes a draft, so it is an edit, not a release, and `forms.edit` already gates every write on this resource. Adding one would also no longer be expensive, since capability additions self-backfill through the `capability_introductions` ledger, but it is simply not needed. |
| Comparing two arbitrary versions needs new diff code | **REFUTED at the library, CONFIRMED at the UI.** `diffFormSchemas(before, after)` already takes two arbitrary schemas (`diff.ts:29`). `CompareDialog` hardcodes `loaded[0]` against the live draft and renders no selector (`CompareDialog.tsx:38-45`). The work is a picker, not a diff. |
| The Version box in the header shows the version number | **REFUTED.** It is bound to `schema.versionLabel`, a free string with placeholder "e.g. v1" (`BuilderHeader.tsx:207-216`). The integer `version` is never rendered in the builder at all. |
| Widening the store is contained to `packages/forms` | **REFUTED.** `FormStore` is `ReturnType<typeof createFormStore>` (`store.ts:426`), so adding a method widens the interface, and `apps/server/src/forms-routes.test.ts:225` holds a hand-written fake that must gain it. This is the same third-package breakage the RBAC work hit twice; no typecheck of `packages/forms` will catch it. |

## Scope

**In.**

- A version history sheet in the builder, listing every published version.
- Restore: a route, a store method, a confirm, and a CLI command.
- Compare between any two of current draft and the published versions.
- Header honesty: relabel the free-text field, and show the real published version.
- CLI parity, English docs, mobile pass, changelog.

**Out, and why.**

- **The publisher's name.** `published_by` holds an actor id (`store.ts:374`). Rendering a raw id
  helps nobody, and resolving it client-side needs `listUsers`, which is gated on a capability a
  forms editor need not hold. Resolving it server-side is a join this slice does not otherwise
  need. Version rows therefore show the date, not the person. Say so and let the operator pull it
  in if the audit trail is not enough. The audit row for the publish already names the actor.
- **Restore from the Forms list.** Restore overwrites the draft on screen. It belongs where the
  operator can see what is about to be overwritten.
- **Deleting or pruning versions.** Snapshots are the record. Nothing today asks to remove one.
- **Semantic version numbers or an auto-incrementing label.** The label is free text on purpose.
  This design makes it legible, it does not take it over.

## Design

### 1. Restore is an edit, not a release

`ctx.forms.restore(id, version, { actorId })` reads the snapshot and writes its schema, name,
resource type, FHIR version, profile URL and target pages over the current form through the same
path `update()` takes.

That reuse is the load-bearing part. `update()` already demotes a published form to draft when its
content changes (`store.ts:301`). Restore inherits that rule for free: restoring into a published
form drops it back to draft, exactly as hand-editing it would, and the sync capture behaves the same
way it already does for an edit. A restore that quietly left a form published while changing its
content would mean labs mirroring a body no version row describes.

The version label is restored along with the schema. Restoring v2 and getting v5's label would be
the same class of lie this design exists to remove.

Restore does not create a version row. Snapshots record releases, not edits. The operator publishes
afterwards if they want the restored content released, and that publish gets the next number.

### 2. The route

`POST /api/forms/:id/restore/:version`, gated on `forms.edit`.

`:version` is validated with the same positive-integer guard the read route already uses
(`forms-routes.ts:211-218`), so a bad path segment is a 400 with a message, not a cast. An unknown
version is a 404. Audited as `form.restore`, with before, after, and the source version in the
payload. Audit actions are free strings in this repo, with no catalog to register in.

A snapshot that fails today's lint restores anyway. It lands as a draft, and the publish gate
already refuses to release a schema with errors, so the operator sees the problem in the place that
already reports it rather than being blocked from looking at their own history.

### 3. The version history sheet

Opened from the builder ⋯ menu, next to Compare. A shadcn `Sheet`, following
`FieldEditorSheet.tsx` for shape.

Rows, newest first: version number, label, published date. Per-row ⋯ with **Restore** and
**Compare with draft**. A `Table` with `TablePagination`, per section 5 of `AGENTS.md`, including
the rule that a list which looks short today still gets it.

Restore goes through a destructive `ConfirmDialog` naming the version and the form, because it
overwrites what is on screen. On success the builder's schema state is replaced, a toast confirms
it, and the sheet closes. The result is an unsaved draft in the builder, consistent with every
other builder edit, so the operator can still walk away.

Restore pushes onto the builder's undo stack (`useTemplateHistory.pushHistory`, the same call
`deleteField` and `reorderFields` make), so the keyboard undo puts the previous draft back. Without
this, restore would be the one builder action that cannot be taken back, which is the opposite of
what a version history is for.

### 4. Compare gains two ends

Two selects: left and right. Options are Current draft plus every published version, defaulting to
draft on the right and newest published on the left. Today's behaviour is therefore still what you
get without touching anything.

`diffFormSchemas` is unchanged. `CompareDialog` stops reaching for `loaded[0]` and reads whichever
two the selects name, fetching a snapshot through `getFormVersion` when the side is not the draft.

### 5. The header stops lying

Relabel the input to **Version label**, and keep the free-text behaviour.

Next to the status dot, show the published version, for example `v3` when the newest snapshot is
version 3, and nothing at all when the form has never been published. This is the smallest change
that answers the original question, and it makes the label's role obvious by contrast.

### 6. CLI

```
openldr forms versions <id> [--json]
openldr forms restore <id> <version> --force
```

Both take `createAppContext(loadConfig())` and call `ctx.forms`, the way `runFormsList` already
does (`packages/cli/src/forms.ts:28-45`), so the route and the CLI run identical store code with
nothing duplicated. Restore refuses without `--force` and audits with `actorName: 'cli'`.

## Error handling

- Unknown form: 404, message names the id.
- Unknown version: 404, message names the version.
- Non-integer version in the path: 400, reusing the existing guard.
- Missing `forms.edit`: the standard capability refusal.
- In the studio, every failure surfaces the server's own message through the toast path added in
  `525dfce5`. No new error surface.

## Testing

| Layer | What it pins | What it does not |
|---|---|---|
| `packages/forms` store, pg-mem | Restore writes the snapshot back; restoring into a published form demotes it to draft; the label travels with the schema; no version row is created | Concurrency. pg-mem is not Postgres. |
| `apps/server` route | Wire shape, the 400 and both 404s, the `forms.edit` gate, and the `form.restore` audit row | Nothing about the UI. |
| `apps/studio` | The sheet lists versions and paginates; Restore confirms before calling; Compare honours both selects; the header shows the published version and the relabelled field | Layout. jsdom has no viewport. |
| `packages/cli` | Both commands, and that restore refuses without `--force` | Nothing about the route. |

Mobile is a separate, manual pass at 375x812 against the four table traps in section 6. Headless
Chromium cannot see the `vh` versus `dvh` class of bug, so anything bottom-anchored gets reported as
unverified rather than verified.

## Sequencing

Four slices, each shippable.

1. **Store and route.** `restore` plus `POST /restore/:version`, with tests. Nothing user-visible.
2. **The sheet.** Version history, restore, confirm, pagination. This is the slice that answers the
   operator's question.
3. **Compare.** The two selectors.
4. **Header, CLI, docs.** Relabel, published version, both commands, English `forms.md`.

Slice 1 must land before 2. Slices 3 and 4 are independent of each other.

## Known traps

- `apps/server/src/forms-routes.test.ts:225` holds a `forms` fake that widening `FormStore` breaks.
  Neither the `packages/forms` typecheck nor its tests will catch it.
- Migrations are strictly ordered and a gap blocks boot. This design adds none, deliberately, while
  other branches are in flight.
- `fr` and `pt` have no `forms.md`. The docs registry falls back to English at `registry.ts:351`, so
  the English edit is sufficient and nothing renders broken.
