import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';

const SHA = 'a'.repeat(64);

describe('108 marketplace install status', () => {
  it('lets a row exist without a form and defaults the status to installed', async () => {
    const db: any = await makeMigratedDb();
    await db.insertInto('marketplace_installs').values({
      artifact_id: 'pack-a', version: '1.0.0', kind: 'content-pack', target_form_id: null, payload_sha256: SHA,
    } as never).execute();
    const row = await db.selectFrom('marketplace_installs').selectAll().where('artifact_id', '=', 'pack-a').executeTakeFirst();
    expect(row.target_form_id).toBeNull();
    expect(row.status).toBe('installed');
    expect(row.failed_step).toBeNull();
    expect(row.error).toBeNull();
  });

  it('gives a row written with a form the installed status too', async () => {
    const db: any = await makeMigratedDb();
    await db.insertInto('marketplace_installs').values({
      artifact_id: 'form-a', version: '1.0.0', kind: 'form-template', target_form_id: 'form-1', payload_sha256: SHA,
    } as never).execute();
    const row = await db.selectFrom('marketplace_installs').select(['status']).where('artifact_id', '=', 'form-a').executeTakeFirst();
    expect(row.status).toBe('installed');
    void sql;
  });
});
