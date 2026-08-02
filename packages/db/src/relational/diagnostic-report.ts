import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { DiagnosticReportsTable } from '../schema/external';
import { provColumns, codeable, referenceId, str } from './extract';

export function projectDiagnosticReport(r: Record<string, unknown>, prov: Provenance): Insertable<DiagnosticReportsTable> {
  const code = codeable(r['code']);
  const performer = (r['performer'] as { display?: unknown; reference?: unknown }[] | undefined)?.[0];
  return {
    id: String(r['id']),
    patient_id: referenceId(r['subject']),
    status: str(r['status']),
    code_code: code.code,
    code_text: code.text,
    issued: str(r['issued']),
    effective: str(r['effectiveDateTime']),
    conclusion: str(r['conclusion']),
    // The facility. Prefer `display` because that is all the CDR/DISA source supplies — it emits
    // `performer: [{ display: 'Mnazi Mmoja' }]` with no Organization resource to reference. Fall
    // back to the reference id so a sender that DOES contribute Organizations still lands a value
    // rather than a null.
    performer: str(performer?.display) ?? referenceId(performer),
    specimen_id: referenceId((r['specimen'] as unknown[] | undefined)?.[0]),
    ...provColumns(prov),
  };
}
