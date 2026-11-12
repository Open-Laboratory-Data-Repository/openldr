import { type Kysely, sql } from 'kysely';

// Tables for AUTH_ADAPTER=local, where an install signs people in with no Keycloak.
//
// local_credentials: one password per users row. A user with no row has no password and cannot
// sign in. failed_count and locked_until drive the lock after repeated wrong passwords.
// auth_sessions: one row per signed-in browser. Only a hash of the session secret is kept.
// auth_signing_keys: the key that signs access tokens. The private half is sealed, never plain.
// auth_setup_code: at most one row (id = 1), the one-time code for creating the first admin.
//
// first_name and last_name go on users, not on local_credentials. An admin can create an account
// with no password, which has no credential row, and its names must still be kept.
//
// Every foreign key to users cascades, so deleting a user leaves no password or session behind.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('users').addColumn('first_name', 'text').execute();
  await db.schema.alterTable('users').addColumn('last_name', 'text').execute();

  await db.schema.createTable('local_credentials').ifNotExists()
    .addColumn('user_id', 'text', (c) => c.primaryKey().references('users.id').onDelete('cascade'))
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('must_change', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('failed_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('locked_until', 'timestamptz')
    .addColumn('password_changed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createTable('auth_sessions').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('secret_hash', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('ip', 'text')
    .addColumn('user_agent', 'text')
    .execute();
  await db.schema.createIndex('auth_sessions_user_id_idx').ifNotExists()
    .on('auth_sessions').column('user_id').execute();

  await db.schema.createTable('auth_signing_keys').ifNotExists()
    .addColumn('kid', 'text', (c) => c.primaryKey())
    .addColumn('sealed_private_jwk', 'text', (c) => c.notNull())
    .addColumn('public_jwk', 'jsonb', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createTable('auth_setup_code').ifNotExists()
    .addColumn('id', 'integer', (c) => c.primaryKey())
    .addColumn('code_hash', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addCheckConstraint('auth_setup_code_singleton', sql`id = 1`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('auth_setup_code').ifExists().execute();
  await db.schema.dropTable('auth_signing_keys').ifExists().execute();
  await db.schema.dropIndex('auth_sessions_user_id_idx').ifExists().execute();
  await db.schema.dropTable('auth_sessions').ifExists().execute();
  await db.schema.dropTable('local_credentials').ifExists().execute();
  await db.schema.alterTable('users').dropColumn('last_name').execute();
  await db.schema.alterTable('users').dropColumn('first_name').execute();
}
