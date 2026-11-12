# Forms

Forms lets staff enter data through published forms. Form authors use the builder to choose fields, preview the design and publish versions.

Use your own patients, enabled catalog tests and approved form design. The pictures show fictional records and an Example request form in an isolated test installation. No documentation samples are required.

Use forms allows reading form definitions. Submit forms allows data capture. Edit forms allows design changes, and Publish forms allows publication. A form also needs a valid submission configuration and an enabled workflow for incoming data before it can write data.

Draft and Archived forms can still open through View/Run. Submit is disabled until the form is Published. Preview in the builder is a separate way to try a design without saving a response.

The version numbers in these pictures are examples. Each publication saves a snapshot of the design and takes the next number. Your numbers depend on your own publication history. Read [Start here](/docs/start-here) for installation and command-line setup.

## Choose the patient, test and specimen for a lab order

Use this when recording an intended order through your published Lab order form. Use the patient and tests appropriate to that order.

### 1. Open Forms

Select **Forms** in the main menu.

![Forms is in the main menu on the left.](forms-guide-open-page.png)

### 2. Open Lab order

Open the **Lab order** row dots and select **View/Run**.

![Use the Lab order row dots menu to open its capture page.](forms-guide-order-row-actions.png)

![View/Run opens the published form for data entry.](forms-guide-order-run.png)

### 3. Search for the patient

In **Patient**, search using your patient name or identifier.

![Search for your actual patient by name or identifier.](forms-guide-order-patient-search.png)

### 4. Select the patient

Check the matching record and select the correct patient.

![Select the correct patient from the results.](forms-guide-order-patient-choice.png)

### 5. Search for the test

In **Tests**, search for the requested catalog test. The list uses tests switched on at this lab.

![Tests lists catalog tests switched on at this lab.](forms-guide-order-test-search.png)

### 6. Choose the test

Select the requested test. Repeat this choice only when the order needs another test.

![Choose the catalog test requested for this patient.](forms-guide-order-test-choice.png)

### 7. Open its details

Under **Results**, select the chosen test row to open its details.

![Open the selected test row under Results to complete specimen and result details.](forms-guide-order-test-details.png)

### 8. Choose the specimen

Select the specimen type recorded for this test. Use an option from your configured list.

![Select the specimen type used for this test.](forms-guide-order-specimen.png)

**Expected result:** The test details hold the chosen specimen. You have not submitted the order yet.

## Review and submit the lab order

Use this after selecting the patient, requested tests and specimen details. Complete any other required fields in your form before submitting.

### 1. Close the test details

Select **Close** at the top right of the test-details sheet.

![Close returns to the order with the chosen specimen.](forms-guide-order-details-close.png)

### 2. Choose the priority

Choose the recorded **Priority**. The picture uses **Routine**.

![Choose the priority for this order. The example uses Routine.](forms-guide-order-priority.png)

### 3. Review the order and open its actions

Check the patient, tests and specimen details, then open the page dots at the top right.

![Review the order, then open its page dots menu.](forms-guide-order-submit-actions.png)

### 4. Submit the intended order

Select **Submit** once. Wait for the result. Do not submit again merely to confirm success.

![Submit writes a form response. Use it once for this intended order.](forms-guide-order-submit.png)

**Expected result:** **Response captured.** confirms the saved response. The answers remain on screen. Another Submit is another write, so use it only for an intended submission.

![Response captured confirms the submitted response. Submit again only for another intended order.](forms-guide-order-result.png)

## Start a request-form design

Use this when an existing form does not collect the information your workflow needs. The builder selects a FHIR healthcare data format and a record type.

### 1. Choose New

From Forms, open the page dots at the top right and select **New**.

![The Forms page dots menu contains New.](forms-guide-page-actions.png)

![New opens the Form Builder.](forms-guide-new-menu.png)

### 2. Name the form

Enter a name that describes its task. The example uses `Example request form`.

![Name the form for the task people will use it for.](forms-guide-builder-name.png)

### 3. Choose the FHIR version

Open **FHIR Version** and choose the version your records require. The example selects **R4 (most common)**.

![Choose the FHIR version your target records use. This example uses R4.](forms-guide-builder-fhir-version.png)

### 4. Choose the record type

Open **Resource Type**, find **ServiceRequest** and select it for this request-form example.

![Select ServiceRequest to build a request form.](forms-guide-builder-resource.png)

**Expected result:** The available starter pack opens so you can choose its fields.

## Choose starter-pack fields and save a draft

Use the starter pack to keep the fields your form needs. This example keeps Patient, Tests, Results, Priority and Reference Number. Your own workflow may need more fields.

### 1. Clear Requesting Clinician for this example

Clear **Requesting Clinician** when this example form does not collect it.

![Clear Requesting Clinician when this example form does not need it.](forms-guide-pack-clinician.png)

### 2. Clear Clinical Notes for this example

Clear **Clinical Notes**. Keep it selected in your own form if that workflow needs it.

![Clear Clinical Notes when this example form does not need it.](forms-guide-pack-notes.png)

### 3. Clear Referring Facility for this example

Clear **Referring Facility** for the five-field example.

![Clear Referring Facility when this example form does not need it.](forms-guide-pack-facility.png)

### 4. Clear Order rejection for this example

Clear **Order rejection** for this example.

![Clear Order rejection when this example form does not need it.](forms-guide-pack-rejection.png)

### 5. Check the remaining selection

Check that **Patient**, **Tests**, **Results**, **Priority** and **Reference Number** remain selected. The pictured pack shows **5 of 9 selected**.

![Keep the fields needed for the form. This example keeps Patient, Tests, Results, Priority and Reference Number.](forms-guide-pack-choices.png)

![Five fields remain selected for this example form.](forms-guide-pack-selected-count.png)

### 6. Add the fields

Open the starter-pack dots and select **Add 5 fields**.

![The starter pack has its own dots menu.](forms-guide-pack-actions.png)

![Add the five selected fields to this new form.](forms-guide-pack-add.png)

### 7. Save the draft

Open the builder dots at the top right and select **Save draft**.

![Open Builder actions for previewing and saving.](forms-guide-builder-actions-step-7.png)

![Save draft stores the current design without publishing it.](forms-guide-draft-save.png)

**Expected result:** The form definition is saved as a Draft. Saving the design does not submit a response or publish it.

![The builder lists the fields added from the pack.](forms-guide-builder-fields.png)

## Change the reference-field wording

Use this when the form should use wording staff recognise. This example changes Reference Number to Requisition reference.

### 1. Open the field editor

Select the **Reference Number** field's Edit control in the builder.

![Open the Reference Number field to change its label.](forms-guide-field-open.png)

### 2. Change Display Label

In **Display Label**, enter `Requisition reference`.

![Display Label changes the wording shown to the person entering data.](forms-guide-field-label.png)

### 3. Enter a placeholder

In **Placeholder**, enter `Enter the requisition number`. This hint appears inside an empty input.

![Placeholder gives a short hint inside an empty input.](forms-guide-field-placeholder.png)

### 4. Check Required

Leave **Required** off when this answer is optional. Turn it on only when your workflow requires an answer.

![Required makes this answer mandatory. Leave it off when the field is optional.](forms-guide-field-required.png)

### 5. Check Enabled

Keep **Enabled** on so the field appears and collects an answer.

![Enabled controls whether the field appears and collects an answer.](forms-guide-field-enabled.png)

### 6. Apply the field edit

Open the field-editor dots and select **Save**. This applies the edit to the current builder design.

![Field actions contains Save and Cancel.](forms-guide-field-actions.png)

![Save applies field changes to the current design.](forms-guide-field-save.png)

**Expected result:** The field list shows Requisition reference. Use the builder's Save draft or Publish action to store the changed form.

![The field list uses the new label.](forms-guide-field-updated.png)

## Try the design without capturing data

Use Preview to inspect the current builder design before publication. Its example answers do not become submitted form responses.

### 1. Open Preview

Open the builder dots and select **Preview**.

![Open Builder actions for previewing and saving.](forms-guide-builder-actions-step-1.png)

![Preview opens the current design without submitting data.](forms-guide-preview-menu.png)

### 2. Open Preview actions

Select the dots in the Preview sheet header.

![Preview actions contains Fill example and Reset.](forms-guide-preview-actions.png)

### 3. Fill example answers

Select **Fill example**.

![Fill example supplies demonstration answers without saving a response.](forms-guide-preview-fill.png)

### 4. Read the preview

Check the wording, fields and example answers. The example shows the Requisition reference input.

![Preview shows how the form will look with example answers.](forms-guide-preview-filled.png)

### 5. Reset the example answers

Open Preview actions again and select **Reset**.

![Reset clears the demonstration answers.](forms-guide-preview-reset.png)

### 6. Close Preview

Select **Close** at the top right to return to the builder.

![Close returns to the builder.](forms-guide-preview-close.png)

**Expected result:** You return to the same design. Fill example and Reset did not submit a response or save the form definition.

## Save and publish the reviewed design

Use this when the design is ready for use. Publishing stores the current design and creates a numbered snapshot.

### 1. Save the edited draft

Open the builder dots and select **Save draft**.

![Save draft stores the updated design without publishing it.](forms-guide-draft-save-edited.png)

### 2. Publish the design

Open the builder dots again and select **Publish**.

![Publish saves the design and creates a published version.](forms-guide-publish-menu.png)

### 3. Read the published version

Check the published status and generated snapshot number in the header. You cannot type this number.

![The header shows the published state and version number.](forms-guide-published-version.png)

**Expected result:** The Forms list shows the form as Published. Submission still requires valid answers and a configured capture workflow.

![The new form appears as Published in the list.](forms-guide-published-row.png)

## Compare a changed placeholder with a published version

Use this before publishing a later change. The example changes only the reference-field placeholder; its label already matches the published version.

### 1. Change the placeholder

Open the Requisition reference field editor. Change **Placeholder** to `Enter the reference from the paper form`, then use the field dots to Save.

![Make the draft change you want to compare. The example changes the field placeholder.](forms-guide-version-draft-change.png)

### 2. Open Compare

Open the builder dots and select **Compare**.

![Compare reads differences between versions and the current draft.](forms-guide-compare-menu.png)

### 3. Choose the left-hand version

Open the left selector and choose the published snapshot to compare. The example selects **v1**.

![Choose the published version on the From side.](forms-guide-compare-from.png)

![Select the version you want to compare against.](forms-guide-compare-from-version.png)

### 4. Check the right-hand version

Keep **Current draft** in the right selector to compare the design presently in the builder. You can also choose another published version.

![The To side can be Current draft or another published version.](forms-guide-compare-to.png)

### 5. Read the reported difference

The example reports one changed field property, **Field reference-number · placeholder**. It does not report a label change.

![Read the differences before deciding whether to publish or restore.](forms-guide-compare-result.png)

### 6. Close Compare with Escape

Press Escape to return to the builder. Closing Compare does not save or publish the changed design.

![Escape returns to the builder without changing a stored version.](forms-guide-compare-close.png)

**Expected result:** You have reviewed the difference while retaining the current builder edit.

## Save and publish a later content change

Use this after reviewing a change against a published version.

### 1. Save the changed draft

Open the builder dots and select **Save draft**.

![Save the reviewed change as a draft before publishing it.](forms-guide-changed-save-draft.png)

### 2. Check the Draft status

When saved content differs from the published content, the current form becomes **Draft**. View/Run can still open it, but Submit is disabled until publication.

![Changing the stored published content returns the form to Draft.](forms-guide-changed-draft-status.png)

### 3. Publish the reviewed change

Open the builder dots and select **Publish** when the change is ready.

![Publish the reviewed changed draft to create its next version.](forms-guide-changed-publish.png)

**Expected result:** The form becomes Published with the next snapshot number. An unchanged save does not by itself turn a Published form into Draft.

## Restore the content of a published snapshot

Use this when an earlier published design contains the content you want. Restoring replaces the editable form with that snapshot.

### 1. Open Versions

Open the builder dots and select **Versions**.

![Versions opens published snapshots, newest first.](forms-guide-versions-menu.png)

### 2. Find the snapshot

Read its version number, label and publication date. The list puts newest versions first and has pagination when needed.

![Read the version number, label and publication date.](forms-guide-versions-list.png)

### 3. Open the version actions

Select the dots on the snapshot you want to restore. The picture uses version 1.

![Each published version has its own dots menu.](forms-guide-version-row-actions.png)

### 4. Choose Restore

Select **Restore**.

![Restore replaces the editable form with the chosen snapshot.](forms-guide-restore-menu.png)

### 5. Confirm the snapshot

Read the confirmation, then select **Restore** to replace the current design. Cancel keeps the current design.

![Review the selected version. Restoring different content returns it to Draft and disables submission until publication.](forms-guide-restore-confirm.png)

### 6. Check the resulting status

The pictured restore changes the published content, so the form becomes **Draft**. Restoring identical content can leave a Published form Published.

![The restored form is Draft. Publish it again only after reviewing it.](forms-guide-restore-result.png)

**Expected result:** The builder contains the restored content. A restored Draft remains viewable through View/Run, with Submit disabled until it is published.

## Publish reviewed restored content

Use this after checking that restored Draft content is the design you want staff to use.

### 1. Publish the restored form

Open the builder dots and select **Publish**.

![Publish makes the reviewed restored form available again.](forms-guide-republish-menu.png)

### 2. Check the new snapshot number

Read the published version in the header. Republishing creates the next snapshot; it does not reuse the restored snapshot number.

![The reviewed restored form is published again with its next version number.](forms-guide-republished-version.png)

**Expected result:** The restored design is Published again. The example installation has snapshots 1 through 4; those numbers are illustrative.

## Export the form definition

Use this when you need the form as a FHIR Questionnaire JSON file. This export contains the definition, not submitted answers.

### 1. Open the form row actions

Return to Forms and open the dots on the form you want to export.

![The form row menu contains lifecycle and export actions.](forms-guide-list-actions.png)

### 2. Choose Export

Select **Export**. Your browser downloads the Questionnaire JSON file.

![Export downloads the form as a Questionnaire JSON file.](forms-guide-export-menu.png)

**Expected result:** The downloaded file contains the form definition. Export does not submit or change the form.

## Make a separate draft and inspect its submission state

Use Duplicate when you want to adapt an existing form while retaining its original definition.

### 1. Choose Duplicate

From the original form row dots, select **Duplicate**.

![Duplicate creates a separate draft for adapting an existing form.](forms-guide-duplicate-menu.png)

### 2. Check the separate copy

Find the new copy in Forms. It starts as a **Draft**. The original form remains.

![Duplicate creates a separate Draft, leaving the original form unchanged.](forms-guide-duplicate-result.png)

### 3. Open View/Run on the Draft

Open the copy's row dots and select **View/Run**. The page warns that submission is disabled until publication.

![A Draft can be opened for viewing, but submission is disabled until publication.](forms-guide-draft-run-warning.png)

### 4. Check Submit

Open the page dots. **Submit** is disabled on this unpublished form.

![The Submit action is disabled on this unpublished form.](forms-guide-draft-submit-disabled.png)

**Expected result:** The copy remains a separate Draft. Opening View/Run does not publish it or submit answers.

## Archive or delete an unused copy

Use Archive to retain a definition while stopping submission use. Delete permanently removes the chosen definition. The pictures retire only the separate demonstration copy.

### 1. Return to Forms

Select **Forms** in the main menu. Find the copy you intend to retire.

![Forms is in the main menu on the left.](forms-guide-open-page.png)

### 2. Archive the copy

Open its row dots and select **Archive**.

![Archive stops normal submission use while retaining the form definition.](forms-guide-archive-menu.png)

### 3. Check Archived

The copy remains in the management list with **Archived** status. It is no longer Published for submission.

![The archived form remains in the management list with its status.](forms-guide-archive-result.png)

### 4. Choose Delete when removal is intended

If you intend permanent removal, open that same copy's row dots and select **Delete**. Check that you chose the copy, not the original.

![Delete permanently removes the selected form definition. This is only the owned demonstration copy.](forms-guide-delete-menu.png)

### 5. Confirm the named form

Read the form name in the confirmation. Select **Delete** to remove it, or Cancel to keep it.

![Read the named form before confirming. Cancel keeps it.](forms-guide-delete-confirm.png)

**Expected result:** The deleted copy disappears from Forms. The example retained its original form.

## Inspect forms and previews on a phone

Use the same Forms list and builder actions on a phone. A wide table can scroll horizontally.

### 1. Find the form

Use **Search forms** in the phone-width list.

![Forms is available on a phone. Wide table columns can scroll horizontally.](forms-guide-phone-list.png)

### 2. Open Builder actions

Open the form in the builder and select its dots at the top right.

![Builder actions remains available on a phone.](forms-guide-phone-builder-actions.png)

### 3. Choose Preview

Select **Preview** from the builder menu.

![Open Preview from the same builder menu.](forms-guide-phone-preview-menu.png)

### 4. Inspect the phone preview

Read the preview and scroll its fields. Preview actions remains in its header dots.

![Preview opens over the builder at phone width.](forms-guide-phone-preview.png)

**Expected result:** The design remains available for inspection at phone width.

## Limits

This walkthrough captures an order and specimen choice. It does not demonstrate entering laboratory result values or rejecting an order.

Field-editor Save applies a local builder edit. Builder Save draft stores the definition. Publish stores the design and creates a version. Preview actions do none of these writes.

Saving or restoring different content can return a Published form to Draft. Identical content does not force that change. View/Run remains available, but submission requires Published status.

## Troubleshooting

**No patient matches.** Check the search value and whether your normal feed has supplied that patient. Use Patients to inspect the received record.

**A test is absent.** Check that it exists in Test catalog and is switched on at this lab.

**Submit is disabled.** Check the form status and submission-readiness message. Publish a reviewed Draft and check the capture configuration.

**Submit reports invalid answers.** Read the field errors and correct required or invalid values before retrying. A successful Response captured message does not need a second submission.

**Restore leaves Draft.** Review the restored content, then Publish it when it should be available for submission again.

## Related guides

Read [Patients](/docs/patients) for received patient records and [Test catalog](/docs/test-catalog) for lab-enabled tests. Read [Workflows](/docs/workflows) for the capture workflow and [Start here](/docs/start-here) for installation and command-line setup.

## Optional practice

Use a test installation with fictional patients and lab-enabled test definitions. The capture tasks work with your own received records; no documentation sample file is required.

For design practice, use a separate form name and the five-field ServiceRequest example. Try Preview, Save draft, Publish, Compare and Versions. Duplicate that definition before practising Archive or Delete.

Submit a test Lab order only when you intend to write that order. The documented example submitted one response. Its later screenshots did not submit another response.
