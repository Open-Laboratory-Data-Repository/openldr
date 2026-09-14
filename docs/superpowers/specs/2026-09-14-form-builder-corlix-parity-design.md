# Form builder: match corlix

Date: 2026-09-14. Status: design, approved in chat, not built.

The operator asked for CE's form builder to act the same as corlix's. Corlix is the sibling
desktop app at `~/Projects/Repositories/corlix`. Match the behavior first and add nothing
beyond it. The code can differ. The UI should behave the same.

This spec covers the builder only. Data entry changes come later, as one separate step.
Section 9 lists them.

This is the second parity pass. The first, in June, is
`2026-06-18-form-builder-parity-design.md` plus the `2026-06-19-forms-corlix-*` specs SP-A
to SP-F. This one covers what corlix added after that, mostly its P13 to P15 work of
2026-08-25 to 08-28, plus older corlix features the June pass left unbuilt.

---

## 1. Which user action is broken today

AGENTS.md §4 asks this before any feature. Here the operator's parity request is the reason.
Each row in section 3 names the action a CE author cannot take today and a corlix author can.

The biggest three:

- **An author cannot tell two slots of one FHIR list apart.** CE's seeded Facility form
  binds a field to `Location.identifier.value` with `fhirDiscriminator: { system: … }`
  (`packages/forms/src/samples/forms.ts:53`). No file in `apps/studio/src` reads
  `fhirDiscriminator`. So the row doesn't show it and the editor can't change it.
- **CE warns about a missing discriminator and offers no way to add one.**
  `lint-fhir-path.ts:88` raises `fhir-path-cardinality` when a path passes through a list
  with no discriminator. The builder has no discriminator control.
- **An author cannot see the preview on a phone.** The preview pane is `hidden md:block`
  (`FormBuilderPage.tsx:376`).

---

## 2. How this was checked

Every row in section 3 was checked against CE's code with a cited line. Corlix's behavior
was checked in two ways:

1. Its specs and programme rows: `docs/superpowers/specs/2026-08-26-form-builder-authoring-design.md`,
   and `PROGRAMME.md` rows P13 to P15.
2. **Running it.** On 2026-09-14 I ran corlix's 14 form builder e2e specs against the
   built Electron app. All 14 passed in 1.3 minutes:

   ```
   cd ~/Projects/Repositories/corlix/apps/desktop
   pnpm run test:e2e p13 p14 p15 fhir-binding-smoke conditional-logic-smoke
   ```

   Their screenshots in `apps/desktop/test-output/` are the visual target for this work.

Where corlix's spec and corlix's shipped code disagree, **the shipped code wins**. Two cases
matter here:

- Corlix's spec says the discriminator element comes from a picker derived from the parent
  type. What shipped is a plain text box, visible in `test-output/p13-3/03-any-join.png`.
  CE matches the text box.
- Corlix's spec says a missing-discriminator warning fires on any repeating path. What
  shipped fires only when a sibling on the same path has one. See A2.

---

## 3. Verdict table

24 rows: 20 confirmed, 3 refuted, 1 convention-conflict.

| ID | Corlix does this, CE does not | Verdict | Proof in CE | Slice |
|----|------|------|------|------|
| A1 | Show the discriminator on the field row | CONFIRMED | No studio file reads `fhirDiscriminator` | S1 |
| A2 | Warn when a slot has no discriminator | REFUTED | CE warns already, more broadly, `lint-fhir-path.ts:88` | none |
| A3 | Discriminator editor with All/Any and three operators | CONFIRMED | No editor. Schema is a key/value map only, `form-schema.ts:75` | S2 |
| A4 | A group repeats only when its binding or cap says so | CONFIRMED | `to-questionnaire.ts:108` always writes `repeats: true` | S1 |
| A5 | Starter packs, a pre-checked list per resource type | CONFIRMED | "starter pack" appears nowhere in apps or packages | S5 |
| A6 | Corlix's pack chooser is a Dialog with footer buttons | CONVENTION-CONFLICT | AGENTS.md §5 wants a sheet with a `⋯` menu | S5 |
| A7 | Suggested codes, labeled by source, with an undoable import | CONFIRMED | No suggestion code in `forms-builder` | S7 |
| A8 | Preview is a sheet opened from the `⋯` menu | CONFIRMED | Split pane, hidden on phones, `FormBuilderPage.tsx:376` | S3 |
| A9 | Mapping sits above Codes in the field editor | CONFIRMED | Order is Codes, Translations, Mapping, `FieldEditorSheet.tsx:293,303,313` | S2 |
| A10 | Library pane: elements and pack entries the form lacks | CONFIRMED | No such pane | S3, S5 |
| A11 | Form and Library become tabs on a narrow workspace | CONFIRMED | Needs A10 | S3 |
| A12 | A repeating element draws as one node with its slots | CONFIRMED | The list nests one level by `groupId`, `FieldListPane.tsx:105` | S1 |
| A13 | Add a slot or a group part from the tree | CONFIRMED | Needs A12 | S2 |
| A14 | BackboneElement sub-fields become pickable | REFUTED | CE's path table has them: `Specimen.collection.bodySite`, `Patient.contact.address.city` | none |
| A15 | A Questionnaire form hides the Mapping block | CONFIRMED | Offered at `BuilderHeader.tsx:73`, Mapping still shows | S2 |
| A16 | Groups sit inside groups, to any depth | CONFIRMED | Group picker hidden on a group, `FieldEditorSheet.tsx:185` | S1 |
| B1 | Select many fields, act on them together | CONFIRMED | `selectAll: () => undefined`, `FormBuilderPage.tsx:183`. Planned in June at `2026-06-18-form-builder-parity-design.md:136-137`, never built | S4 |
| B1b | Corlix's bulk bar uses standalone buttons | CONVENTION-CONFLICT, merged into B1 | AGENTS.md §5, header actions go in `⋯` | S4 |
| B2 | Drag a field onto a section to move it | CONFIRMED | No drop target in `forms-builder` | S4 |
| B3 | Bind options to a ValueSet picked from a list | CONFIRMED | Free-text URL box, `MappingEditor.tsx:134` | S6 |
| B4a | Show the element's standard binding, and auto-bind on path pick | CONFIRMED | No element-to-ValueSet table in CE | S6 |
| B4b | FHIR R4 ValueSets exist on every install | REFUTED in part | CE ships the same catalog and imports it, but only under `SEED_ON_START` or factory reset. See S6 | S6 |
| B5 | Edit a section's visibility rule | CONFIRMED | Schema has it, `form-schema.ts:104`. `SectionsManager.tsx` has no editor | S4 |
| B6 | Locked fields cannot be disabled or deleted | CONFIRMED | Schema has `locked`, `form-schema.ts:95`. The builder never reads it | S2 |
| B8 | Set up a reference field in the editor | CONFIRMED | Schema has six `reference*` keys, `form-schema.ts:80-85`. No builder file reads them | S2 |

B1b is counted inside B1. B7 is section 9.

**Already the same in both apps**, so nobody rebuilds them: undo and redo, keyboard
shortcuts, field search, field visibility, languages and translations, codes with term search,
target pages, Questionnaire export, lifecycle status, min and max items.

**CE has and corlix lacks.** Every slice keeps these working: the version history sheet,
compare any two versions, and the submission readiness panel.

---

## 4. Approach

Port by behavior into CE's own layout. Do not copy corlix files. Corlix talks to Electron IPC
and SQLite, and CE talks to Fastify and Postgres.

| Kind of code | Goes in |
|---|---|
| Pure form logic shared by lint, export and studio | `packages/forms/src/` |
| FHIR tables | `packages/fhir/src/paths/`, next to `r4-paths.generated.ts` |
| Tables and stores | `packages/db` |
| Routes | `apps/server/src/forms-routes.ts` |
| UI | `apps/studio/src/forms-builder/`, following AGENTS.md §5 |

Corlix's unit tests for each module are the checklist for its CE port.

**UI strings stay plain English.** CE's builder uses literal strings today, for example
`<SheetTitle>Edit Field</SheetTitle>` in `FieldEditorSheet.tsx:99`. New builder UI follows
that. Docs still ship in en, fr and pt.

**No CLI commands.** Form authoring is not an admin, settings or maintenance feature, so
AGENTS.md §6's CLI rule does not apply. Starter packs are read-only seeded data, and corlix
has no pack editing either.

---

## 5. Slices

Seven slices, in order. S1 to S4 change `packages/forms` and the studio only. S5 to S7 add
server code and data. Each slice gets its own plan, written just before it starts, so a
later plan can use what an earlier slice found.

### S1. The field list draws the structure

Rows: A1, A4, A12, A16.

**New pure modules in `packages/forms/src/`**, each with tests ported from corlix:

- `discriminator.ts`. `discriminatorLabel(d)` returns a sentence like `system = urn:x`.
  Keys are sorted, so one discriminator always reads the same. S2 extends it for the
  All/Any shape.
- `group-tree.ts`. `childrenOf`, `descendantIds`, `groupDepth`, `eligibleParents`. Each one
  is cycle-safe. It ports corlix's `lib/groupTree.ts`.
- `group-repeats.ts`. `groupRepeats(field)` answers "does this group hold many?" It ports
  corlix's `packages/fhir-forms/src/groupRepeats.ts`.

**The row (A1).** Under the FHIR path, a second line prints the discriminator in the accent
colour, in mono text: `Location.identifier.value`, then `system = urn:x`. It wraps on a
phone rather than truncating.

**The repeat node (A12).** This is a drawn node, not a stored one. The field list derives it
from the flat `fields` array, and storage does not change. The rules, taken from corlix
P14.4:

- A field joins a repeat only when it has **both** a discriminator and a `fhirValueField`.
  The grouping key is `fhirPath` minus `.{fhirValueField}`.
- The header shows the last path segment, the list path and a count: `identifier`,
  `Location.identifier`, `2 slots`.
- The header cannot be dragged, has no `⋯` menu and has nothing to delete.
- Slots indent under a solid guide line. A group's parts use a dashed guide line.

This goes in `apps/studio/src/forms-builder/fieldTree.ts`, since only the builder draws it.

**Nested groups (A16).**
- `FieldListPane` draws children at any depth. Today it draws one level (`FieldListPane.tsx:105`).
- The Group picker shows on a group as well as on a field. Today it is hidden on a group at
  `FieldEditorSheet.tsx:185`.
- The picker's options come from `eligibleParents`, so a group can never be placed inside
  itself or inside any of its descendants.
- The export already recurses (`to-questionnaire.ts:101-109`). Data entry already recurses
  (`FormRuntime.tsx:356`). S1 adds a round-trip test through `toQuestionnaire` and
  `fromQuestionnaire` for a group three levels deep.

**Holds one or many (A4).** A group holds one instance when either is true:

1. It is bound to an element whose own maximum is 1, such as `Location.address`.
2. The author set `maxItems` to 1.

An unbound group with no cap holds many. That is the default, so every existing form keeps
its current export.

Corlix's warning applies here too. The default cardinality is `{min: 0, max: '1'}`, and
picking `group` in the type dropdown does not touch it. So the rule must read the **bound
element's** maximum, never the field's own `cardinality`.

CE's path table cannot answer that yet. Its `isArray` is true when **any** segment of the
path repeats (`packages/fhir/src/paths/index.ts:14-17`). So `Patient.contact.address` reads as
an array even though `address` holds one per contact. S1 adds a fifth column to the
generated tuple, `ownArray`, meaning the last segment itself repeats. It comes from
`pnpm gen:fhir-paths`, which reads `@types/fhir`, and `Identifier[]` in those types already
marks each repeating segment. **The plan must confirm the generator can emit this before
S1 starts.** If it cannot, A4 falls back to `maxItems` only and the spec gets amended.

What A4 changes in CE:

- The export writes `repeats: false` for a group that holds one, at `to-questionnaire.ts:108`.
- A group that holds many shows the repeat marker on its row.

What it does not change: data entry. CE draws every group once today (`FormRuntime.tsx:351`),
and it keeps doing that until the later step in section 9.

### S2. The field editor

Rows: A3, A9, A13, A15, B6, B8.

**Block order (A9).** CE's blocks become:

1. General
2. Reference, only for `reference` fields (B8)
3. Options
4. Mapping
5. Parts, only for groups (A13)
6. Codes
7. Translations
8. Visibility

CE keeps constraints and notes inside Mapping, as it does today. Only the order moves.

**Discriminator editor (A3).**

The schema at `form-schema.ts:75` widens to a union:

```ts
type DiscriminatorRule = {
  join: 'all' | 'any';
  conds: Array<{ el: string; op: 'equals' | 'not equals' | 'starts with'; val: string }>;
};
fhirDiscriminator?: Record<string, string> | DiscriminatorRule;
```

- **Storage keeps the smallest lossless shape.** Plain `equals` conditions joined by All are
  stored as the old key/value map. So an old form opened and saved unchanged stays
  byte-identical, and the seeded forms never change.
- **`discriminator.ts` gains `normalizeDiscriminator` and `discriminatorIdentity`.**
  `lint.ts:63` compares `JSON.stringify(f.fhirDiscriminator)` today. That treats
  `{a, b}` and `{b, a}` as different, and a map and its equal rule as different. It switches
  to `discriminatorIdentity`.
- `lint-fhir-path.ts:88` needs no change. It only tests whether a discriminator is present.
- The export carries the discriminator inside `EXT_CORLIX_FIELD_EXTRAS` as JSON, so both
  shapes survive. S2 adds a round-trip test for the rule shape.

The editor sits in the Mapping block, as in `test-output/p13-3/03-any-join.png`:

- An "Array element (discriminator)" checkbox.
- A match criteria box with one row per condition: an element text box, an operator
  select, a value text box and a remove button.
- "+ Add condition".
- An All/Any toggle, shown only at two or more conditions.
- A Value Field text box for `fhirValueField`.

**Limit, stated in the UI docs:** CE never reads the discriminator when a record is saved.
Only lint and export read it. Corlix also uses it on save, and that is the later step in
section 9.

**Add a slot, add a part (A13).**

- **"+ Add a named slot"** sits under the last slot of a repeat. It creates a sibling with the
  same `fhirPath`, `fhirValueField`, `fieldType` and discriminator elements, with the values
  left blank. It does not copy the API property, codes, ValueSet binding or translations,
  because those belong to the slot above. Two blank slots correctly trip the duplicate-path
  lint.
- **The Parts block** lists a group's children. Clicking a part opens that part's editor.
  "+ Add a part" creates a field with `groupId` set and an empty FHIR path. It gets no
  section of its own, because a part sits wherever its group sits.

**Open for the S2 plan:** what corlix does when you click a part while the group's editor has
unsaved changes. Check it in corlix before building. Do not guess.

**Locked fields (B6).** When `locked` is true:
- the row's Enabled checkbox is disabled
- Delete is disabled in the row's `⋯` menu
- the `d` and Space shortcuts skip the field

The label, order, translations and visibility stay editable. No CE seed sets `locked` today,
so S2's tests build a locked fixture.

**Reference block (B8).** Six controls for the six schema keys at `form-schema.ts:80-85`:
target resource, display field, value field, multiple, searchable and depends-on. Depends-on
lists the form's other fields. The block uses the label-left grid from AGENTS.md §5.

**Survey mode (A15).** A form whose `fhirResourceType` is `Questionnaire` is a survey.
- `packages/forms/src/survey-mode.ts` names this once: `isSurveyForm` and `mapsToResource`.
- A survey hides the whole Mapping block, gets no Library in S3, and is offered no starter
  pack in S5.
- ValueSet binding in Options still works.

### S3. Layout

Rows: A8, A10 (the FHIR elements half), A11.

**Preview sheet (A8).**
- The right-hand preview pane goes. Preview becomes an item in the header's `⋯` menu.
- It opens a right `Sheet` at `sm:max-w-xl`, which closes on Escape, the close control or
  a backdrop click.
- Phones get a preview. Today they have none.
- `PreviewPane` moves into the sheet unchanged.

**Library pane (A10).** The right pane now holds the Library.
- It is 21rem wide and has a search box.
- It lists what the form could hold and does not.
- S3 ships its second group, "All *Resource* elements": `fhirPathOptionsFor(type)`, minus
  every path a field already binds. A disabled field still counts as binding the path.
- Only paths up to two segments below the resource are listed, matching corlix.
  `Location.address.city` is listed. `Patient.contact.address.city` is not.
- The search filters on label and path. CE's table has no description text.
- Clicking a row creates a field, selects it and opens its editor. The field takes its label
  from the table, its FHIR path, and a field type from the leaf type.
- If a clicked sub-element's parent group is already on the form, the new field goes inside
  that group.
- Survey forms get no Library.
- When nothing is left to add, the pane shows `StripedEmpty`. While loading it shows
  `LoadingState`. Never both.

**Open for the S3 plan:** CE's path picker may already map a leaf type to a field type. If it
does, reuse it rather than port corlix's `fhirTypeMap`.

**Tabs on a narrow workspace (A11).**
- Below 980px of workspace width, the two panes become tabs: "Form N" and "Library N".
- The width is the two-pane area, measured with a `ResizeObserver` hook, not the viewport.
- It opens on Form. Adding from the Library switches back to Form. Nothing is remembered.
- A phone always gets tabs.
- The `TabsList` bottom border bleeds edge to edge (AGENTS.md §5).
- Inactive panels get `data-[state=inactive]:hidden` (AGENTS.md §6, the fourth mobile trap).

### S4. Selection and sections

Rows: B1 with B1b, B2, B5.

**Select many (B1).**
- Selection becomes a set plus an anchor.
- Click selects one. Shift-click selects the range between the anchor and the clicked row.
  Ctrl or Cmd-click toggles one row. Ctrl or Cmd-A selects every visible row, which wires the
  stub at `FormBuilderPage.tsx:183`.
- With two or more rows selected, the list header shows "N selected" and a `⋯` menu, not
  corlix's standalone buttons.
- The menu has Move to section, Toggle enabled and Delete.
- Each bulk action is one undo step: one `pushHistory`, then one schema update.
- Toggle enabled and Delete skip locked fields.
- Space and `d` act on the whole selection. Escape clears it.

**Limit:** a phone has no Shift or Ctrl key, so a phone keeps single selection. The docs say
so. Adding a touch selection mode would be new behavior corlix lacks.

**Drag onto a section (B2).**
- While a field is dragged, a panel titled "Drop on a section to reassign" appears at the top
  of the list.
- It has "(no section)" plus each section, each with a field count.
- Dropping a field on an entry sets the field's `section`. It uses dnd-kit `useDroppable`
  inside the existing `DndContext` (`FieldListPane.tsx:219`).
- The panel shows only when the form has sections.

**Section visibility (B5).**
- Each section row in `SectionsManager` gets a `⋯` menu with "Edit visibility".
- That opens a `Sheet` holding the existing `VisibilityRuleEditor`.
- A section with a rule shows the same branch marker a field does.
- Data entry already honours section rules (`packages/forms/src/visibility.ts:97`), so the
  builder is the only missing piece.

### S5. Starter packs

Rows: A5, A6, and the pack half of A10.

**Migration `099_starter_packs`.** No unmerged branch claims 099. `git branch -a --no-merged main`
was empty on 2026-09-14. Re-check before the S5 plan.

Two tables:

- `starter_packs`: `id`, `resource_type`, `name`, `version`, `seeded`, `created_at`,
  `updated_at`.
- `starter_pack_entries`: `pack_id`, `ord`, `fhir_path`, `label`, `api_property`,
  `field_type`, `fhir_value_field`, `required`, `locked`, `default_on`, `discriminator`
  (jsonb), `bound_value_set`, `rationale`. The primary key is `(pack_id, ord)`.

Three differences from corlix, each deliberate:

- **No `suggested_codes` column.** Corlix seeded it NULL because codes in a migration break
  its §8, which is also CE's AGENTS.md §8.
- **`fhir_path` is nullable.** CE's Facility form has three fields with no FHIR path:
  system, zone and council (`samples/forms.ts:41,88,112`).
- **No `facility_id`.** CE form definitions are not facility-scoped.

**Four seeded packs**, one per resource type: Patient, Location, ServiceRequest and
Practitioner.

- Entries come from **CE's** seeded forms in `packages/forms/src/samples/forms.ts` and
  `seedEssentials`, not from corlix. Corlix's packs use `urn:corlix:*` systems and corlix API
  property names, and CE's pages would not save them.
- Every Facilities entry must meet `page-targets.ts:41`: `facilitySystem`, `facilityCode`
  and `name`.
- Every entry carries a one-line rationale, shown in the chooser.
- Patients and Orders are `available: false` as target pages (`page-targets.ts:44-45`).
  Packs are keyed by resource type, not page, so their packs still help an author building
  a Forms-page form.

**Routes**, read-only: `GET /api/forms/starter-packs?resourceType=` and
`GET /api/forms/starter-packs/:id`. Route tests pin the wire shape (AGENTS.md §7).

**Chooser (A5, with A6's fix).**
- A right `Sheet`, not corlix's centered Dialog.
- The header shows the pack name and one line: the schema ranks nothing, so uncheck what you
  do not collect.
- Each entry has a checkbox, the label, a Required badge, the path, the discriminator line
  and the rationale.
- Locked entries are checked and disabled.
- "Add N fields" and "Cancel" sit in the sheet's `⋯` menu, as in `FieldEditorSheet.tsx`.
  There is no footer.
- The chooser opens by itself when a form is empty and its resource type has a pack. It also
  opens from the page `⋯` menu with "Start from a pack".
- Survey forms and forms with no resource type are never offered a pack.
- Entries already on the form, matched by path plus discriminator identity, are skipped.
- Adding is one undo step.

**Library, first group.** "Left out of the pack" lists every pack entry the form lacks,
ranked first, with the discriminator line where two entries share a path.

### S6. ValueSets

Rows: B3, B4a, B4b.

**Read stored codes, never recompute them.** This is the trap in this slice.

CE's `valueSets.expand()` recomputes the codes from CE's own terms and then overwrites the
stored expansion (`terminology-admin-store.ts:1017-1021`). A seeded FHIR ValueSet such as
`administrative-gender` includes a whole system that CE holds no terms for. So expanding it
returns nothing, and it also deletes the codes that came with the catalog.

The builder must read the stored rows instead. `exportFhir` already reads them without
recomputing (`terminology-admin-store.ts:1071`). The S6 plan picks between calling the export
route and adding a thin read-only route over the same query.

**Bind options to a ValueSet (B3).** For `select` and `multiselect` fields, the Options block
gets a binding control:
- Pick a set with CE's existing `terminology/ValueSetPicker.tsx`.
- Picking fills `valueSetOptions` from the stored codes and sets `valueSetUrl` and
  `bindingStrength`.
- `required` turns `allowCustomValue` off.
- "Unbind" clears the binding.
- "Save as a new ValueSet" turns a typed option list into a set through `saveValueSet`.
- The free-text ValueSet URL and Binding Strength controls leave Mapping
  (`MappingEditor.tsx:134-160`). The binding control replaces them.

**Standard bindings (B4a).**
- Port corlix's `scripts/gen-fhir-bindings.ts` to write
  `packages/fhir/src/paths/r4-bindings.generated.ts`: FHIR path to `{ vs, strength }`.
  Corlix's R4 table has 1,789 entries. `Patient.gender` maps to `administrative-gender`,
  required.
- Mapping shows `bound: <set> <strength>` under the FHIR path when the picked path has a
  binding.
- "Load from terminology" in Options fills options from that set's stored codes.
- **Auto-bind,** following corlix's `valueSetBinding.ts:84`. It runs when an author picks a
  bound path, the field has no `valueSetUrl`, the field is not a group, and CE holds that
  set, found through `valueSets.getByUrl` (`terminology-admin-store.ts:989`). It sets the
  type to `select` and fills `valueSetUrl`, the strength and the options. It turns
  `allowCustomValue` off when the strength is required.
- Survey forms have no bound element, so they get neither the hint nor "Load from
  terminology". Corlix's P15.1 made the same call.

**FHIR ValueSets on every install (B4b).**
- CE already ships `packages/db/fixtures/fhir/R4.valuesets.json.gz`. It is byte-identical to
  corlix's, checked by comparing md5 sums of the unzipped files.
- `seedBundledTerminology` imports it (`packages/bootstrap/src/seed.ts:413-434`), but only
  inside `seedDatabase`. That runs under `SEED_ON_START`, which defaults to false
  (`packages/config/src/schema.ts:33`), or on factory reset.
- S6 moves the FHIR catalog step into the always-run boot path, next to `seedEssentials`. It
  keeps the existing presence check, so a boot skips the import when HL7 FHIR sets exist.
- The UCUM step stays where it is. Nobody asked for it.
- This adds 672 ValueSets to every install. The operator chose that on 2026-09-14.

### S7. Suggested codes

Row: A7.

**Two sources, not corlix's three.**
- **Binding:** the stored codes of the field's bound set, or of the element's standard
  binding from S6.
- **Your forms:** codes other CE forms already use on the same FHIR path, with a count.

Corlix's third source reads a local cache of fetched, uninstalled marketplace forms. CE has
no such cache. An installed `form-template` becomes an ordinary CE form
(`packages/bootstrap/src/form-artifact-install.ts`), so "Your forms" already covers it.

**Route:** `GET /api/forms/code-suggestions?fhirPath=&valueSetUrl=`.
- It returns `{ system, code, display, source, count?, inTerminology }`.
- It scans form definitions in JavaScript, as corlix does.
- Ranking is done in JavaScript, so the pg-mem ordering caveat does not apply.
- Codes already on the field are left out.
- Route tests pin the wire shape.

**Panel.** A "Suggested codes" list sits above the term search in the Codes block.
- Each row has a Binding badge or a "Your forms · N" badge.
- A code CE lacks is marked "not in your terminology".
- Adding a code puts it on the field. If the code is new to CE, it also creates the term
  through `createTerm`, and the panel shows "Added X to your terminology" with Undo, which
  calls `deleteTerm`.
- A code whose system CE does not know is refused, with a pointer to the Terminology page.
- An empty panel says the terminology is thin. It does not say no code exists.

**Open for the S7 plan:** which capability `createTerm` needs, and what the panel shows to an
author without it.

---

## 6. Data model changes

| What | Change | Migration |
|---|---|---|
| `fhirDiscriminator` | accepts the rule shape. Old shape unchanged, and stored when lossless | none |
| path tuple | gains `ownArray`, regenerated | none, generated code |
| group `repeats` in export | derived, no longer always true | none |
| `r4-bindings.generated.ts` | new generated table | none |
| starter pack tables | new | `099_starter_packs` |
| FHIR catalog import | runs on every boot, not only on seed | none |

---

## 7. Definition of done, per slice

Each slice is done only when all of these hold:

1. The studio UI works and follows AGENTS.md §5.
2. `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` and `apps/web/src/docs/0.1.8/forms.md`
   are updated. The web doc holds all three languages in one file, under `## English`,
   `## Français` and `## Português`, so each gets its own section.
3. It is checked at 375x812. Anything anchored to the bottom edge is marked "only a real
   phone can confirm". Full-height surfaces use `h-dvh`.
4. The full gate is green: `pnpm turbo run test --force` and
   `pnpm turbo run typecheck --force`. Never pipe turbo through `tail`.
5. It is merged to local `main`. Then run `pnpm make:changelog` and commit
   `apps/web/src/landing/changelog.json`.

No CLI work, per section 4.

---

## 8. Tests, and what each layer proves

- **`packages/forms` unit tests:** discriminator label, identity and normalize, group tree,
  group repeats, survey mode. They prove the logic, not the UI.
- **Studio component tests** (vitest and Testing Library, beside the existing `*.test.tsx`):
  they prove rendering and interaction. They do not prove the server.
- **Route tests** for starter packs and code suggestions. They pin the wire shape.
  `typecheck` does not (AGENTS.md §7).
- **The 099 migration test** runs on pg-mem. It proves the schema. It cannot prove boot order
  on real Postgres, so check `_migrations` after a real boot.
- **A check in the real browser** against the dev server, compared against corlix's
  screenshots in `apps/desktop/test-output/`.

---

## 9. Not in this spec

**The later step, agreed on 2026-09-14.** Data entry changes, as one spec of their own:

- **B7.** Repeating groups at data entry: numbered cards with Add and remove. CE draws each
  group once today (`FormRuntime.tsx:351`).
- **Saving through the discriminator.** Corlix picks the list entry a field fills on save,
  and creates one from `equals` conditions when none matches. CE never reads the
  discriminator on save.

**Not changed, and recorded so nobody assumes otherwise:**

- CE's `fhir-path-cardinality` warning stays broader than corlix's. It fires on any list path
  without a discriminator, including `Patient.name.given`. Corlix rejected that rule as too
  noisy. Changing CE's would be a behavior change nobody asked for.
- There is no pack editing. Corlix has none.
- There is no marketplace suggestion source, per S7.
- UCUM stays under `SEED_ON_START`.

**Noticed and not checked:**

- Corlix's builder exports and imports a "Corlix JSON" format. CE exports a Questionnaire and
  a bundle (`api.ts:1948-1949`). I did not compare import.
- `terminology/ValueSetBuilder.tsx:103` calls `expandValueSet` for its preview. If that runs
  when someone opens a seeded FHIR set, it may overwrite that set's stored codes, for the
  reason in S6. Unverified. It is outside this work and goes on the side list, not into a
  slice.

---

## 10. Verification status

**HONEST NON-PROOF.** No CE code was written for this spec.

Proven:
- Corlix's 14 form builder e2e specs pass on its current `main`, commit `9fe76d84`.
- Every CE citation above was read on 2026-09-14 at `f48c3525`.

Not proven, and what would prove it:

1. That `pnpm gen:fhir-paths` can emit `ownArray`. Proof is a generator dry run in the S1
   plan.
2. That nested groups round-trip through the response serializers, not only the Questionnaire
   adapters. Proof is S1's three-deep test extended to `from-response.ts`.
3. That moving the FHIR catalog import onto every boot is safe on a database that already
   has some HL7 sets. The presence check reads `valueSets.list('pub-hl7-fhir')`, so a partial
   import would be skipped rather than completed. Proof is a test with a partial catalog in
   the S6 plan.
4. That the export route's stored-code read is fast enough to call from the builder for
   large sets. Proof is timing it against the largest R4 set in the S6 plan.
