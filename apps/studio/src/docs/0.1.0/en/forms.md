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
11. Remove fields only after confirming no published workflow or report depends on them.
12. Use **Preview** to test the form before publishing.
13. Select **Save draft**.
14. Select **Publish** when the form is ready for users.
15. Use **Compare** to review changes between versions.

![Form builder with field palette, preview, editor, and actions](form-builder.png)

16. From the form list, choose **View/Run**.
17. Fill required fields and submit the response.

![Published form capture screen](form-capture.png)

18. Use form actions to duplicate, archive, export, export a marketplace bundle, or delete when appropriate.

## Expected result

The form is saved as a draft during design, published when ready, and available from **View/Run** for structured submissions.

## Troubleshooting

- **Publish is unavailable:** finish required form metadata or fix invalid field configuration.
- **A required field blocks submission:** confirm the field type, validation rule, and conditional visibility.
- **A terminology field has no options:** check the terminology binding and the selected ValueSet.
- **Users see the wrong page after submit:** review the configured target pages.

## FHIR path validation

When a form maps to a FHIR resource type, the builder checks each field's FHIR path against the element list.

A red badge means an error blocks publishing. A yellow badge means a warning that does not block publishing but you should review.

The builder only checks resource types in the built-in element list, which covers nine common types. Forms using other resource types show no badges because they are not path-checked at all.

### unknown-fhir-path (error)

The path is not an element of this resource type.

Usually a typo in the path. Check the spelling and nesting depth. If the path is correct and the resource type is outside the built-in nine types, the form will not be checked.

### facility-admin-order (error)

The facility administrative levels are bound to FHIR address parts in the wrong order.

For example, binding Zone to an address part that FHIR nests inside the one Region is bound to. Reorder the field bindings to match the FHIR structure.

### fhir-path-cardinality (warning)

The path passes through an element that can repeat with no discriminator.

The path cannot resolve which occurrence to use. Add a FHIR discriminator on the field to pick a specific occurrence.

### fhir-path-type-mismatch (warning)

A plain input is bound to a structured FHIR element that a single value cannot fill.

Change the field type to match the FHIR structure, or bind a more specific path that points to a simpler element.

### From the command line

Operators running without the studio can run `openldr forms lint` to get the same findings.

You can pass an optional form ID to lint a single form. Use `--json` for structured output. The command exits non-zero when any error is present.

## Advanced web usage

- Use validation rules for format, range, and required-value checks close to the point of capture.
- Use conditional visibility to keep forms shorter while still collecting detail when it matters.
- Bind coded fields to terminology so downstream reports and workflows receive consistent values.
- Use repeatable fields for repeated observations instead of creating many near-duplicate fields.
- Treat published versions as user-facing contracts; create a new version when changing meaning, not just wording.

## Related guides

- [Terminology](/docs/terminology)
- [Marketplace](/docs/marketplace)
