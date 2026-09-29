import type { LabRequestsTable, DiagnosticReportsTable } from '../schema/external';
import { str } from './extract';
import { requesterPractitionerDisplay } from './requester';

type Json = Record<string, unknown>;

/** Prefix for the v1 request-fact extensions the CDR toolchain writes onto a ServiceRequest. */
const REQUEST_EXT_PREFIX = 'urn:openldr:ext:';

/** HL7 v2 table 0074 ("Diagnostic Service Section ID"), used for the DiagnosticReport category
 *  that carries the v1 section code (HM, MB, ...). */
const V2_0074_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v2-0074';

/** The first top-level extension on `r` named `<REQUEST_EXT_PREFIX><name>`, or undefined. */
function extension(r: Json, name: string): Json | undefined {
  const extensions = (r['extension'] as Json[] | undefined) ?? [];
  return extensions.find((e) => e['url'] === `${REQUEST_EXT_PREFIX}${name}`);
}

/** A sub-extension's `value<Key>` inside `ext.extension`, keyed by the sub-extension's `url`. */
function subValue(ext: Json | undefined, url: string, key: string): unknown {
  const parts = (ext?.['extension'] as Json[] | undefined) ?? [];
  const part = parts.find((p) => p['url'] === url);
  return part?.[`value${key}`];
}

/** Matches a plain integer of up to 9 digits, after trimming. Anything else (blank,
 *  whitespace, non-numeric, or a value too large to fit an int4 column) is not a set id. */
const OBR_SET_ID_PATTERN = /^\d{1,9}$/;

function obrSetId(r: Json): number | null {
  const identifiers = (r['identifier'] as Json[] | undefined) ?? [];
  const idn = identifiers.find((i) => i['system'] === 'urn:openldr:obr-set-id');
  if (idn === undefined) return null;
  const value = idn['value'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return OBR_SET_ID_PATTERN.test(trimmed) ? Number(trimmed) : null;
}

export type RequestFacts = Pick<
  LabRequestsTable,
  | 'obr_set_id' | 'analysis_at' | 'point_of_care' | 'request_type' | 'registered_by' | 'tested_by'
  | 'requester_practitioner' | 'age_years' | 'age_days' | 'clinical_info' | 'analyzer_code'
  | 'rejection_code' | 'rejection_reason'
>;

export function requestFacts(r: Json): RequestFacts {
  const ageExt = extension(r, 'age-at-request');
  const rejectionExt = extension(r, 'rejection');
  const locationCode = (r['locationCode'] as Json[] | undefined)?.[0];
  const note = (r['note'] as Json[] | undefined)?.[0];
  const ageYears = subValue(ageExt, 'years', 'Integer');
  const ageDays = subValue(ageExt, 'days', 'Integer');
  const rejectionCode = subValue(rejectionExt, 'code', 'Code');
  const rejectionReason = subValue(rejectionExt, 'reason', 'String');
  return {
    obr_set_id: obrSetId(r),
    analysis_at: str(extension(r, 'analysis-time')?.['valueDateTime']),
    point_of_care: str(locationCode?.['text']),
    request_type: str(extension(r, 'request-type')?.['valueCode']),
    registered_by: str(extension(r, 'registered-by')?.['valueString']),
    tested_by: str(extension(r, 'tested-by')?.['valueString']),
    requester_practitioner: requesterPractitionerDisplay(r),
    age_years: typeof ageYears === 'number' && Number.isInteger(ageYears) ? ageYears : null,
    age_days: typeof ageDays === 'number' && Number.isInteger(ageDays) ? ageDays : null,
    clinical_info: str(note?.['text']),
    analyzer_code: str(extension(r, 'analyzer')?.['valueCode']),
    rejection_code: str(rejectionCode),
    rejection_reason: str(rejectionReason),
  };
}

export type ReportFacts = Pick<DiagnosticReportsTable, 'section_code' | 'authorised_by'>;

export function reportFacts(r: Json): ReportFacts {
  const categories = (r['category'] as Json[] | undefined) ?? [];
  let sectionCode: string | null = null;
  for (const category of categories) {
    const codings = (category['coding'] as Json[] | undefined) ?? [];
    const coding = codings.find((c) => c['system'] === V2_0074_SYSTEM);
    if (coding) {
      sectionCode = str(coding['code']);
      break;
    }
  }
  const interpreter = (r['resultsInterpreter'] as Json[] | undefined)?.[0];
  return {
    section_code: sectionCode,
    authorised_by: str(interpreter?.['display']),
  };
}
