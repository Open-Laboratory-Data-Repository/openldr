# v1 request facts in CE (Mozambique slice C)

Date: 2026-09-29. Status: design agreed in chat, awaiting spec review.
Follows slice A (`2026-09-28-v1-facility-dictionary-design.md`) and slice B
(`2026-09-28-testing-lab-on-the-wire-design.md`).

## 1. Goal

Mozambique's reports run on SQL views over OpenLDR v1. Those views list about 45 columns of v1's
`Requests` table. The operator's goal is to match what Mozambique has.

This slice carries the request facts CE does not store yet, in one shape shared by every country.
Porting the views is slice D.

## 2. The user action that is broken today

A Mozambique report cannot be rebuilt in CE, because CE does not hold facts the reports read:
analysis time, point of care, section, the staff who registered, tested and authorised, rejection,
analyser, and a long tail of rarer fields.

## 3. The principle this slice follows

Decided in chat, 2026-09-29:

- **Facts live in one shared model.** No country gets its own table or columns. A fact one country
  needs is added for everyone, and stays empty where a source does not send it.
- **A country's reports are views** over that model: CE custom queries, stored as content, listed
  and exportable. Mozambique's 18 views become 18 custom queries. Another country's are its own
  queries over the same tables.
- **Materialising is a cache, not storage.** A slow view may be materialised with the existing
  workflow dataset publish (`WorkflowDatasetsTable.published_table`). It never becomes the first
  place a fact is stored.

Most v1 columns are not Mozambique-specific. v1 was OpenLDR's shared model; Tanzania, Zambia and
Mozambique all had the same 60-column `Requests` table.

## 4. Evidence

Population of v1 `OpenLDRData.dbo.Requests` over every Tanzanian DISA row (`RequestID like
'TZDISAT%'`, 3,437,966 rows), counting a trimmed empty string as empty and, for numbers, reporting
non-zero values, because v1 writes `''` and `0` as fillers.

| v1 column | Filled | Decision |
|---|---|---|
| RequestID, LIMSPanelCode, LIMSPanelDesc, HL7PriorityCode, RegisteredDateTime | 100% | already in CE (`lab_requests`) |
| SpecimenDateTime, AuthorisedDateTime, HL7ResultStatusCode | 97.0, 78.6, 100% | already in CE (`diagnostic_reports`) |
| ReceivedDateTime, LIMSSpecimenSourceCode/Desc | 95.6, 98.7, 98.6% | already in CE (`specimens`) |
| HL7SexCode | 98.0% | already in CE (`patients`) |
| LIMS/Requesting/Receiving/Testing facility | 100 / 100 / 100 / 84.1% | slices A and B |
| OBRSetID | 100% | typed |
| AnalysisDateTime | 84.1% | typed |
| LIMSPointOfCareDesc | 93.7% | typed |
| HL7SectionCode | 100% (10 values) | typed |
| RequestTypeCode | 100% (2 values) | typed |
| RegisteredBy, TestedBy, AuthorisedBy | 94.0, 79.6, 77.8% | typed |
| AttendingDoctor | 85.8% | typed (from slice B's PractitionerRole) |
| AgeInYears, AgeInDays | 98.4% | typed |
| ClinicalInfo | 16.7% | typed |
| LIMSAnalyzerCode | 34.7% (50 values) | typed |
| LIMSRejectionCode, LIMSRejectionDesc | 2.2, 1.9% | typed |
| Therapy | 0.5% | attribute |
| OrderingNotes | 8.9% | attribute |
| CollectionVolume, CostUnits | 8.7% non-zero | attribute |
| EncryptedPatientID | 29.9% | attribute |
| LIMSVendorCode | 8.2% (1 value) | attribute |
| Deceased, Newborn, Repeated | 26, 661, 18 rows | attribute |
| LOINCPanelCode, AdmitAttendDateTime, ICD10ClinicalInfoCodes, HL7SpecimenSourceCode, the three specimen-site columns, HL7EthnicGroupCode, HL7PatientClassCode, ReferringRequestID, the three LIMSPreReg columns | 0.0% | attribute code registered, nothing else built |
| WorkUnits, TargetTimeDays, TargetTimeMins | 0 on every row | attribute code registered, nothing else built |
| DateTimeStamp, LIMSDateTimeStamp, Versionstamp, LIMSVersionstamp | v1 row metadata | not stored; slice D maps them to CE's own `created_at` and arrival record |

Other facts this design relies on:

| Fact | Proof |
|---|---|
| Only a handful of v1 columns drive view logic; the rest are copied through one SELECT list in 17 views. | `corlix/fixtures/Mozambique_views/openldr-views-script.sql`: RequestID, OBRSetID, LIMSPanelCode and the four facility codes appear in joins and filters; ReferringRequestID and LIMSPreReg_RegistrationFacilityCode only look up coordinates in `HFLattLong` |
| cdr-toolchain's V2 payload already carries section, clinical info, therapy, age, tested by, authorised by, requesting doctor; `analysis_at` is always null. | `cdr-toolchain apps/cli/src/export/types.ts` `V2LabRequest`; `v2-transform.ts` ("disalab doesn't expose analysis_at") |
| cdr-toolchain's v1 export writes constants for analyser code, rejection code, work units and collection volume, and reads RegisteredBy/AnalysisDateTime/AuthorisedBy from the DISA audit log. | `cdr-toolchain apps/cli/src/export/v1-transform.ts:113`, `:279`, `:302`, `:327`, `:330` |
| A resource projects to exactly one warehouse table today; a fan-out resource replaces its set by scope. | `packages/db/src/relational/index.ts:25-50`; memory note on the ValueSet fan-out |
| The next free warehouse migration is 019. | `packages/db/src/migrations/external/` ends at 018; no unmerged branch |

**Tanzania is not Mozambique.** Mozambique's EID and VL views read the `LIMSPreReg_*` hub facility
and `ReferringRequestID`, both 0% here. Mozambique's DISA may fill them. HONEST NON-PROOF until
Mozambique's own v1 is measured.

## 5. Decisions

| # | Decision |
|---|---|
| D1 | Full parity with the views' request columns (option C), for Mozambique's goal, in the shared model. |
| D2 | Common facts are typed columns; rare ones are rows in a generic attributes table (option A). |
| D3 | One `ServiceRequest` projects to two tables: `lab_requests` and `lab_request_attributes` (option A). |
| D4 | A standard FHIR field when one fits exactly; a namespaced extension otherwise. |
| D5 | No country switch in cdr-toolchain. It sends every fact DISA has, for every country. |
| D6 | A fact with no DISA source ships empty and is listed. It is never guessed or filled with a constant. |
| D7 | The attribute vocabulary is an ordinary CodeSystem, imported with the existing terminology import, not seeded by a migration. |

## 6. Design: the wire (cdr-toolchain)

| Fact | FHIR slot |
|---|---|
| section | `DiagnosticReport.category`, system `http://terminology.hl7.org/CodeSystem/v2-0074`, code as v1's `HL7SectionCode` |
| authorised by | `DiagnosticReport.resultsInterpreter[0].display` |
| point of care | `ServiceRequest.locationCode[0].text` |
| clinical info | `ServiceRequest.note[0].text` (already sent) |
| requesting doctor | contained `PractitionerRole.practitioner.display` (slice B, already sent) |
| OBR set | `ServiceRequest.identifier` with system `urn:openldr:obr-set-id` (already sent) |
| analysis time | extension `urn:openldr:ext:analysis-time`, `valueDateTime` |
| registered by | extension `urn:openldr:ext:registered-by`, `valueString` |
| tested by | extension `urn:openldr:ext:tested-by`, `valueString` |
| request type | extension `urn:openldr:ext:request-type`, `valueCode` |
| age at request | extension `urn:openldr:ext:age-at-request` with `years` and `days`, each `valueInteger` |
| analyser | extension `urn:openldr:ext:analyzer`, `valueCode` |
| rejection | extension `urn:openldr:ext:rejection` with `code` (`valueCode`) and `reason` (`valueString`) |
| attributes | repeating extension `urn:openldr:ext:request-attribute`, each with `code` (`valueCoding` in `urn:openldr:cs:request-attribute`) and one `value` (`valueString`, `valueDecimal`, `valueDateTime` or `valueBoolean`) |

Every extension sits on the `ServiceRequest`, except section and authorised by, which sit on the
`DiagnosticReport` their standard fields belong to. An absent fact is omitted, never sent empty.

cdr-toolchain maps DISA fields to attribute codes in a config file, so the code list is not
hard-wired in its source.

## 7. Design: CE

### 7.1 Warehouse

External migration `019`:

- `lab_requests` gains `obr_set_id`, `analysis_at`, `point_of_care`, `section_code`,
  `request_type`, `registered_by`, `tested_by`, `authorised_by`, `requester_practitioner`,
  `age_years`, `age_days`, `clinical_info`, `analyzer_code`, `rejection_code`,
  `rejection_reason`. Nullable, on all three engines.
- New table `lab_request_attributes`: `id`, `lab_request_id`, `system`, `code`, `value_text`,
  `value_number`, `value_datetime`, `value_boolean`, and the usual provenance columns. `id` is
  derived from `lab_request_id` and the code, so a re-send overwrites instead of duplicating. The
  key and index columns use `keyType`, not `textType` (memory: `textType` cannot be a key on SQL
  Server).

`section_code` and `authorised_by` are carried on `lab_requests` although they arrive on the
`DiagnosticReport`: the projection of the report writes them onto its request row. If that
cross-resource write is not safe in the projection, the plan puts them on `diagnostic_reports`
instead and says so.

### 7.2 Projection

- `RelationalResult` may be a list. `ServiceRequest` returns its `lab_requests` row and its
  attribute rows, the attribute rows scoped by `lab_request_id` so a new version replaces the old
  set.
- The writer and the re-projection path handle the list. The three switches in
  `relational/index.ts` that must change together change together.
- Pure functions read each slot in section 6. An unknown extension is ignored.

### 7.3 Vocabulary

`urn:openldr:cs:request-attribute`, a CodeSystem file in the repo holding: therapy, ordering-notes,
collection-volume, cost-units, encrypted-patient-id, vendor-code, deceased, newborn, repeated, and
the codes for the v1 fields that were empty in Tanzania (loinc-panel-code, admit-attend-time,
icd10-clinical-info, hl7-specimen-source, specimen-site-code, specimen-site-desc,
hl7-specimen-site, ethnic-group, patient-class, referring-request-id,
prereg-registration-time, prereg-received-time, prereg-registration-facility, work-units,
target-time-days, target-time-mins). Imported with `openldr terminology import resource`.

### 7.4 Docs

In-app docs (en, fr, pt) and web docs describing the new request facts and the attributes table.

## 8. Order of work

1. **Research first.** For each typed fact, find its DISA source, cite the decoder line and compare
   a sample with v1. Report the list back to the operator before building. This can change the
   build list.
2. CE: migration 019, projection change, vocabulary file, docs. Additive, safe to merge first.
3. cdr-toolchain: the wire shape and the attribute mapping.
4. Re-push a TDS sample and compare every new CE column with v1 for the same requests.

## 9. Testing

- CE: projection tests for every slot and extension; fan-out tests that a re-sent order replaces
  its attributes; migration tests on all three engines (`pnpm mssql:accept`, `pnpm mysql:accept`).
- cdr-toolchain: transform tests and FHIR conformance tests.
- Live: re-push about 50 TDS labs and compare each new column with v1. v1 is the reference for what
  DISA holds.

## 10. Out of scope

- Porting the views (slice D).
- `compare-batch` grading of these fields.
- Measuring Mozambique's own v1.
- v1 `LabResults` columns: CE's `lab_results` already carries the per-result values the views pivot.
