import { createHash } from 'node:crypto';
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { TerminologyCodesTable } from '../schema/external';
import { provColumns, str } from './extract';

// `id`'s column is `keyType(engine)` — `varchar(255)` on MySQL, `varchar(450)` on MSSQL, `text` on
// Postgres (011_terminology_codes.ts). Unlike every other flat table's `id`, this one is NOT a FHIR
// id: it is synthesised from `<value_set_id>|<system>|<code>`, and a long system URI plus a long
// code can breach 255 on MySQL. MySQL in non-strict mode silently TRUNCATES an over-length varchar
// instead of erroring, which would collapse two distinct concepts onto the same truncated id —
// silent data loss Postgres would never surface. Keep the readable id when it fits comfortably
// under the smallest bound (200, leaving headroom below 255); otherwise fall back to a deterministic
// SHA-1 hash of the same string, prefixed with `#` so a hashed id is visually recognisable, and kept
// under the value_set_id when that prefix itself still fits. Determinism is required either way —
// `reprojectAll` recomputes this id on every rebuild, and a non-deterministic id would duplicate the
// row instead of updating it in place.
const ID_MAX_LEN = 200;
function compositeId(valueSetId: string, system: string, code: string): string {
  const raw = `${valueSetId}|${system}|${code}`;
  if (raw.length <= ID_MAX_LEN) return raw;
  const hash = createHash('sha1').update(raw).digest('hex');
  const withValueSet = `${valueSetId}|#${hash}`;
  return withValueSet.length <= ID_MAX_LEN ? withValueSet : `#${hash}`;
}

/** A ValueSet fans out to one `terminology_codes` row per expanded concept — the resource that
 *  produces MANY warehouse rows, not one. Empty/missing `expansion.contains` projects to zero rows —
 *  the writer's scope-replace still clears any rows the value set previously owned.
 *
 *  Deduped by composite id (Map, first occurrence wins — matching `expandCompose`'s own
 *  `dedup()` in value-set-expander.ts). Admin-authored value sets are already deduped by the
 *  expander before they reach here, but ValueSet is also a registered ingestable FHIR type, and an
 *  INGESTED ValueSet is free to carry two identical `(system, code)` entries in `expansion.contains`.
 *  Without this, `insertBatchPg` would receive two rows sharing one `id` in a single statement, and
 *  real Postgres raises "ON CONFLICT DO UPDATE command cannot affect row a second time" (pg-mem
 *  silently collapses them, so no test using the in-memory fake could ever catch this). */
export function projectValueSet(r: Record<string, unknown>, prov: Provenance): Insertable<TerminologyCodesTable>[] {
  const valueSetId = String(r['id']);
  const valueSetUrl = str(r['url']);
  const expansion = r['expansion'] as Record<string, unknown> | undefined;
  const contains = (expansion?.['contains'] as Record<string, unknown>[] | undefined) ?? [];
  const rows = new Map<string, Insertable<TerminologyCodesTable>>();
  for (const c of contains) {
    const system = str(c['system']);
    const code = str(c['code']);
    const id = compositeId(valueSetId, system ?? '', code ?? '');
    if (rows.has(id)) continue;
    rows.set(id, {
      id,
      value_set_id: valueSetId,
      value_set_url: valueSetUrl,
      system,
      code,
      display: str(c['display']),
      ...provColumns(prov),
    });
  }
  return [...rows.values()];
}
