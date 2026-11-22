import type { Kysely } from 'kysely';
import { indexRequisitions, type InternalSchema, type ProjectionDeps } from '@openldr/db';

type Hooks = Required<Pick<ProjectionDeps, 'onProjected' | 'onProjectedMany'>>;

interface Deps {
  internalDb: Kysely<InternalSchema>;
  logger: { error(o: unknown, m?: string): void };
}

/** The projection hooks with the requisition lookup added (lab slice 1b and 2, ruling 7). Every
 *  projected ServiceRequest, from any source, updates its `lab_requisitions` row, then the inner
 *  hooks run as before. An index failure is caught and logged here, so it never stops the inner
 *  hooks, and the projection already landed by then. A delete fires no hook, so a deleted request
 *  keeps its row until `openldr lab requisitions rebuild`; `findByRequisition` never returns it. */
export function withRequisitionIndex(deps: Deps, inner: Hooks): Hooks {
  const index = async (srs: Record<string, unknown>[]): Promise<void> => {
    if (srs.length === 0) return;
    try {
      await indexRequisitions(deps.internalDb, srs);
    } catch (err) {
      deps.logger.error({ err, records: srs.length }, 'requisition index failed; ignoring (clinical projection already applied)');
    }
  };
  return {
    onProjected: async (resourceType, resource, provenance) => {
      if (resourceType === 'ServiceRequest') await index([resource]);
      await inner.onProjected(resourceType, resource, provenance);
    },
    onProjectedMany: async (items) => {
      await index(items.filter((it) => it.resourceType === 'ServiceRequest').map((it) => it.resource));
      await inner.onProjectedMany(items);
    },
  };
}
