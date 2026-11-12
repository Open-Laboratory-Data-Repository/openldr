8 findings: 3 confirmed, 5 refuted, 0 convention-conflict, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| F1 | The captured Lab order produced a stored request. | CONFIRMED | `forms-evidence/order-submitted.json` records warehouse requests increasing from 1 to 2. Retained native `order-result.png` shows Response captured. | Documentation only |
| F2 | Fill example writes a form response. | REFUTED | `apps/studio/src/forms-builder/PreviewSheet.tsx:38` changes local answers. Its runtime has a no-op submit handler at line 55. | None |
| F3 | Save draft always unpublishes a Published form. | REFUTED | `packages/forms/src/store.ts:310` changes status only when published content differs. | None |
| F4 | Restoring a version always produces Draft. | REFUTED | `packages/forms/src/store.ts:416` restores through update. The content-change condition at line 310 controls Published to Draft. | None |
| F5 | Draft forms cannot open through View/Run. | REFUTED | `apps/studio/src/pages/Forms.tsx:321` always offers View/Run. `apps/studio/src/pages/FormCapture.tsx:123` disables Submit when unpublished. Native copy evidence confirms both. | None |
| F6 | The pictured comparison changed the label and placeholder. | REFUTED | Native `compare-result.png` shows one change, Field reference-number · placeholder. The label already matched the selected snapshot. | None |
| F7 | Publication and restored-content publication create numbered snapshots. | CONFIRMED | `forms-evidence/publication-proof.json` records Published with versions 4, 3, 2 and 1. `packages/forms/src/store.ts:367` calculates the next number. | Documentation only |
| F8 | Duplicate creates a Draft that can be archived and deleted separately. | CONFIRMED | `forms-evidence/copy-lifecycle-proof.json` records createdAsDraft, archived, deleted and originalRetained as true. | Documentation only |

# Forms guide review

Preview prose only. This pass authored `forms-guide.json` and this review note. It did not capture images, generate the article or preview, change the app, or commit anything. Root owns the capture script, generation, review and checkpoint.

## Evidence checked

The guide uses the actual Forms page and builder labels. It covers the published Lab order patient, test, specimen, priority and Submit sequence. It then covers a separate R4 ServiceRequest design, five starter-pack fields, field wording, Preview, draft saving, publication, comparison, restoration, export, duplication, retirement and phone use.

The starter-pack task has separate steps for clearing Requesting Clinician, Clinical Notes, Referring Facility and Order rejection. The new native images show each choice. The remaining selection is Patient, Tests, Results, Priority and Reference Number. The selected-count image says 5 of 9 selected and the menu offers Add 5 fields.

`forms-evidence/unsaved-recapture-proof.json` records that the refreshed starter-pack and field-editor sequence used an unsaved prototype. It records persisted false and submitted false. These pictures restore the initial Reference Number wording without changing the separately stored example form. The guide distinguishes field-editor Save from builder Save draft.

The comparison image was inspected. It shows v1 versus Current draft and exactly one changed property, placeholder. The guide does not claim a label change in that comparison. Current draft uses the design currently in the builder, including unsaved edits, through `apps/studio/src/forms-builder/CompareDialog.tsx:35`. Escape closes the existing comparison dialog without saving the form.

`forms-evidence/restore-proof.json` records a restore to version 1 that produced Draft because it changed the published content. The guide also states the conditional case: restoring identical content can leave a Published form Published. Restore itself creates no version row, as documented at `packages/forms/src/store.ts:408`. Republishing takes the next number.

`forms-evidence/exported-form.questionnaire.json` is a Questionnaire definition for Example request form. Export uses the stored schema through `apps/server/src/forms-routes.ts:375`. The guide does not present it as a response export.

## The single submission and power-cut recovery

The successful submission was not repeated. `forms-evidence/order-submitted.json` records warehouse request counts of 1 before and 2 afterward. It explicitly states that the original transport-response JSON did not survive the power cut.

`forms-evidence/original-submission.png` retains the original native successful state. `order-result.png` is an exact copy used by the guide. The manifest states how it was recovered and how its focus bounds were measured. A read-only byte comparison returned true. Both images have SHA-256 `3045eebd6eb68d15555d2b3975a1ed1b65174b4f29968bd21ee04e35fd8aed1b`.

Later order-evidence captures stopped before submitting. Fresh pack and field images used an unsaved prototype. The prose never asks the operator to repeat a successful submission for verification.

HONEST NON-PROOF: no retained transport-response body or original HTTP status is available for the successful order. The native success message and recorded warehouse change support the observed outcome. They do not reconstruct the lost wire response. Another submission would be a different write and would not recover that evidence.

## Authoring checks

A read-only structural check exited 0 and printed:

```json
{"tasks":15,"numberedSteps":70,"maxStepsPerTask":8,"evidencePlacements":82,"manifestImages":80,"missingEvidence":[],"nativeDimensionMismatches":[],"submissionImagesIdentical":true}
```

Every task has purpose text before its numbered steps. Every numbered step references native evidence. The check read PNG headers and compared them with the manifest. Desktop captures are 5120 x 3200; phone captures are 1500 x 3248. No PNG was edited by this authoring pass.

New prose passed an unslop review. It uses actual labels, defines the builder's FHIR choice as a healthcare data format, uses short sentences and has no em dashes. Real installation data comes first. Optional practice is the final section.

HONEST NON-PROOF: this authoring pass did not run article generation or `check-guide-preview.cjs forms`. Root must perform the preview checks after generating the article. The structural check proves evidence references and native dimensions, not rendered framing or navigation.

## Remaining limits

HONEST NON-PROOF: Preview's no-write behaviour is source-backed here. This pass did not compare live response counts before and after Fill example and Reset. The no-op submit handler is `apps/studio/src/forms-builder/PreviewSheet.tsx:55`.

HONEST NON-PROOF: identical-content restoration retaining Published is source-backed by the conditional update path. The retained live restore proof covers different content becoming Draft. A controlled identical-content restore would prove the other live variant.

HONEST NON-PROOF: the exported Questionnaire was inspected, but it was not re-imported in this pass. An import and field comparison would prove round-trip fidelity.

HONEST NON-PROOF: phone captures show the list, builder actions and Preview at 375 x 812. They do not prove retractable browser-chrome or bottom-edge behaviour. Only a real phone can confirm that.

The walkthrough does not cover result-value entry, order rejection, every field type, every resource type or every capture workflow. Those behaviours should not be inferred from this request-form example. Translations, publication and app changes were skipped.

## Separate app copy issue

`apps/studio/src/i18n/en.ts:353` says View/Run requires publication. The actual menu opens Draft forms, while only submission is disabled. The guide follows the actual behaviour and names the disabled Submit control. This pass did not change that existing app text.

Compare uses the existing Dialog in `apps/studio/src/forms-builder/CompareDialog.tsx:47`. This guide records the existing comparison UI and Escape behaviour. No new Dialog or app UI was introduced.
