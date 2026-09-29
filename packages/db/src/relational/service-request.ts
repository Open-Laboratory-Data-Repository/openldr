import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { LabRequestsTable, LabRequestAttributesTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, referenceId, str } from './extract';
import { requesterFacility } from './requester';
import { boundedRowId } from './row-id';

const REQUEST_ATTRIBUTE_EXT_URL = 'urn:openldr:ext:request-attribute';

export function projectServiceRequest(r: Record<string, unknown>, prov: Provenance): Insertable<LabRequestsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    request_id: idn.value,
    patient_id: referenceId(r['subject']),
    panel_code: code.code,
    panel_system: code.system,
    panel_desc: code.text,
    status: str(r['status']),
    priority: str(r['priority']),
    authored_at: str(r['authoredOn']),
    ...requesterColumns(requesterFacility(r)),
    ...provColumns(prov),
  };
}

function requesterColumns(f: { code: string | null; system: string | null; display: string | null }) {
  return { requester_code: f.code, requester_system: f.system, requester_display: f.display };
}

/** Minimal for Task 3: handles only `valueString`. Task 4 completes the value-type coverage
 *  (number, dateTime, boolean) that `LabRequestAttributesTable` already has columns for. */
export function projectServiceRequestAttributes(
  r: Record<string, unknown>, prov: Provenance,
): Insertable<LabRequestAttributesTable>[] {
  const requestId = String(r['id']);
  const extensions = (r['extension'] as Record<string, unknown>[] | undefined) ?? [];
  const rows: Insertable<LabRequestAttributesTable>[] = [];
  for (const ext of extensions) {
    if (ext['url'] !== REQUEST_ATTRIBUTE_EXT_URL) continue;
    const parts = (ext['extension'] as Record<string, unknown>[] | undefined) ?? [];
    const codePart = parts.find((p) => p['url'] === 'code');
    const valuePart = parts.find((p) => p['url'] === 'value');
    const coding = codePart?.['valueCoding'] as Record<string, unknown> | undefined;
    const code = coding?.['code'] as string | undefined;
    const system = coding?.['system'] as string | undefined;
    const valueText = valuePart?.['valueString'] as string | undefined;
    if (!code || !system || valueText === undefined) continue;
    rows.push({
      id: boundedRowId([requestId, system, code], 'lra'),
      lab_request_id: requestId,
      system,
      code,
      value_text: valueText,
      value_number: null,
      value_datetime: null,
      value_boolean: null,
      ...provColumns(prov),
    });
  }
  return rows;
}
