import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { TerminologyCodesTable } from '../schema/external';
import { provColumns, str } from './extract';

/** A ValueSet fans out to one `terminology_codes` row per expanded concept — the resource that
 *  produces MANY warehouse rows, not one. `id` is `<value_set_id>|<system>|<code>`, matching
 *  `011_terminology_codes.ts`'s composite-key rationale (unique per concept within the set, and
 *  what the batch upserts conflict on). Empty/missing `expansion.contains` projects to zero rows —
 *  the writer's scope-replace still clears any rows the value set previously owned. */
export function projectValueSet(r: Record<string, unknown>, prov: Provenance): Insertable<TerminologyCodesTable>[] {
  const valueSetId = String(r['id']);
  const valueSetUrl = str(r['url']);
  const expansion = r['expansion'] as Record<string, unknown> | undefined;
  const contains = (expansion?.['contains'] as Record<string, unknown>[] | undefined) ?? [];
  return contains.map((c) => {
    const system = str(c['system']);
    const code = str(c['code']);
    return {
      id: `${valueSetId}|${system ?? ''}|${code ?? ''}`,
      value_set_id: valueSetId,
      value_set_url: valueSetUrl,
      system,
      code,
      display: str(c['display']),
      ...provColumns(prov),
    };
  });
}
