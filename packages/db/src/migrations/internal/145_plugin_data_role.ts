import { type Kysely, sql } from 'kysely';

// Row-level security on plugin data under a superuser login (design 2026-11-25-plugin-data-rls-role).
// Postgres skips every row-level policy for a superuser, and a Docker install logs in as one. This
// makes a no-login role that plugin data requests switch to, so the facility policy applies, and
// grants it every schema CE made for a plugin. When CE's login may not create roles, it changes
// nothing: the code filter still guards, and CE warns at start (pluginDataRoleStatus).

/** Kept here as a literal: a migration does not import app code. Same as PLUGIN_DATA_ROLE. */
const ROLE = 'openldr_plugin_data';

/** Who CE's login is, or null on pg-mem, which has no pg_roles. */
async function login(db: Kysely<any>): Promise<{ rolsuper: boolean; rolcreaterole: boolean } | null> {
  try {
    const r = await sql<{ rolsuper: boolean; rolcreaterole: boolean }>`
      select rolsuper, rolcreaterole from pg_roles where rolname = current_user`.execute(db);
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

/** The schemas CE made for plugins: each holds the shapes table. */
async function pluginSchemas(db: Kysely<any>): Promise<string[]> {
  const r = await sql<{ nspname: string }>`
    select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname = '_openldr_shapes' and c.relkind = 'r' order by n.nspname`.execute(db);
  return r.rows.map((x) => x.nspname);
}

async function roleExists(db: Kysely<any>): Promise<boolean> {
  const r = await sql<{ n: number }>`select count(*)::int as n from pg_roles where rolname = ${ROLE}`.execute(db);
  return r.rows[0].n === 1;
}

export async function up(db: Kysely<any>): Promise<void> {
  const me = await login(db);
  if (!me || (!me.rolsuper && !me.rolcreaterole)) return;
  if (!(await roleExists(db))) {
    await sql`create role ${sql.id(ROLE)} nologin nosuperuser nobypassrls`.execute(db);
  }
  // A CREATEROLE login must be a member to switch to the role; a superuser may switch to any role.
  if (!me.rolsuper) await sql`grant ${sql.id(ROLE)} to current_user`.execute(db);
  for (const schema of await pluginSchemas(db)) {
    await sql`grant usage on schema ${sql.id(schema)} to ${sql.id(ROLE)}`.execute(db);
    await sql`grant select, insert, update, delete on all tables in schema ${sql.id(schema)} to ${sql.id(ROLE)}`.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  const me = await login(db);
  if (!me || !(await roleExists(db))) return;
  for (const schema of await pluginSchemas(db)) {
    await sql`revoke all on all tables in schema ${sql.id(schema)} from ${sql.id(ROLE)}`.execute(db);
    await sql`revoke usage on schema ${sql.id(schema)} from ${sql.id(ROLE)}`.execute(db);
  }
  await sql`drop role ${sql.id(ROLE)}`.execute(db);
}
