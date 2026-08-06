import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { FacilitiesTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, str } from './extract';

/**
 * `address[0].state`/`address[0].district` — the CDR toolchain now sends an `Organization` per
 * testing facility alongside the report, carrying these two fields (see migration 014's doc
 * comment for why `state`->`region`, and why there is no `council`/`city`/`line`/`postalCode`).
 * Tolerates an absent `address`, an empty array, and either part missing — a sender that emits no
 * address at all (the common case today) must still project exactly as it always has, just with
 * these two columns null rather than throwing.
 */
function address(r: Record<string, unknown>): { region: string | null; district: string | null } {
  const first = (r['address'] as Record<string, unknown>[] | undefined)?.[0];
  return { region: str(first?.['state']), district: str(first?.['district']) };
}

// Both Organization and Location project here, keyed by their own FHIR id; source_resource discriminates.
export function projectFacility(r: Record<string, unknown>, prov: Provenance): Insertable<FacilitiesTable> {
  const idn = firstIdentifier(r);
  const type = codeable((r['type'] as unknown[] | undefined)?.[0]);
  const { region, district } = address(r);
  return {
    id: String(r['id']),
    facility_code: idn.value,
    facility_name: str(r['name']),
    facility_type: type.text,
    source_resource: str(r['resourceType']),
    region,
    district,
    ...provColumns(prov),
  };
}
