# Forms

**Forms** are the screens people use to enter data by hand: a lab order at reception, a patient record, a facility. Each form is built in the **Form Builder** from fields, and each field can map to a FHIR element, so what is typed becomes a proper record. A form moves from **Draft** to **Published** to **Archived**, so you can design it safely before anyone uses it.

A fresh install ships four published forms: **Lab order**, **Patient**, **Users** and **Facility**. This guide takes a lab order with the shipped form, then builds and publishes a form of your own. It takes about 15 minutes. Select any picture or clip to enlarge it.

![Forms: the four shipped forms, with their FHIR type, number of fields, version and status.](forms-tour.png)

## Who can do what

| Permission | What it allows |
| --- | --- |
| **Use forms** | Open forms and read their definitions |
| **Submit forms** | Fill a form with **View/Run** and submit it. Submitting writes clinical records |
| **Edit forms** | Create and change forms in the builder, and export them |
| **Publish forms** | Publish a new version |

## Before you start

Example 1 needs three things on the install:

1. **The docs sample data**, for its patients. See [Dashboards, Load the sample data](/docs/dashboard#load-the-sample-data).
2. **Tests switched on at this lab.** The Lab order's **Tests** field lists only those. Follow [Test catalog, Examples 1 and 2](/docs/test-catalog#example-2-switch-tests-on-at-this-lab) first.
3. **The Ingest workflow enabled.** It is on a fresh install. A submitted form goes through it. See [Workflows](/docs/workflows).

> **Use a test install.** Submitting a form writes a real order. It cannot be deleted. After Example 1 the sample data holds 61 orders, not 60.

## Example 1: take a lab order

![Opening the Lab order, choosing the patient, the test, its specimen and the priority.](forms-lab-order.mp4)

1. Open **Forms**. On the **Lab order** row, open **⋯** and select **View/Run**.
2. In **Patient**, type `Chausiku` and pick **Demo Chausiku**, born 1994-05-14. Names show surname first.
3. In **Tests**, type `Full` and pick **Full blood count**. A row appears under **Results**: **FBC Full blood count**, **Specimen type not set**.
4. Select that row. In the sheet, set **Specimen type** to **Blood**, then close the sheet. The row now reads **Blood**.
5. Set **Priority** to **Routine**.

![The order ready to submit.](forms-lab-order-filled.png)

6. Open the page's **⋯** menu and select **Submit**.

![Submitting from the page menu. Response captured appears.](forms-lab-order-submit.mp4)

**Expected result:** a green **Response captured** at the top. The order goes through the Ingest workflow into the warehouse, with test code `58410-2` and priority `routine`. Open [Patients](/docs/patients) and Chausiku Demo now has five requests.

The form stays filled after submitting. Do not submit again unless you mean a second order.

**Referring Facility** is a free-text box on the shipped Lab order, even though its hint says to search. Leave it empty, or type a name. See [Limits](#limits).

## Example 2: build a form from a starter pack

Build a shorter order form for viral load requests from the Lab order starter pack, preview it, and publish it.

![Naming the form, choosing R4 and ServiceRequest, keeping five fields from the pack, and adding them.](forms-build.mp4)

1. On **Forms**, open the page's **⋯** menu and select **New**. The **Form Builder** opens.
2. In **Form name**, type `Quick viral load request`.
3. Set **FHIR Version** to **R4 (most common)**.
4. Set **Resource Type** to **ServiceRequest**. Type to filter the long list. The **Lab order pack** opens by itself, with **9 of 9 selected**. Each entry says why it is there.
5. Untick **Requesting Clinician**, **Clinical Notes**, **Referring Facility** and **Order rejection**.
6. Open the pack's **⋯** menu and select **Add 5 fields**.

**Expected result:** the builder lists **5 fields (5 enabled)**: Patient, Tests, Results, Priority, and Reference Number under `identifier`. The **Library** on the right lists the pack entries you left out, and every other ServiceRequest element, ready to add with one click. A note says **Submission is configured**.

![The builder with five fields, and the Library beside them.](forms-builder.png)

### Preview it

![Opening Preview from the builder menu and filling it with example values.](forms-preview.mp4)

1. Open **Builder actions**, the **⋯** at the top right, and select **Preview**. The form opens in a sheet, exactly as a user sees it.
2. Open the sheet's **⋯** menu and select **Fill example**. Each field gets an example value. **Reset** in the same menu clears them.

![Preview with example values.](forms-preview-filled.png)

Preview never submits anything.

### Publish it

![Publishing from the builder menu.](forms-publish.mp4)

1. Close the preview. Open **Builder actions** and select **Publish**. Publish saves the form first, so there is no separate save step.

**Expected result:** a message confirms it, and the status dot beside the name turns green with **v1**. Back on **Forms**, **Quick viral load request** is listed as **Published**, with **5** fields.

![The new form in the list, Published.](forms-list-published.png)

To remove it again, open its row's **⋯** menu and select **Delete**.

## The whole lifecycle, step by step

You can create a form, configure metadata, add fields, preview, save a draft, publish, compare versions, submit a response, and manage the form lifecycle.

### Before you build your own form

- Know whether the form should be a custom form or aligned to a FHIR resource type.
- Decide which pages users should see when opening, submitting, or reviewing the form.
- Prepare terminology bindings if coded answers are required.

### Steps

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
- **The shipped forms.** The Patient form draws its first and last name under `Patient.name` and its phone under `Patient.telecom`. The Users form draws its first and last name under `Practitioner.name` and its email under `Practitioner.telecom`. The Facility form draws its code under `Location.identifier`, and the Lab order form draws its reference number under `ServiceRequest.identifier`. An install whose operator has edited either form keeps its own fields.
- **Groups inside groups.** Set a group's **Group** to put it inside another group, to any depth. The picker never offers the group itself or anything already inside it.
- **The repeat icon.** A field that takes more than one answer, or a group that holds many entries, shows a repeat icon. A group holds one entry when it is bound to an element that holds one, such as `Location.address`, or when **Max Items** is 1. The Questionnaire export marks such a group as not repeating.
- Data entry still shows every group once. Adding more entries to a group during data entry comes in a later release.

## Editing a field

- **Which entry of a list.** Under Mapping, tick **Array element (discriminator)**. Each condition is an element, an operator, and a value, such as `system` `equals` `urn:x`. The operators are `equals`, `not equals`, and `starts with`. With two or more conditions, choose **All** when every condition must hold, or **Any** when one is enough. **Value Field** names the element that holds the answer, usually `value`.
- A discriminator is used by the form checks and the Questionnaire export. Data entry does not use it yet, with one exception: when a Lab order is submitted, its reference number carries the `system` its discriminator names.
- **Another slot.** Under the last slot of a list, **+ Add a named slot** adds a copy with the same path, value field, and type, and blank discriminator values. The API property, codes, and translations are left blank.
- **Parts of a group.** A group's editor lists its parts after Mapping. Click one to edit it. Your unsaved changes to the group are saved first. **+ Add a part** adds a field inside the group with no FHIR path.
- **Reference fields.** A reference field has a **Reference Configuration** block after General. **Target** is `Patient` or an active code system. **Searchable** is saved and exported, but data entry does not use it yet. **Depends On** is used in one case: a field that depends on a Tests field bound to this lab's test list offers only the specimens the chosen tests accept. The shipped Lab order no longer uses it: each test carries its own specimen (see Test catalog). Any other **Depends On** setting is saved but not used.
- **Locked fields.** A locked field cannot be switched off or deleted from the field list. You can still relabel, reorder, and translate it.
- **Survey forms.** When the form's Resource Type is `Questionnaire`, the editor hides FHIR Path, API Property, and the discriminator. Observation Extract and the other settings stay.

## Options and ValueSets

- A select or multiselect field can take its options from a ValueSet. In the Options block, search for a set and pick it. Its codes are copied into the options, and the field keeps a link to the set with a strength. A required strength stops data entry accepting other values.
- **Unbind**, in the Options ⋯ menu, drops the link and keeps the options. **Save as a new ValueSet** turns typed options into a set you can reuse; it shows only if you may manage terminology.
- Under the FHIR path, **bound:** names the ValueSet FHIR itself binds that element to, and how strongly. **Load from terminology**, in the Options ⋯ menu, fills the options from that set.
- Picking a path FHIR binds as required or extensible, on a field with no ValueSet, binds it for you and makes it a select. Preferred and example bindings are left to you, and so is a field that already names a reference source.
- A reference field picks its ValueSet in the Reference Configuration block. It searches the set live, so nothing is copied.
- Every install holds FHIR's 672 standard ValueSets. Survey forms have no bound elements, so they show no **bound:** line.

## Suggested codes

- For a field with a FHIR path, the Codes block lists **Suggested codes** above the term search.
- A **Binding** code comes from the field's ValueSet, or from the set FHIR binds the element to. **Your forms · N** means N other forms put that code on the same path.
- Click a row to put the code on the field.
- **not in your terminology** marks a code CE does not hold. Adding it also adds it to your terminology, and the panel says so, with **Undo**. Undo removes it from your terminology; the code stays on the field.
- Only a user who can manage terminology can add such a code. Other authors see it greyed.
- A code from a coding system CE does not have is refused. Add the system on the Terminology page first.
- An empty list means your terminology is thin, not that no code exists. Search below, or add codes on the Terminology page.
- When a set holds many codes, the panel shows 50 that no form uses, and says how many more there are.

## Starter packs

- A starter pack is a ready list of fields for one resource type, taken from the forms OpenLDR ships: Location (Facility), Practitioner (Users), Patient, and ServiceRequest (Lab order).
- When you pick a resource type on an empty form, its pack opens by itself in a sheet. On a form that has fields, choose **Start from a pack** from the ⋯ menu.
- Each entry says why it is there. Uncheck what you do not collect, then choose **Add N fields** from the sheet's ⋯ menu. Adding is one undo step.
- A locked entry stays checked, because the page the form feeds cannot save a record without it.
- Entries already on the form are left out of the sheet.
- Coded entries take their options from FHIR's own list. The Lab order pack leaves out Ward / Department, because its codes are local; add it from the Library and give it options.
- Survey forms and forms with no resource type have no pack.

## The Library

- The pane on the right lists the FHIR elements of the form's resource type that no field uses yet. Click one to add it as a field; its editor opens.
- Above the elements, **Left out of the pack** lists the pack entries the form does not have, in the pack's order. Click one to add it.
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

### Expected result

The form is saved as a draft during design, published when ready, and available from **View/Run**. Submission also requires a supported extraction configuration.

### Builder troubleshooting

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

## Submission eligibility

Publishing makes a form available for sharing and embedded editors. It does not guarantee View/Run submissions. Capture currently supports ServiceRequest forms and enabled answer fields with Observation Extract and at least one code. A plain custom text form without extraction cannot submit. Patient and Facility templates can still serve their dedicated editors.

The builder and capture page show eligibility before entry. For observations, open the field sheet, select a terminology code under Codes, and check Observation Extract under Mapping. Enable the field. Save and publish. Answer at least one extraction field during capture; an unanswered or hidden extraction field produces no Observation.

Eligibility checks configuration only. Required answers, reference validation, and the enabled ingest workflow must still succeed.

## Building a lab request form by hand

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


## Choosing tests on the Lab order

Type two or more characters of a test's code or name in the Tests field to search for it. If you know neither, open the ⋯ menu beside the Tests label and choose **Browse all tests**. The sheet lists the whole catalog a page at a time, with a search box and a category filter.

Pick a test to add it beside the tests already chosen. A test this lab does not run is marked **Not offered here** and cannot be picked, because the order would be refused on submit. Someone who can manage the catalog switches it on from the Test catalog page.

An install with no catalog loaded has nothing to browse, and the sheet says so. Tests come from the Test catalog page, where a lab imports its list. OpenLDR ships no tests.

## Results on the Lab order

Each test chosen on a Lab order gets a row under the Tests field. The row shows the test's code and name, and whether its specimen is set. Opening a row shows the specimen picker, the reference range that fits this patient, and one input per result parameter.

A value outside its range is flagged beside the input. It is never refused: the bench decides.

Each numeric result has a range picker under its input, listing every range by name, or, when unnamed, by who it is for. It starts on the range that fits the patient. Picking a range that does not fit shows a warning and is still allowed. The flag follows the picked range. If the test's ranges changed after the sheet opened, submitting the order is refused. Reopen the test and pick a range again.

A test can be rejected from its row menu with a reason from a list. A rejected test is recorded with its reason, but the reason does not reach reports. On its order, the test shows as a result row with no value.

The whole order can be rejected from the page menu, with **Reject order**. Pick a reason from the list. If the reasons cannot be read, the sheet says so and you cannot reject. Nothing retries on its own, so close the sheet and open it again. Once rejected, a line under the header shows the reason, and every test row reads "Order rejected" and is closed for entry. Values already typed stay on the screen but are not written. **Undo rejection** in the same menu opens the rows again.

A rejected order is marked as rejected, with its reason code and text. The reason reaches the lab record (the rejection code and reason on the order), so a report can count it. The order's rejection code sits in the same place as rejection codes that arrive from the lab system, so a report that groups by code sees both kinds. No result is written for a rejected order.

Each result written is linked to its order, so reports can join a result to the order it came from.

A submitted order writes one result record per value typed. Results are typed with the order, in one pass. There is no way yet to reopen a submitted order and add them later.

## Limits

- **Referring Facility on the shipped Lab order is free text.** Its hint says to search facilities by name or code, but the field has no source to search, so it takes typed text.
- **Data entry shows every group once.** Adding more entries to a group during data entry is not available yet.
- **A submitted order cannot be edited.** Results are typed with the order, in one pass.
- **Searchable** and most **Depends On** settings are saved and exported, but data entry does not use them yet.

## On a phone

Forms works on a phone. **View/Run** stacks each label above its box. The builder's preview opens as a sheet on a phone too. A phone has no Shift or Ctrl key, so in the builder you select one field at a time. When the builder is narrower than 980 pixels, **Form** and **Library** become tabs.

## Troubleshooting

- **The Tests field on the Lab order is empty.** No test is switched on at this lab. See [Test catalog](/docs/test-catalog).
- **The patient search finds nobody.** Search needs part of the name, an identifier or a phone number. Without **View patient identifiers** it matches an exact identifier only. See [Patients](/docs/patients).
- **Submit fails.** Read the message. A required field is empty, or the Ingest workflow is off.
- **Submit seemed to do nothing.** Every action confirms itself with a message. If none appeared, it did not run.
- **The form says it is not configured for submission.** See [Submission eligibility](#submission-eligibility).

## Related guides

- [Test catalog](/docs/test-catalog)
- [Patients](/docs/patients)
- [Terminology](/docs/terminology)
- [Workflows](/docs/workflows)
- [Marketplace](/docs/marketplace)
