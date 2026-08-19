import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { DiagnosticReportsTable } from '../schema/external';
import { provColumns, codeable, referenceId, str } from './extract';

export function projectDiagnosticReport(r: Record<string, unknown>, prov: Provenance): Insertable<DiagnosticReportsTable> {
  const code = codeable(r['code']);
  const performer = (r['performer'] as
    | { display?: unknown; reference?: unknown; identifier?: { system?: unknown; value?: unknown } }[]
    | undefined)?.[0];
  const performerIdentifier = performer?.identifier as { system?: unknown; value?: unknown } | undefined;
  return {
    id: String(r['id']),
    patient_id: referenceId(r['subject']),
    status: str(r['status']),
    code_code: code.code,
    code_text: code.text,
    issued: str(r['issued']),
    effective: str(r['effectiveDateTime']),
    conclusion: str(r['conclusion']),
    based_on_id: referenceId((r['basedOn'] as unknown[] | undefined)?.[0]),
    // The facility MATCH KEY. `performer` is a FHIR logical reference for the CDR/DISA source —
    // `identifier.value` is the correct match key (`identifier` exists precisely for a target with
    // no resource to point at), and MUST be preferred over `display`: multiple distinct facilities
    // can share the same display (measured: five DISA facility codes all named "Aga Khan" —
    // mapping on display would collapse them, attributing one facility's results to another). Fall
    // back to `display` (a sender with no identifier), then the reference id (a sender that
    // contributes a real Organization resource instead), so every existing sender shape still
    // lands a value.
    performer: str(performerIdentifier?.value) ?? str(performer?.display) ?? referenceId(performer),
    // The human-readable name, carried alongside the match key so an operator sees "Aga Khan"
    // rather than the bare code "BAMAA". Never used for matching.
    performer_display: str(performer?.display),
    // `identifier.system` — the code's namespace, when the wire supplies one (omitted when the
    // source has no system id).
    performer_system: str(performerIdentifier?.system),
    specimen_id: referenceId((r['specimen'] as unknown[] | undefined)?.[0]),
    ...provColumns(prov),
  };
}
