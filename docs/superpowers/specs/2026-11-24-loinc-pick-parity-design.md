# Test catalog: Corlix parity for defining a test

Status: for operator approval, 2026-11-24.

## 1. Why

The operator compared CE's Test sheet with Corlix's test editor after picking a LOINC code
(screenshots, 2026-11-24) and asked for parity: "follow corlix (parity), so option 1 and all".
They then asked that the sheet's order make sense, with the LOINC code first and not below
the name.

The Corlix source read for this design is in the `corlix` repo at `0f308aee`:
- `apps/desktop/src/renderer/pages/TestEditorPage.tsx`, the editor;
- `lib/specimenMatch.ts` and `lib/scaffoldFields.ts`;
- `components/TermPicker.tsx`, `ReferenceRangeDialog.tsx` and `TestCodingDialog.tsx`;
- `ontology/OntologyPickerDialog.tsx`;
- `packages/shared-types/src/index.ts:1030-1050`, the range shape.

What CE does today:
- **The pick.** `pickLoinc` fills an empty category and one specimen, and nothing else
  (`apps/studio/src/test-catalog/TestSheet.tsx:233-250`). The result field is a hint line, made
  only from the ⋯ menu (call 6 of `2026-11-23-test-catalog-hints-design.md`).
- **Short names.** The LOINC loader does not keep LOINC's short name
  (`packages/terminology/src/loaders/loinc.ts:18-33`).
- **Specimens.** The default specimen list has four local codes, BLD, UR, CSF and SPT, with no
  SNOMED link (`packages/db/src/migrations/internal/014_value_sets.ts:61`).
- **Result types.** A result parameter is `numeric`, `coded` or `text`
  (`packages/bootstrap/src/result-params.ts:49`). It has no required mark, limits or field order.
- **Additional codings.** A test holds one LOINC code and no other codings.

## 2. The sheet's order

Like Corlix, top to bottom:
1. LOINC code, with search and Browse;
2. Additional codings;
3. Basic information: code, name, short name, category, TAT, verification;
4. Specimen types;
5. Result parameters, with their settings;
6. Reference ranges.

This order applies to new and saved tests alike.

## 3. Calls: the LOINC pick (plan A)

1. **Name and short name.** A pick fills an empty name from LOINC's long common name, and an
   empty short name from LOINC's short name. The loader starts keeping `SHORTNAME`. A lab that
   loaded LOINC before this change loads it again to get short names.
2. **The result field goes into the unsaved test.**
   - A pick adds LOINC's result field to the test, ticked and marked "New, saved with the
     test". Nothing is written until Save.
   - Save creates the missing dictionary fields and answer lists first, through the existing
     from-LOINC function, and then saves the test.
   - Picking another code, or clearing it, drops the new fields that came from the old code.
     Fields already in the dictionary are ticked, not created again. Ticks made by hand stay.
3. **Field name and type, as Corlix.**
   - The field is named from LOINC's component ("HIV 1 RNA"), not the long name.
   - Its type comes from LOINC's scale. `Qn` becomes numeric with LOINC's unit. `Ord` becomes
     coded, with LOINC's answer list. Anything else becomes text.
   - The same rule applies to "Fill from panel".
4. **Fill from panel.** When the test already has fields, the ⋯ item asks "Replace" or "Add".
   "Add" skips members already present, as today.
5. **Specimens.**
   - A new migration (143) adds the rest of Corlix's 15 specimen types to the default list with
     local codes: Plasma, Serum, Stool, Pleural fluid, Ascitic fluid, Saliva, Wound specimen,
     Throat swab, Nasal swab, Synovial fluid and Bone marrow.
   - A local concept map links all 15 to their SNOMED codes, so the existing `$translate` match
     works with no mapping by hand.
   - One equivalent match is ticked. Several are marked "suggested" on their checkboxes, as
     Corlix does.
   - When LOINC has no specimen link for the code, the sheet matches LOINC's `SYSTEM` part to a
     specimen type's name, as Corlix's fallback does.
   - The migration only adds missing codes, so a lab that edited its list keeps its edits.
6. **Category.** When the category differs from LOINC's class, the hint becomes a button,
   "MICRO, suggested". One click sets it.
7. **Search and Browse.**
   - Each search result shows a second line with the short name, class and unit.
   - A "Browse LOINC" item in the LOINC row's ⋯ menu opens the existing LOINC tree
     (`apps/studio/src/terminology/ontology/OntologyPickerDialog.tsx`). A pick there works like
     a search pick.

## 4. Calls: the test's own settings (plan B)

8. **Field settings.** Each `TestResultParam` gains `required` (true by default), and per type:
   - numeric: `min`, `max`, `decimals`;
   - text: `minLength`, `maxLength`;
   - date: `dateLimit`, one of any, past only or future only.

   They are stored in the test's `resultParams`, so they need no migration and sync from central
   with the test. A field's ⋯ menu gains Required, Settings, Move up and Move down. The lab
   plugin's result entry enforces them, and the bench shows them.
9. **More field types.** `ResultType` gains `boolean`, `date` and `multicoded`.
   - The forms extractor and the lab plugin send `boolean` as `valueBoolean` and `date` as
     `valueDateTime`.
   - `multicoded` sends one Observation per chosen answer, each with the field's code.
   - Organism and antibiogram stay out, because microbiology is a non-goal of the lab plugin.
10. **Range fields.** `ResultBand` gains:
    - `pregnancy`: pregnant, not pregnant, or any;
    - `country`: ISO 3166 code or none;
    - `validFrom` and `validTo`: dates or none;
    - `source`: WHO, CLSI, EUCAST, national or facility;
    - `scope`: global, national or facility.

    Corlix stores these and never uses them to pick a range. CE uses some of them:
    - A band outside its valid dates, or for another country than the lab's, does not fit.
    - A pregnancy band answers unknown, because CE does not hold pregnancy status. The bench
      picks it, as for an estimated birth date.
    - Source and scope are labels only.

    Altitude stays a named range picked at the bench, as the operator ruled before.
11. **Additional codings.** A test gains `codings`: a list of system, code, display, purpose and
    note.
    - The purposes are Additional, Indication, Procedure and Category, as Corlix has.
    - They are stored as a concept property, edited in their own section with a ⋯ menu per row
      and an "Add coding" sheet, and searched through the TermPicker over any loaded system.
    - The CSV import and export and the CLI carry them. `testCatalog.get` answers them.
    - FHIR `ServiceRequest.code` adds them as extra codings beside the LOINC code.

## 5. Not copied

- Corlix's standalone buttons. CE keeps them in ⋯ menus (AGENTS.md section 5).
- "Export as package" and "Publish to registry" on a test. CE moves content through packs.
- Organism and antibiogram field types.

## 6. Five places

- **UI:** the Test sheet, and mobile at 375 px.
- **CLI:**
  - `test-catalog loinc-hints` answers the short name and the component;
  - `test-catalog set` carries codings;
  - `test-catalog params --set` carries the field settings, the new types and the range fields
    through `parseResultParams`.
- **Docs:** the Test catalog guide, in-app and web, in en, fr and pt. The lab plugin's guide
  covers the new types and the checks.
- **Lab plugin:** result entry for the new types and settings, and band labels for the new range
  fields.
- **Changelog:** after each merge.

## 7. Order and proof

Plan A first, then plan B. Each plan ends with a live run on a throwaway install, using the
LOINC fixture, and an update of 3220 after the operator approves the merge.

**HONEST NON-PROOF.** Real LOINC stays unproved until a licensed copy is loaded.
