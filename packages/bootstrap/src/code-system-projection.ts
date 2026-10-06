import { deriveSystemCode, resolveSeedPublisherId, type TerminologyAdminStore } from '@openldr/db';
import type { SystemMeta } from '@openldr/terminology';

type UpsertInput = Parameters<TerminologyAdminStore['codingSystems']['upsertByUrl']>[0];

/** The `coding_systems` row an imported CodeSystem projects to. The name and description come from
 *  the resource when it has them, else the name is derived from the url. An import that says where
 *  it came from also sets the origin, and only CE's own seed stays protected from deletion. A caller
 *  that passes no origin (an older path) keeps the old behaviour. */
export function codeSystemProjection(url: string, version: string | null, meta?: SystemMeta): UpsertInput {
  return {
    url,
    systemCode: deriveSystemCode(url),
    systemName: meta?.name ?? deriveSystemCode(url),
    systemVersion: version,
    publisherId: resolveSeedPublisherId(url),
    ...(meta?.description ? { description: meta.description } : {}),
    ...(meta?.origin ? { origin: meta.origin, originRef: meta.originRef ?? null, seeded: meta.origin === 'core' } : {}),
  };
}
