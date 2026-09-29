import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { LabRequestsTable, LabRequestAttributesTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, referenceId, str } from './extract';
import { requesterFacility } from './requester';
import { boundedRowId } from './row-id';
import { requestFacts } from './request-facts';

/** The v1 request-attribute extension: one row per clinical/administrative attribute the CDR
 *  toolchain attaches to a ServiceRequest, beyond the fixed request-fact columns. */
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
    ...requestFacts(r),
    ...provColumns(prov),
  };
}

function requesterColumns(f: { code: string | null; system: string | null; display: string | null }) {
  return { requester_code: f.code, requester_system: f.system, requester_display: f.display };
}

/** One row per `urn:openldr:ext:request-attribute` extension carrying a code and exactly one
 *  value. A repeated code keeps its last value: the row id is derived from `(labRequestId,
 *  system, code)`, so two rows for the same code would collide on insert (Postgres and SQL Server
 *  reject the duplicate key; pg-mem does not). */
export function projectServiceRequestAttributes(
  r: Record<string, unknown>, prov: Provenance,
): Insertable<LabRequestAttributesTable>[] {
  const requestId = String(r['id']);
  const extensions = (r['extension'] as Record<string, unknown>[] | undefined) ?? [];
  const byId = new Map<string, Insertable<LabRequestAttributesTable>>();
  for (const ext of extensions) {
    if (ext['url'] !== REQUEST_ATTRIBUTE_EXT_URL) continue;
    const parts = (ext['extension'] as Record<string, unknown>[] | undefined) ?? [];
    const codePart = parts.find((p) => p['url'] === 'code');
    const valuePart = parts.find((p) => p['url'] === 'value');
    const coding = codePart?.['valueCoding'] as Record<string, unknown> | undefined;
    const code = coding?.['code'] as string | undefined;
    const system = coding?.['system'] as string | undefined;
    if (!code || !system || !valuePart) continue;
    const value = attributeValue(valuePart);
    if (value === null) continue;
    const id = boundedRowId([requestId, system, code], 'lra');
    byId.set(id, {
      id,
      lab_request_id: requestId,
      system,
      code,
      ...value,
      ...provColumns(prov),
    });
  }
  return [...byId.values()];
}

type AttributeValue = Pick<LabRequestAttributesTable, 'value_text' | 'value_number' | 'value_boolean' | 'value_datetime'>;

const NO_VALUE: AttributeValue = { value_text: null, value_number: null, value_boolean: null, value_datetime: null };

/** The one populated `value<Type>` on a request-attribute's value part, in its typed column.
 *  Null when the value part carries none of the recognised types. */
function attributeValue(valuePart: Record<string, unknown>): AttributeValue | null {
  const text = valuePart['valueString'] ?? valuePart['valueCode'];
  if (typeof text === 'string') return { ...NO_VALUE, value_text: text };
  const number = valuePart['valueDecimal'] ?? valuePart['valueInteger'];
  if (typeof number === 'number') return { ...NO_VALUE, value_number: number };
  if (typeof valuePart['valueBoolean'] === 'boolean') return { ...NO_VALUE, value_boolean: valuePart['valueBoolean'] as boolean };
  if (typeof valuePart['valueDateTime'] === 'string') return { ...NO_VALUE, value_datetime: valuePart['valueDateTime'] as string };
  return null;
}
