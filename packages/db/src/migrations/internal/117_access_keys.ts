import { type Kysely, sql } from 'kysely';

// Access keys: a program signs in as one account with no person present.
//
// Only a hash of the key is kept, never the key. `prefix` is the short visible start of the key,
// so a person can tell two keys apart in a list. `key_hash` is unique, so one key value can only
// ever name one row.
//
// `user_id` cascades, so deleting a user leaves none of its keys behind. `created_by` is the user
// who made the key. It has no foreign key, so the record of who made a key survives that user
// being deleted.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('access_keys').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('key_hash', 'text', (c) => c.notNull())
    .addColumn('prefix', 'text', (c) => c.notNull())
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('last_used_at', 'timestamptz')
    .execute();
  await db.schema.createIndex('access_keys_key_hash_uq').ifNotExists().unique()
    .on('access_keys').column('key_hash').execute();
  await db.schema.createIndex('access_keys_user_id_idx').ifNotExists()
    .on('access_keys').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('access_keys_user_id_idx').ifExists().execute();
  await db.schema.dropIndex('access_keys_key_hash_uq').ifExists().execute();
  await db.schema.dropTable('access_keys').ifExists().execute();
}
