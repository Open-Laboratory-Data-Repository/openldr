# The testing lab on the wire (Mozambique slice B)

Date: 2026-09-28. Status: design agreed in chat, awaiting spec review.
Follows slice A: `2026-09-28-v1-facility-dictionary-design.md`.

## 1. Goal

Put each facility in the FHIR slot that names its role, on the wire from cdr-toolchain and in
CE's warehouse:

- the **lab** that tests the specimen in `DiagnosticReport.performer`;
- the **clinic** that sent it in `ServiceRequest.requester`, together with the doctor.

Mozambique's views read four facility roles (LIMS, requesting, receiving, testing). CE carries
one today, and it is in the wrong slot.

## 2. The user action that is broken today

- A report grouped by lab cannot be built. CE never receives the lab.
- The Clinical Microbiology report prints the requesting clinic under "performing laboratory".
  Its header reads `diagnostic_reports.performer`, and cdr-toolchain puts the clinic there.
- Moz and Zambia are about to build clients against CE's wire shape. Once they do, the wrong slot
  becomes permanent.

## 3. Evidence

| Fact | Proof |
|---|---|
| cdr-toolchain sends the requesting clinic as `DiagnosticReport.performer`. | `cdr-toolchain apps/cli/src/export/fhir-transform.ts:255-266`; `v2-transform.ts:310-373` says DISA's Facility is the requesting clinic |
| cdr-toolchain sends the doctor as `ServiceRequest.requester.display`. | `fhir-transform.ts:236-237` |
| DISA holds no lab code. The lab is the DISA installation. | `v2-transform.ts:316-327`; no lab field in `packages/disalab` |
| In v1, Receiving is the lab that registered the specimen and always equals the lab-number prefix. | 3,437,966 of 3,437,966 `TZDISAT%` rows in `OpenLDRData.dbo.Requests` |
| In v1, Testing is that lab once a result exists; empty rows are nearly all status `I` or `X`. | 548,335 empty; 545,317 are `I`, 2,977 are `X` |
| 9,622 v1 rows are referrals (Testing differs from Receiving, HISTO and GYNAE panels). | same table; the local TDS data has none |
| Lab codes are a separate code space from facility codes. | `TDS`, `TMS`, `TBG` are in neither `DisaGlobal.dbo.LOCNDIC4` nor Tanzania's v1 `Facilities`; in Moz, 46 of 93 `Laboratories` codes also appear in `Facilities` |
| corlix, a v1 client, sends the requesting facility as `ServiceRequest.requester` and the lab as `DiagnosticReport.performer`. | `corlix apps/desktop/src/main/fhir-builder.ts:223-225`, `:448-457` |
| CE projects no requester today. | `packages/db/src/relational/service-request.ts` |
| CE's `ServiceRequest` schema takes `requester` as a plain `Reference` and passes unknown fields through, so a contained resource is accepted. | `packages/fhir/src/resources/service-request.ts:19-22` |
| 12 of CE's 15 seeded report queries read `performer`. | `packages/reporting/src/seed/report-seeds.ts` |
| CE's own lab-order form puts the clinician in `ServiceRequest.requester` (free text) and the referring facility in `ServiceRequest.performer`. | `packages/forms/src/samples/forms.ts:414`, `:456` |

## 4. Decisions

| # | Decision |
|---|---|
| D1 | Correct FHIR slots (option B): lab in `DiagnosticReport.performer`, clinic in `ServiceRequest.requester`. |
| D2 | The lab code comes from a per-installation setting, plus a check that counts lab numbers whose prefix does not match it. The check reports; it never refuses a push. |
| D3 | Referrals are out of scope. The installation's lab is sent on every report. |
| D4 | The lab is sent on pending reports too. v1's empty-until-tested rule is not copied. |
| D5 | CE's own lab-order form is not changed in this slice. |
| D6 | No data migration. Existing CDR data in dev and test installs is re-pushed. No live install holds CDR data. |
| D7 | The doctor and the clinic travel together as a `PractitionerRole` contained in the `ServiceRequest`. |
| D8 | Lab codes use their own identifier system, `urn:openldr:default_lab`, so a lab and a clinic that share a code stay apart. |

## 5. Design: cdr-toolchain

### 5.1 Settings

- `OPENLDR_LAB_CODE`: required when the target is CE, like `OPENLDR_CE_TIMEZONE`
  (`apps/cli/src/commands/export-batch.ts:830`). Preflight fails before any DISA connection when it
  is missing. A `--lab-code` flag overrides it, as `--ce-tz` overrides the timezone.
- `OPENLDR_LAB_NAME`: optional. The lab's display name. Without it, the display is the code.

Both go in `scripts/.env.ce.example` and the push script's preflight.

### 5.2 The prefix check

For every lab in a run, compare the start of its lab number with `OPENLDR_LAB_CODE`. Count the
mismatches. The run summary prints the count and up to five example lab numbers. The push goes
ahead either way.

### 5.3 `DiagnosticReport.performer`

```json
{
  "identifier": { "system": "urn:openldr:default_lab", "value": "<OPENLDR_LAB_CODE>" },
  "display": "<OPENLDR_LAB_NAME, else the code>"
}
```

Sent on every report. One `Organization` per run for the lab, `id` derived from the code alone
(`lab-<code>`), carrying the same identifier and name.

### 5.4 `ServiceRequest.requester`

```json
{
  "contained": [{
    "resourceType": "PractitionerRole",
    "id": "requester",
    "practitioner": { "display": "<doctor>" },
    "organization": {
      "identifier": { "system": "urn:openldr:default_fac", "value": "<DISA facility code>" },
      "display": "<DISA facility name>"
    }
  }],
  "requester": { "reference": "#requester" }
}
```

- `practitioner` is omitted when DISA has no doctor. `organization` is omitted when DISA has no
  facility. When both are absent, `contained` and `requester` are omitted.
- The clinic's `Organization` resource, with its region and district address, keeps being sent as
  today. Its identifier is unchanged.

### 5.5 Checks in cdr-toolchain

- The FHIR conformance tests (`FHIR_CONFORMANCE=1`) cover the new shape.
- The compare gate's `testing_facility_code` field (`apps/cli/src/compare/v2-mapping.ts:154`) is
  pointed at the lab code and compared with v1's `ReceivingFacilityCode`. It fails every lab today
  by design; after this slice it should pass. That is the best evidence the lab code is right.

## 6. Design: CE

### 6.1 Warehouse

External migration `018` adds three columns to `lab_requests`: `requester_code`,
`requester_system`, `requester_display`. Same types as `diagnostic_reports.performer`,
`performer_system` and `performer_display` (`textType`), on Postgres, SQL Server and MySQL.
`EXTERNAL_TABLE_COLUMNS` and `LabRequestsTable` gain the same three names.

Before adding it, check again that no unmerged branch claims `018`.

### 6.2 Projection

One pure function, `requesterFacility(resource)`, in `packages/db/src/relational/`, returns
`{ code, system, display }` or all nulls. In order:

1. `requester.reference` starts with `#`: find that id in `contained`. If it is a
   `PractitionerRole`, read its `organization.identifier` and `organization.display`.
2. `requester.identifier` is present: read it and `requester.display` (corlix's shape).
3. Anything else, including CE's own form's clinician text: all nulls.

`projectServiceRequest` writes the result into the three new columns. The doctor is not projected.

### 6.3 Facility codes from both roles

Today these read codes from `diagnostic_reports.performer` only:

- `scanObservedFacilities` and `resolveObservedFacilities` (`packages/bootstrap/src/facility-reconcile.ts`);
- `publishFacilityMap`, which builds on the resolver;
- the capture at ingest (`captureObservedFacilityFromProjection`).

They read both:

- lab codes from `diagnostic_reports.performer` and `performer_system`;
- clinic codes from `lab_requests.requester_code` and `requester_system`.

The system each code resolves into follows the existing rule: the wire system when present, else
the feed's system. `facility_map` stays one row per feed, system and code, whatever the role.
Report counts on the Observed tab add both roles. Link-matching (slice A) works unchanged,
because it reads the resolver.

### 6.4 Reports

Each of the 12 seeded queries that read `performer` is checked by hand:

- a query that groups or filters by where samples came from moves to the clinic, joining
  `diagnostic_reports.based_on_id` to `lab_requests.id` and `facility_map` on the requester columns;
- a query that means the lab stays on `performer`. The Clinical Microbiology header's "performing
  laboratory" is one, and becomes correct.

Every changed query gets a test that pins which role it reads. The plan lists each query with its
role before any change. SQL for other dialects moves with it where the seed carries them.

### 6.5 Docs

In-app docs in en, fr and pt, and web docs in English, for:

- what the Observed tab now lists (labs and clinics);
- which role each changed report groups by.

`docs/HTTP-API.md` is unchanged, since no route changes. cdr-toolchain's push docs describe the two
new settings.

## 7. Order of work

1. CE: migration, projection, facility codes from both roles, reports. Safe to merge first: the new
   columns stay empty until the wire changes.
2. cdr-toolchain: settings, check, new wire shape.
3. Re-push the dev data. Between steps 1 and 3, dev reports grouped by clinic are empty.

## 8. Testing

- cdr-toolchain: unit tests for the settings, the prefix check, `performer`, the contained
  `PractitionerRole` and each omission case; conformance tests; the compare gate on a sample.
- CE: unit tests for `requesterFacility` covering all three cases; migration tests on the three
  engines; resolver tests with lab and clinic codes, including one code used by both a lab and a
  clinic; a test per changed report query.
- A test that CE's Bundle unwrap node leaves a `#requester` reference untouched.
- Live: re-push a sample of TDS labs to the dev CE and check that `lab_requests.requester_code`
  holds the clinic, `diagnostic_reports.performer` holds `TDS`, and the reports group as intended.

pg-mem proves the SQL shape, not engine behaviour. The three-engine migration tests and the live
re-push prove the rest.

## 9. Out of scope, listed

- Referrals, where the testing lab differs from the registering lab. DISA's decoder has no field
  for it.
- CE's own lab-order form (D5).
- A role column on the Observed tab.
- Renaming `facility_map.performer_system`, which now holds lab and clinic systems.
- Projecting the doctor into the warehouse (slice C).
- A Moz lab register. Slice A's link-matching can link one later without code.
