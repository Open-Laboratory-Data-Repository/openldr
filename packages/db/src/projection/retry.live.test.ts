import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, OperationNodeTransformer, IdentifierNode, type KyselyPlugin } from 'kysely';
import { expect, it } from 'vitest';
import { up, down } from '../migrations/internal/093_projection_retries';
import { deferRetry, dueRetries, clearRetry } from './retry';
import type { InternalSchema } from '../schema/internal';

// An explicit opt-in URL. All tables are remapped into a disposable schema.
const url = process.env.PROJECTION_RETRY_TEST_URL;
it.skipIf(!url)('persists retries in PostgreSQL across reconnects with bounded, ordered selection', async () => {
  const schema = `projection_retry_${randomUUID().replaceAll('-', '')}`;
  class SchemaTransformer extends OperationNodeTransformer {
    protected override transformIdentifier(node: IdentifierNode): IdentifierNode {
      return node.name === 'fhir' ? IdentifierNode.create(schema) : node;
    }
  }
  const plugin: KyselyPlugin = {
    transformQuery: ({ node }) => new SchemaTransformer().transformNode(node),
    transformResult: async ({ result }) => result,
  };
  const connect = () => new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1 }) }), plugins: [plugin] });
  let db = connect();
  await db.schema.createSchema(schema).execute();
  try {
    await up(db as unknown as Kysely<unknown>);
    await deferRetry(db, { resourceType: 'Patient', id: 'persisted' });
    expect(await dueRetries(db)).toEqual([]);
    await db.destroy();
    db = connect();
    expect(await db.selectFrom('fhir.projection_retries').select('attempts').execute()).toEqual([{ attempts: 1 }]);
    await db.updateTable('fhir.projection_retries').set({ next_attempt_at: new Date(0) }).execute();
    expect(await dueRetries(db)).toEqual([{ resourceType: 'Patient', id: 'persisted' }]);
    await clearRetry(db, { resourceType: 'Patient', id: 'persisted' });
    await db.insertInto('fhir.projection_retries').values(Array.from({ length: 105 }, (_, i) => ({
      resource_type: 'Patient', resource_id: String(i).padStart(3, '0'), attempts: 1, next_attempt_at: new Date(0),
    }))).execute();
    const due = await dueRetries(db);
    expect(due).toHaveLength(100);
    expect(due[0].id).toBe('000');
    expect(due[99].id).toBe('099');
    await deferRetry(db, due[0]);
    expect((await dueRetries(db))[99].id).toBe('100');
    await down(db as unknown as Kysely<unknown>);
    await up(db as unknown as Kysely<unknown>);
    expect(await dueRetries(db)).toEqual([]);
  } finally {
    await db.schema.dropSchema(schema).cascade().execute();
    await db.destroy();
  }
});
