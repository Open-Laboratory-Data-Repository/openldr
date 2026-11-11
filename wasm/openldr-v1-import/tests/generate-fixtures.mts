// Generates the golden files in ./fixtures from the TypeScript mapping in the cdr-toolchain repo.
//
// The Rust mapping in this crate is a port of that TypeScript. tests/golden.rs asserts that the
// Rust output equals these files, so the two copies cannot drift without a test failing. Re-run
// this after any change to cdr-toolchain's v1-push or ce-fhir mapping, then fix the Rust until
// the golden test passes.
//
// Run from the cdr-toolchain repo, so its packages resolve:
//
//   cd <cdr-toolchain>/apps/v1-push
//   node --import tsx <openldr_ce>/wasm/openldr-v1-import/tests/generate-fixtures.mts
//
// Every row below is made up. No real patient data goes into a fixture.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDR = resolve(process.cwd(), '..', '..');
const { toPayload } = await import(join(CDR, 'apps/v1-push/src/to-payload.ts'));
const { loadAttributeRules } = await import(join(CDR, 'apps/v1-push/src/attributes.ts'));
const { groupRows } = await import(join(CDR, 'apps/v1-push/src/read.ts'));
const { toFhir } = await import(join(CDR, 'packages/ce-fhir/src/index.ts'));

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures');
const rules = loadAttributeRules(join(CDR, 'config/v1-request-attributes.yaml'));

type Row = Record<string, unknown>;
interface Case {
  name: string;
  tz?: string;
  keys: string[];
  requests?: Row[];
  results?: Row[];
  patients?: Row[];
  ast?: Row[];
}

// Columns the mssql driver returns as a Date. The import host sends them to the plugin as
// wall-clock text ("2024-03-05T14:30:07.120"); the TypeScript expects the Date.
const DATE_COLUMNS = new Set([
  'SpecimenDateTime', 'ReceivedDateTime', 'RegisteredDateTime', 'AnalysisDateTime', 'AuthorisedDateTime',
  'LIMSPreReg_RegistrationDateTime', 'LIMSPreReg_ReceivedDateTime', 'AdmitAttendDateTime', 'DOB',
]);
function asDriverRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = DATE_COLUMNS.has(k) && typeof v === 'string' ? new Date(`${v}Z`) : v;
  }
  return out;
}

// A full Requests row with every selected column null, so a case only states what it sets.
const REQUEST_COLUMNS = [
  'RequestID', 'OBRSetID', 'LIMSPanelCode', 'LIMSPanelDesc', 'LIMSSpecimenSourceCode', 'LIMSSpecimenSourceDesc',
  'RequestingFacilityCode', 'TestingFacilityCode', 'SpecimenDateTime', 'ReceivedDateTime', 'RegisteredDateTime',
  'AnalysisDateTime', 'AuthorisedDateTime', 'ClinicalInfo', 'ICD10ClinicalInfoCodes', 'Therapy', 'HL7PriorityCode',
  'AgeInYears', 'AgeInDays', 'HL7SexCode', 'HL7PatientClassCode', 'HL7SectionCode', 'HL7ResultStatusCode',
  'AttendingDoctor', 'TestedBy', 'AuthorisedBy', 'RegisteredBy', 'RequestTypeCode', 'LIMSAnalyzerCode',
  'LIMSRejectionCode', 'LIMSRejectionDesc', 'LIMSPointOfCareDesc', 'LIMSPreReg_RegistrationDateTime',
  'LIMSPreReg_ReceivedDateTime', 'LIMSPreReg_RegistrationFacilityCode', 'LOINCPanelCode', 'AdmitAttendDateTime',
  'CollectionVolume', 'HL7SpecimenSourceCode', 'HL7SpecimenSiteCode', 'LIMSSpecimenSiteCode', 'LIMSSpecimenSiteDesc',
  'WorkUnits', 'CostUnits', 'OrderingNotes', 'EncryptedPatientID', 'HL7EthnicGroupCode', 'Deceased', 'Newborn',
  'ReferringRequestID', 'TargetTimeDays', 'TargetTimeMins', 'Repeated',
];
const RESULT_COLUMNS = [
  'RequestID', 'OBRSetID', 'OBXSetID', 'OBXSubID', 'HL7ResultTypeCode', 'SIValue', 'SIUnits', 'SILoRange', 'SIHiRange',
  'HL7AbnormalFlagCodes', 'CodedValue', 'LIMSObservationCode', 'LIMSObservationDesc', 'LIMSRptResult', 'LIMSRptUnits',
  'LIMSRptFlag', 'LIMSRptRange', 'LIMSCodedValue',
];
const PATIENT_COLUMNS = ['RequestID', 'SURNAME', 'FIRSTNAME', 'DOB', 'NATIONALID', 'MOBILE', 'TELHOME', 'EMAIL', 'HOSPID'];
const AST_COLUMNS = [
  'RequestID', 'OBRSetID', 'OBXSetID', 'OBXSubID', 'LIMSSubstanceCode', 'LIMSSubstanceName', 'ORGANISM',
  'LIMSOrganismCode', 'BreakpointType', 'Methodology', 'Units', 'ASTValue', 'ASTResult',
];
const full = (columns: string[]) => (row: Row): Row => ({ ...Object.fromEntries(columns.map((c) => [c, null])), ...row });
const req = full(REQUEST_COLUMNS);
const res = full(RESULT_COLUMNS);
const pat = full(PATIENT_COLUMNS);
const ast = full(AST_COLUMNS);

const cases: Case[] = [
  {
    name: 'plain-vl',
    keys: ['REQ0001'],
    requests: [req({
      RequestID: 'REQ0001', OBRSetID: 1, LIMSPanelCode: 'HIVVL', LIMSPanelDesc: 'HIV Viral Load',
      LIMSSpecimenSourceCode: 'PLS', LIMSSpecimenSourceDesc: 'Plasma', RequestingFacilityCode: 'FAC01',
      TestingFacilityCode: 'LAB01', SpecimenDateTime: '2024-03-04T09:15:00.000', ReceivedDateTime: '2024-03-05T08:00:00.000',
      RegisteredDateTime: '2024-03-05T14:30:07.120', AnalysisDateTime: '2024-03-06T10:00:00.000',
      AuthorisedDateTime: '2024-03-06T16:45:30.000', ClinicalInfo: 'Routine monitoring', ICD10ClinicalInfoCodes: 'B20',
      Therapy: 'TDF/3TC/DTG', HL7PriorityCode: 'R', AgeInYears: 34, AgeInDays: 12500, HL7SexCode: 'F',
      HL7PatientClassCode: 'O', HL7SectionCode: 'VIR', HL7ResultStatusCode: 'F', AttendingDoctor: 'Dr Test',
      TestedBy: 'tech1', AuthorisedBy: 'auth1', RegisteredBy: 'clerk1', RequestTypeCode: 'ROUTINE',
      LIMSAnalyzerCode: 'CAP96', LIMSPointOfCareDesc: 'Clinic A',
    })],
    results: [
      res({ RequestID: 'REQ0001', OBRSetID: 1, OBXSetID: 1, OBXSubID: 1, HL7ResultTypeCode: 'NU', SIValue: 40, SIUnits: 'copies/mL', LIMSObservationCode: 'HIVVM', LIMSObservationDesc: 'HIV VL copies', LIMSRptResult: '40', LIMSRptUnits: 'cp/mL' }),
      res({ RequestID: 'REQ0001', OBRSetID: 1, OBXSetID: 2, OBXSubID: 1, HL7ResultTypeCode: 'NU', SIValue: 0, LIMSObservationCode: 'HIVVL', LIMSObservationDesc: 'HIV VL log', LIMSRptResult: '< 20', LIMSRptUnits: 'cp/mL' }),
      res({ RequestID: 'REQ0001', OBRSetID: 1, OBXSetID: 3, OBXSubID: 1, HL7ResultTypeCode: 'T', LIMSObservationCode: 'HIVVC', LIMSObservationDesc: 'Comment', LIMSRptResult: 'Target Not Detected' }),
      res({ RequestID: 'REQ0001', OBRSetID: 1, OBXSetID: 4, OBXSubID: 1, HL7ResultTypeCode: 'C', CodedValue: 'TND', LIMSObservationCode: 'HIVVS', LIMSObservationDesc: 'Status', LIMSRptResult: 'Not detected', LIMSCodedValue: 'ND' }),
    ],
    patients: [pat({ RequestID: 'REQ0001', SURNAME: 'Testsurname', FIRSTNAME: 'Testname', DOB: '1990-01-15T00:00:00.000', NATIONALID: 'NID-000-TEST', MOBILE: '0000000001', TELHOME: '0000000002', EMAIL: 'test@example.test', HOSPID: 'H-0001' })],
  },
  {
    name: 'no-patient-and-sex-codes',
    keys: ['SEX-M', 'SEX-F', 'SEX-U', 'SEX-I', 'SEX-X', 'SEX-NULL'],
    requests: [
      req({ RequestID: 'SEX-M', OBRSetID: 1, HL7SexCode: 'M' }),
      req({ RequestID: 'SEX-F', OBRSetID: 1, HL7SexCode: ' f ' }),
      req({ RequestID: 'SEX-U', OBRSetID: 1, HL7SexCode: 'U' }),
      req({ RequestID: 'SEX-I', OBRSetID: 1, HL7SexCode: 'I' }),
      req({ RequestID: 'SEX-X', OBRSetID: 1, HL7SexCode: 'X' }),
      req({ RequestID: 'SEX-NULL', OBRSetID: 1 }),
    ],
    patients: [
      // A patient row with nothing in it, and one whose phone falls back to TELHOME.
      pat({ RequestID: 'SEX-M' }),
      pat({ RequestID: 'SEX-F', SURNAME: '  ', FIRSTNAME: 'Only', TELHOME: '0000000009', DOB: '1899-12-30T00:00:00.000' }),
    ],
  },
  {
    name: 'statuses-priorities-two-obr',
    keys: ['ST-F', 'ST-P', 'ST-C', 'ST-X', 'ST-R', 'ST-I', 'ST-OTHER', 'MULTI'],
    requests: [
      req({ RequestID: 'ST-F', OBRSetID: 1, HL7ResultStatusCode: 'F', HL7PriorityCode: 'R', LIMSPanelCode: 'CD4' }),
      req({ RequestID: 'ST-P', OBRSetID: 1, HL7ResultStatusCode: 'p', HL7PriorityCode: 'U', LIMSPanelCode: 'CD4' }),
      req({ RequestID: 'ST-C', OBRSetID: 1, HL7ResultStatusCode: 'C', HL7PriorityCode: 'S', LIMSPanelCode: 'CD4' }),
      req({ RequestID: 'ST-X', OBRSetID: 1, HL7ResultStatusCode: 'X', HL7PriorityCode: 'Z', LIMSPanelCode: 'CD4', LIMSRejectionCode: 'HAEM', LIMSRejectionDesc: 'Haemolysed sample' }),
      req({ RequestID: 'ST-R', OBRSetID: 1, HL7ResultStatusCode: 'R', LIMSPanelCode: 'CD4', LIMSRejectionCode: 'QNS' }),
      req({ RequestID: 'ST-I', OBRSetID: 1, HL7ResultStatusCode: 'I', LIMSPanelCode: 'CD4', LIMSRejectionDesc: 'Only a reason' }),
      req({ RequestID: 'ST-OTHER', OBRSetID: 1, HL7ResultStatusCode: 'Q' }),
      // Two panels on one request. OBR 2 comes first in the rows; OBR 1 still supplies the patient's sex.
      req({ RequestID: 'MULTI', OBRSetID: 2, LIMSPanelCode: 'FBC', LIMSPanelDesc: 'Full blood count', HL7SexCode: 'M', RequestingFacilityCode: 'FAC02', TestingFacilityCode: 'LAB01', SpecimenDateTime: '2024-05-01T07:00:00.000' }),
      req({ RequestID: 'MULTI', OBRSetID: 1, LIMSPanelCode: 'CD4', LIMSPanelDesc: 'CD4 count', HL7SexCode: 'F', RequestingFacilityCode: 'FAC01', TestingFacilityCode: 'LAB01', SpecimenDateTime: '2024-05-01T06:30:00.000' }),
      req({ RequestID: 'MULTI', OBRSetID: 3, LIMSPanelCode: 'EMPTY', RequestingFacilityCode: 'FAC01', TestingFacilityCode: 'FAC01' }),
    ],
    results: [
      res({ RequestID: 'MULTI', OBRSetID: 1, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'CD4A', LIMSRptResult: '512' }),
      res({ RequestID: 'MULTI', OBRSetID: 2, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'HB', LIMSRptResult: '13.5', SIUnits: 'g/dL' }),
      res({ RequestID: 'MULTI', OBRSetID: 2, OBXSetID: 2, OBXSubID: 1, LIMSObservationCode: 'WBC', LIMSRptResult: '6.1' }),
      // Orphans: an OBR no Requests row has, and a null OBR.
      res({ RequestID: 'MULTI', OBRSetID: 9, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'LOST', LIMSRptResult: '1' }),
      res({ RequestID: 'MULTI', OBRSetID: null, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'LOST2', LIMSRptResult: '2' }),
    ],
  },
  {
    name: 'result-values-and-ranges',
    keys: ['VAL'],
    requests: [req({ RequestID: 'VAL', OBRSetID: 1, LIMSPanelCode: 'CHEM', SpecimenDateTime: '2024-06-10T11:22:33.000' })],
    results: [
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'A', LIMSRptResult: '>10', LIMSRptRange: '4.0-11.0', SIUnits: 'mmol/L', HL7AbnormalFlagCodes: 'H' }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 2, OBXSubID: 1, LIMSObservationCode: 'B', LIMSRptResult: '.5', LIMSRptRange: 'see note', LIMSRptUnits: 'g/L', HL7AbnormalFlagCodes: ' L ' }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 3, OBXSubID: 1, LIMSObservationCode: 'C', LIMSRptResult: '20.', SILoRange: 1.5, SIHiRange: 3 }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 4, OBXSubID: 1, LIMSObservationCode: 'D', LIMSRptResult: '-3.25', SILoRange: 0, SIHiRange: 0 }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 5, OBXSubID: 1, LIMSObservationCode: 'E', LIMSRptResult: '1,200', SILoRange: 0, SIHiRange: 5 }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 6, OBXSubID: 1, LIMSObservationCode: 'F', LIMSCodedValue: 'POS', LIMSRptFlag: 'A' }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 7, OBXSubID: 1, LIMSObservationCode: 'G' }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 8, OBXSubID: 2, LIMSObservationCode: '   ', LIMSObservationDesc: 'No code', LIMSRptResult: '<5', LIMSRptRange: ' -1.5 - 2 ' }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 9, OBXSubID: 1, LIMSObservationCode: 'H', LIMSRptResult: '7', LIMSCodedValue: 'SEVEN', SIValue: 7.25, CodedValue: 'c7', HL7ResultTypeCode: 'NU' }),
      res({ RequestID: 'VAL', OBRSetID: 1, OBXSetID: 10, OBXSubID: 1, LIMSObservationCode: 'I', LIMSRptResult: '> 1000000', LIMSRptRange: '10-20-30' }),
    ],
  },
  {
    name: 'ast',
    keys: ['AST1'],
    requests: [
      req({ RequestID: 'AST1', OBRSetID: 1, LIMSPanelCode: 'CULT', LIMSPanelDesc: 'Culture', SpecimenDateTime: '2024-07-01T08:00:00.000', HL7ResultStatusCode: 'F' }),
      req({ RequestID: 'AST1', OBRSetID: 2, LIMSPanelCode: 'CULT2', HL7ResultStatusCode: 'F' }),
    ],
    results: [res({ RequestID: 'AST1', OBRSetID: 1, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'GRAM', LIMSRptResult: 'Gram negative rods' })],
    ast: [
      ast({ RequestID: 'AST1', OBRSetID: 1, OBXSetID: 1, OBXSubID: 1, LIMSSubstanceCode: 'AMP', LIMSSubstanceName: 'Ampicillin', ORGANISM: 'Klebsiella pneumoniae', LIMSOrganismCode: 'KPN', BreakpointType: 'CLSI', Methodology: 'Disk', Units: 'mm', ASTValue: '12', ASTResult: 'R' }),
      ast({ RequestID: 'AST1', OBRSetID: 1, OBXSetID: 1, OBXSubID: 2, LIMSSubstanceCode: 'CIP', LIMSSubstanceName: 'Ciprofloxacin', ORGANISM: 'Klebsiella pneumoniae', LIMSOrganismCode: 'KPN', Units: 'ug/mL', ASTValue: '0.25', ASTResult: 's' }),
      ast({ RequestID: 'AST1', OBRSetID: 1, OBXSetID: 2, OBXSubID: 1, LIMSSubstanceCode: null, LIMSSubstanceName: 'Gentamicin', ORGANISM: 'Escherichia coli', LIMSOrganismCode: null, Units: ' MM ', ASTValue: '<=1', ASTResult: 'I' }),
      ast({ RequestID: 'AST1', OBRSetID: 1, OBXSetID: 2, OBXSubID: 2, LIMSSubstanceCode: '  ', LIMSSubstanceName: null, ORGANISM: 'Escherichia coli', ASTValue: null, ASTResult: 'N/A' }),
      // No organism name: its own isolate, coded "unknown".
      ast({ RequestID: 'AST1', OBRSetID: 2, OBXSetID: 1, OBXSubID: 1, LIMSSubstanceCode: 'MEM', LIMSSubstanceName: 'Meropenem', ORGANISM: '  ', ASTValue: '-2', ASTResult: 'S', BreakpointType: ' EUCAST ' }),
      ast({ RequestID: 'AST1', OBRSetID: 2, OBXSetID: 1, OBXSubID: 2, LIMSSubstanceCode: 'VAN', LIMSSubstanceName: 'Vancomycin', ORGANISM: 'Staphylococcus aureus', LIMSOrganismCode: 'SAU', ASTValue: '1.', ASTResult: 'S' }),
      // Orphans: an unknown OBR and a null OBR.
      ast({ RequestID: 'AST1', OBRSetID: 7, OBXSetID: 1, OBXSubID: 1, LIMSSubstanceCode: 'XXX', ORGANISM: 'Lost' }),
      ast({ RequestID: 'AST1', OBRSetID: null, OBXSetID: 1, OBXSubID: 1, LIMSSubstanceCode: 'YYY', ORGANISM: 'Lost2' }),
    ],
  },
  {
    name: 'attributes',
    keys: ['ATTR-ALL', 'ATTR-ZEROS', 'ATTR-BLANKS'],
    requests: [
      req({
        RequestID: 'ATTR-ALL', OBRSetID: 1, LIMSPreReg_RegistrationDateTime: '2024-02-01T10:00:00.500',
        LIMSPreReg_ReceivedDateTime: '2024-02-01T11:30:00.000', LIMSPreReg_RegistrationFacilityCode: 'PRE01',
        LOINCPanelCode: '20447-9', AdmitAttendDateTime: '2024-01-31T00:00:00.000', CollectionVolume: 2.5,
        ICD10ClinicalInfoCodes: 'B20;Z21', HL7SpecimenSourceCode: 'BLD', HL7SpecimenSiteCode: 'ARM',
        LIMSSpecimenSiteCode: 'LA', LIMSSpecimenSiteDesc: 'Left arm', WorkUnits: 3, CostUnits: 12.75,
        OrderingNotes: 'Handle with care', EncryptedPatientID: 'ENC-TEST-0001', HL7EthnicGroupCode: 'UNK',
        Deceased: true, Newborn: false, HL7PatientClassCode: 'I', ReferringRequestID: 'REF-0001', Therapy: 'ABC',
        TargetTimeDays: 2, TargetTimeMins: 90, Repeated: 1,
      }),
      req({ RequestID: 'ATTR-ZEROS', OBRSetID: 1, CollectionVolume: 0, WorkUnits: 0, CostUnits: 0, Deceased: 0, Newborn: 1, TargetTimeDays: 0, TargetTimeMins: 0, Repeated: 0, AgeInYears: 0, AgeInDays: 0 }),
      req({ RequestID: 'ATTR-BLANKS', OBRSetID: 1, LOINCPanelCode: '   ', OrderingNotes: '', Therapy: ' x ', Deceased: null, Newborn: null, RegisteredBy: '  ', RequestTypeCode: ' ', LIMSAnalyzerCode: '', LIMSPointOfCareDesc: ' ', ClinicalInfo: '  ', AttendingDoctor: ' ', TestedBy: '', AuthorisedBy: '  ', HL7SectionCode: ' ' }),
    ],
  },
  {
    name: 'ids-and-facilities',
    keys: ['MZ/2024_000 12', 'ONLYDOCTOR', 'ONLYCLINIC', `LONG-${'A'.repeat(70)}`],
    requests: [
      req({ RequestID: 'MZ/2024_000 12', OBRSetID: 1, LIMSPanelCode: 'HIVVL', RequestingFacilityCode: ' fac 03/x ', TestingFacilityCode: 'fac 03/x', AttendingDoctor: 'Dr A', LIMSSpecimenSourceCode: 'DBS' }),
      req({ RequestID: 'ONLYDOCTOR', OBRSetID: 1, AttendingDoctor: 'Dr B' }),
      req({ RequestID: 'ONLYCLINIC', OBRSetID: 1, RequestingFacilityCode: 'FAC09' }),
      req({ RequestID: `LONG-${'A'.repeat(70)}`, OBRSetID: 12, TestingFacilityCode: '___' }),
    ],
    results: [
      res({ RequestID: 'MZ/2024_000 12', OBRSetID: 1, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'X', LIMSRptResult: 'ok' }),
      res({ RequestID: `LONG-${'A'.repeat(70)}`, OBRSetID: 12, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'X', LIMSRptResult: 'ok' }),
    ],
  },
  {
    name: 'errors',
    keys: ['GOOD', 'NO-ROWS', 'NO-OBR', 'NO-OBX', '___'],
    requests: [
      req({ RequestID: 'GOOD', OBRSetID: 1, LIMSPanelCode: 'CD4' }),
      req({ RequestID: 'NO-OBR', OBRSetID: null }),
      req({ RequestID: 'NO-OBX', OBRSetID: 1 }),
      req({ RequestID: '___', OBRSetID: 1 }),
    ],
    results: [
      res({ RequestID: 'NO-OBX', OBRSetID: 1, OBXSetID: null, OBXSubID: 1, LIMSObservationCode: 'X' }),
      // A result for a key with no Requests row changes nothing: the request still fails.
      res({ RequestID: 'NO-ROWS', OBRSetID: 1, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'X' }),
    ],
  },
  {
    name: 'timezone-utc',
    tz: 'Z',
    keys: ['TZ1'],
    requests: [req({ RequestID: 'TZ1', OBRSetID: 1, SpecimenDateTime: '2024-12-31T23:59:59.999', ReceivedDateTime: '2025-01-01T00:00:00.000', RegisteredDateTime: '2025-01-01T00:00:01.000', AuthorisedDateTime: '2025-01-02T12:00:00.000', AnalysisDateTime: '2025-01-02T09:00:00.000' })],
    results: [res({ RequestID: 'TZ1', OBRSetID: 1, OBXSetID: 1, OBXSubID: 1, LIMSObservationCode: 'X', LIMSRptResult: '1' })],
    patients: [pat({ RequestID: 'TZ1', DOB: '2000-02-29T00:00:00.000' })],
  },
  {
    name: 'timezone-negative',
    tz: '-05:00',
    keys: ['TZ2'],
    requests: [req({ RequestID: 'TZ2', OBRSetID: 1, SpecimenDateTime: '2024-01-01T00:00:00.000', LIMSPreReg_RegistrationDateTime: '2023-12-31T18:00:00.000' })],
  },
];

function errorCode(message: string): string {
  if (/has no Requests rows/.test(message)) return 'NO_REQUEST_ROWS';
  if (/Requests row with no OBRSetID/.test(message)) return 'NO_OBR_SET_ID';
  if (/no OBXSetID or OBXSubID/.test(message)) return 'NO_OBX_ID';
  if (/sanitises to an empty FHIR id/.test(message)) return 'BAD_REQUEST_ID';
  if (/duplicate isolate_index/.test(message)) return 'DUPLICATE_ISOLATE';
  throw new Error(`generate-fixtures: no error code for "${message}"`);
}

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith('.json')) rmSync(join(outDir, f));

let groupsTotal = 0;
for (const c of cases) {
  const tz = c.tz ?? '+02:00';
  const rows = { requests: c.requests ?? [], results: c.results ?? [], patients: c.patients ?? [], ast: c.ast ?? [] };
  const grouped: Array<{ requestId: string }> = groupRows(
    c.keys, rows.requests.map(asDriverRow), rows.results.map(asDriverRow), rows.patients.map(asDriverRow), rows.ast.map(asDriverRow),
  );
  const byId = new Map(grouped.map((g) => [g.requestId, g]));
  const groups = c.keys.map((key) => {
    const request = byId.get(key);
    // groupRows leaves out a key with no Requests row; v1-push reports that as its own failure.
    if (!request) return { key, resources: [], error: 'NO_REQUEST_ROWS' };
    try {
      return { key, resources: toFhir(toPayload(request, rules).payload, { tzOffset: tz }) };
    } catch (err) {
      return { key, resources: [], error: errorCode(err instanceof Error ? err.message : String(err)) };
    }
  });
  groupsTotal += groups.length;
  const fixture = { name: c.name, input: { keys: c.keys, rows, options: { tz } }, expected: { groups } };
  writeFileSync(join(outDir, `${c.name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
}
writeFileSync(join(outDir, 'attribute-rules.json'), `${JSON.stringify({ name: 'attribute-rules', rules }, null, 2)}\n`);
process.stdout.write(`wrote ${cases.length} cases (${groupsTotal} requests) and attribute-rules.json to ${outDir}\n`);
