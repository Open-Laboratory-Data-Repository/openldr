import type { Kysely } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { ProjectionTask } from './plan';

export async function dueRetries(db: Kysely<InternalSchema>): Promise<ProjectionTask[]> {
  const rows = await db.selectFrom('fhir.projection_retries').select(['resource_type', 'resource_id'])
    .where('next_attempt_at', '<=', new Date())
    .orderBy('next_attempt_at').orderBy('resource_type').orderBy('resource_id')
    .limit(100).execute();
  return rows.map(row => ({ resourceType: row.resource_type, id: row.resource_id }));
}

export async function clearRetry(db: Kysely<InternalSchema>, task: ProjectionTask): Promise<void> {
  await db.deleteFrom('fhir.projection_retries')
    .where('resource_type', '=', task.resourceType).where('resource_id', '=', task.id).execute();
}

export async function deferRetry(db: Kysely<InternalSchema>, task: ProjectionTask): Promise<void> {
  const previous = await db.selectFrom('fhir.projection_retries').select('attempts')
    .where('resource_type', '=', task.resourceType).where('resource_id', '=', task.id).executeTakeFirst();
  // Keep retrying indefinitely, but cap both the counter and the delay.
  const attempts = Math.min((previous?.attempts ?? 0) + 1, 32);
  const next_attempt_at = new Date(Date.now() + Math.min(1_000 * 2 ** (attempts - 1), 300_000));
  await db.insertInto('fhir.projection_retries')
    .values({ resource_type: task.resourceType, resource_id: task.id, attempts, next_attempt_at })
    .onConflict(oc => oc.columns(['resource_type', 'resource_id']).doUpdateSet({ attempts, next_attempt_at }))
    .execute();
}
