import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { LabResultsTable } from '../schema/external';
import { provColumns, codeable, referenceId, str, num } from './extract';

// FHIR Quantity.comparator has four values. Anything else is dropped, so a stray code cannot reach the warehouse.
const COMPARATORS = new Set(['<', '<=', '>=', '>']);

/** Result statuses that are not yet authorised. Such a result stays out of `lab_results`, and a row
 *  it had before is deleted (lab module design 2026-11-22, ruling 5). External migration 028 removed
 *  the rows already there with these same two values. */
export const UNAUTHORISED_RESULT_STATUSES = ['preliminary', 'registered'] as const;

export function isUnauthorisedResult(r: Record<string, unknown>): boolean {
  return (UNAUTHORISED_RESULT_STATUSES as readonly unknown[]).includes(r['status']);
}

export function projectObservation(r: Record<string, unknown>, prov: Provenance): Insertable<LabResultsTable> {
  const code = codeable(r['code']);
  const valueCc = codeable(r['valueCodeableConcept']);
  const quantity = r['valueQuantity'] as Record<string, unknown> | undefined;
  const interpretation = codeable((r['interpretation'] as unknown[] | undefined)?.[0]);
  // A rejected test is a cancelled Observation whose dataAbsentReason says why (bench result entry).
  const absent = codeable(r['dataAbsentReason']);
  const comparator = str(quantity?.['comparator']);
  const numericValue = num(quantity?.['value']);
  const textValue = valueCc.text ?? str(r['valueString']);
  const resultType = numericValue != null ? 'NM' : valueCc.code ? 'CE' : textValue ? 'ST' : null;
  return {
    id: String(r['id']),
    request_id: referenceId((r['basedOn'] as unknown[] | undefined)?.[0]),
    patient_id: referenceId(r['subject']),
    specimen_id: referenceId(r['specimen']),
    status: str(r['status']),
    data_absent_code: absent.code,
    data_absent_reason: absent.text,
    observation_code: code.code,
    observation_system: code.system,
    observation_desc: code.text,
    result_type: resultType,
    numeric_value: numericValue,
    numeric_units: str(quantity?.['unit']),
    numeric_comparator: comparator !== null && COMPARATORS.has(comparator) ? comparator : null,
    coded_value: valueCc.code,
    text_value: textValue,
    abnormal_flag: interpretation.code,
    result_timestamp: str(r['effectiveDateTime']),
    ...provColumns(prov),
  };
}
