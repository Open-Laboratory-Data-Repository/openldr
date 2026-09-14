# Forms

Forms create structured web capture screens for operational or clinical data. They move through Draft, Published, and Archived states so teams can design safely before users submit data.

## Outcome

You can create a form, configure metadata, add fields, preview, save a draft, publish, compare versions, submit a response, and manage the form lifecycle.

![Forms list with state and actions](forms-list.png)

## Before you begin

- Know whether the form should be a custom form or aligned to a FHIR resource type.
- Decide which pages users should see when opening, submitting, or reviewing the form.
- Prepare terminology bindings if coded answers are required.

## Steps

1. Open **Forms**.
2. Review the list and state badges: Draft, Published, or Archived.
3. Open **Form actions** and choose **New**.
4. Enter the form name and optional version label.
5. Choose the FHIR version and resource type if this form maps to a FHIR resource.
6. Configure target pages so users land in the correct capture and review flow.
7. Open the builder.
8. Add fields from the palette.
9. Select a field to configure label, help text, required state, validation, terminology binding, repeatability, and conditional visibility.
10. Reorder fields by dragging them in the canvas.
11. Clear a field's checkbox in the field list to disable it. A disabled field is not shown to users, is not validated, and collects no answer. It stays in the form so you can switch it back on.
12. Remove fields only after confirming no published workflow or report depends on them.
13. Open **Preview** from the ⋯ menu to test the form before publishing. It opens as a sheet over the builder, on a phone too. **Fill example** and **Reset** are in the sheet's ⋯ menu. Preview shows exactly what a user sees, so a disabled field does not appear there either.
14. Select **Save draft** to store your work without releasing it.
15. Select **Publish** when the form is ready for users. Publish saves the form on screen first, so you never have to remember to save before publishing.
16. Use **Compare** to review changes between versions.
17. Use **Versions** to see every published version, newest first, with the date each was released.
18. From a version's actions, choose **Restore** to put it back. This replaces the form you are
    editing, and a published form goes back to draft right away. It drops out of View/Run the
    moment you restore. Publish again to put it back there. Undo in the builder only changes what
    is on screen; save it to write that back.

![Form builder with field palette, preview, editor, and actions](form-builder.png)

19. From the form list, choose **View/Run**.
20. Check submission eligibility before entering answers. For an eligible form, fill required fields and submit.

![Published form capture screen](form-capture.png)

21. Use form actions to duplicate, archive, export, export a marketplace bundle, or delete when appropriate.

## How the field list shows structure

- **Which entry of a list a field fills.** A field bound to one entry of a FHIR list shows a second line under its path, such as `system = urn:x`. Two fields on `Location.identifier.value` differ only by this line.
- **Slots of one list.** Fields that share a list and have both a discriminator and a value field sit under one header. The header shows the list name, its path, and how many slots it has. The list draws it from the fields, so it cannot be dragged or deleted.
- **Groups inside groups.** Set a group's **Group** to put it inside another group, to any depth. The picker never offers the group itself or anything already inside it.
- **The repeat icon.** A field that takes more than one answer, or a group that holds many entries, shows a repeat icon. A group holds one entry when it is bound to an element that holds one, such as `Location.address`, or when **Max Items** is 1. The Questionnaire export marks such a group as not repeating.
- Data entry still shows every group once. Adding more entries to a group during data entry comes in a later release.

## Editing a field

- **Which entry of a list.** Under Mapping, tick **Array element (discriminator)**. Each condition is an element, an operator, and a value, such as `system` `equals` `urn:x`. The operators are `equals`, `not equals`, and `starts with`. With two or more conditions, choose **All** when every condition must hold, or **Any** when one is enough. **Value Field** names the element that holds the answer, usually `value`.
- A discriminator is used by the form checks and the Questionnaire export. Data entry does not use it yet.
- **Another slot.** Under the last slot of a list, **+ Add a named slot** adds a copy with the same path, value field, and type, and blank discriminator values. The API property, codes, and translations are left blank.
- **Parts of a group.** A group's editor lists its parts after Mapping. Click one to edit it. Your unsaved changes to the group are saved first. **+ Add a part** adds a field inside the group with no FHIR path.
- **Reference fields.** A reference field has a **Reference Configuration** block after General. **Target** is `Patient` or an active code system. **Depends On** and **Searchable** are saved and exported, but data entry does not use them yet.
- **Locked fields.** A locked field cannot be switched off or deleted from the field list. You can still relabel, reorder, and translate it.
- **Survey forms.** When the form's Resource Type is `Questionnaire`, the editor hides FHIR Path, API Property, and the discriminator. Observation Extract and the other settings stay.

## The Library

- The pane on the right lists the FHIR elements of the form's resource type that no field uses yet. Click one to add it as a field; its editor opens.
- A field added this way is named from the element and typed from it. Coded elements become a select, with options when the element lists its codes. Dates arrive as text fields; change the type in the editor.
- An element inside a group that is already on the form goes into that group.
- Search filters by name and path. The list goes two levels deep, such as `Location.address.city`.
- A survey form has no Library.
- When the builder is narrower than 980 pixels, Form and Library become tabs. Adding from the Library switches back to Form. Collapsing the sidebar can bring both panes back.

## Working with many fields

- Click a field to open its editor. Shift-click selects every field from the last one you clicked to this one. Ctrl-click (Cmd-click on a Mac) adds or removes one field. Neither opens the editor.
- Ctrl+A (Cmd+A) selects every field the list shows. Escape clears the selection.
- With two or more selected, the list header shows how many, and its ⋯ menu moves them to a section, switches them on or off, or deletes them. Delete asks first. Each is one undo step.
- **Toggle enabled** switches them all off when at least half are on, and all on otherwise. It skips locked fields, and so does **Delete**.
- When no box or menu has focus: j and k (or the arrow keys) move down and up the list, Enter opens the field, Space switches it on or off, d deletes it, and Ctrl+D duplicates it. With two or more selected, Space and d act on all of them. Ctrl+F jumps to the field search.
- A phone has no Shift or Ctrl key, so on a phone you select one field at a time.

## Sections

- Drag a field by its handle. While you drag, a panel at the top of the list shows **(no section)** and each section, with how many fields it has. Drop the field on one to move it there. The panel only appears when the form has sections.
- In the Sections list, each section's ⋯ menu has **Edit visibility**, **Move up**, **Move down** and **Delete**.
- **Edit visibility** opens the same rule editor a field has. Only enabled fields can be used in a condition. Data entry hides the section while its rule is not met.
- A field or section with a visibility rule shows a branch icon.

## Expected result

The form is saved as a draft during design, published when ready, and available from **View/Run**. Submission also requires a supported extraction configuration.

## Troubleshooting

- **Publish is unavailable:** finish required form metadata or fix invalid field configuration.
- **A required field blocks submission:** confirm the field type, validation rule, and conditional visibility.
- **A terminology field has no options:** check the terminology binding and the selected ValueSet.
- **Users see the wrong page after submit:** review the configured target pages.
- **A field you turned off still appears:** confirm the field list checkbox is clear, then save. The checkbox controls the live form, not just the preview.
- **Publishing seemed to do nothing:** every action confirms itself with a message in the corner. If no message appeared, the action did not run.
- **The Version label box does not change the version number:** it never did. The number is assigned when you publish, and is shown next to the status. The box is a free-text caption.
- **Versions is greyed out:** the form has not been saved yet, so it has no versions.

## FHIR path validation

When a form maps to a FHIR resource type, the builder checks each field's FHIR path against the element list.

A red badge means an error blocks publishing. A yellow badge means a warning that does not block publishing but you should review.

The builder only checks resource types in the built-in element list, which covers nine common types. Forms using other resource types show no badges because they are not path-checked at all.

### unknown-fhir-path (error)

The path is not an element of this resource type.

Usually a typo in the path. Check the spelling and nesting depth. If the path is correct and the resource type is outside the built-in nine types, the form will not be checked.

### facility-admin-order (error)

The facility administrative levels are bound to FHIR address parts in the wrong order.

FHIR Address has four administrative slots: country, state, district, city. This registry has six tiers, so not every tier can bind to a slot. Zone is the tier with no slot of its own. Clear the Zone field's FHIR path and leave it unmapped. There is no reordering that fits six tiers into four slots.

A Facility form saved by an earlier migration can still carry Zone bound to `address.district`. This error now flags that install, and no migration corrects it. Clear Zone's FHIR path by hand.

### fhir-path-cardinality (warning)

The path passes through an element that can repeat with no discriminator.

The path cannot resolve which occurrence to use. Add a FHIR discriminator on the field to pick a specific occurrence.

### fhir-path-type-mismatch (warning)

A plain input is bound to a structured FHIR element that a single value cannot fill.

Change the field type to match the FHIR structure, or bind a more specific path that points to a simpler element.

### From the command line

Operators running without the studio can run `openldr forms lint` to get the same findings.

You can pass an optional form ID to lint a single form. Use `--json` for structured output. The command exits non-zero when any error is present.

Run `openldr forms versions <id>` to list a form's published versions, newest first.

Run `openldr forms restore <id> <version> --force` to put a published version back over the
current draft. It refuses without `--force`.

## Advanced web usage

- Use validation rules for format, range, and required-value checks close to the point of capture.
- Use conditional visibility to keep forms shorter while still collecting detail when it matters.
- Bind coded fields to terminology so downstream reports and workflows receive consistent values.
- Use repeatable fields for repeated observations instead of creating many near-duplicate fields.
- Treat published versions as user-facing contracts; create a new version when changing meaning, not just wording.

## Related guides

- [Terminology](/docs/terminology)
- [Marketplace](/docs/marketplace)

## Submission eligibility

Publishing makes a form available for sharing and embedded editors. It does not guarantee View/Run submissions. Capture currently supports ServiceRequest forms and enabled answer fields with Observation Extract and at least one code. A plain custom text form without extraction cannot submit. Patient and Facility templates can still serve their dedicated editors.

The builder and capture page show eligibility before entry. For observations, open the field sheet, select a terminology code under Codes, and check Observation Extract under Mapping. Enable the field. Save and publish. Answer at least one extraction field during capture; an unanswered or hidden extraction field produces no Observation.

Eligibility checks configuration only. Required answers, reference validation, and the enabled ingest workflow must still succeed.

## Example: submit a lab request

Use a test installation with an existing patient, loaded LOINC terminology, and an enabled ingest workflow. You need permission to edit and publish forms and submit responses.

1. In Forms, open the page's ⋯ menu and choose New. Name the form Lab request example.
2. Set FHIR version to R4, resource type to ServiceRequest, and target page to Forms. Open the builder.
3. Add an enabled, required reference field labeled Patient. In **Reference Configuration**, set Target to Patient. Under Mapping, set FHIR Path to ServiceRequest.subject.
4. Add an enabled, required reference field labeled Tests. In **Reference Configuration**, set Target to the installed LOINC system, http://loinc.org. Set FHIR Path to ServiceRequest.code. Choose codes through the terminology picker; do not enter a made-up code.
5. Save each field through its ⋯ menu. Confirm the submission configuration message. No Observation Extract flag is needed for this ServiceRequest form.
6. Open the builder's ⋯ menu and choose Publish. Resolve any publish errors. Publishing also saves the current schema.
7. Return to Forms and choose View/Run from the form's ⋯ menu. Select an existing patient and one loaded test from the lists.
8. Choose Submit from Form actions. Wait for Response captured. The response and derived ServiceRequest enter the ingest workflow.
9. Check the corresponding workflow run and stored request before repeating the submission. If the server reports partial persistence, inspect the run first; a retry can create duplicates.

If a reference list is empty, check the configured source and loaded terminology. If the workflow is disabled, enable it before retrying. Required-field messages identify the field by its visible label.
