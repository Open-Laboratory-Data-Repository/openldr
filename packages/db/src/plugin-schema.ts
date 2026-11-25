import { createHash } from 'node:crypto';
import { type Kysely, type RawBuilder, sql } from 'kysely';
import {
  CE_MANAGED_COLUMNS, PLUGIN_IDENTIFIER, tableShapeSchema, tableShapesSchema,
  type ColumnShape, type ColumnType, type TableShape,
} from './plugin-table-shape';

/** CE builds a plugin's tables from the shapes in its signed manifest, inside the plugin's own
 *  schema `plugin_<id>`. A plugin never sends SQL. Every name is checked again here, every name is
 *  quoted by Kysely, and every default is a checked literal. Changes are additive only: new tables,
 *  new nullable columns and new indexes. Anything else is refused before any DDL runs. */

export type PluginShapeErrorReason =
  | 'invalid' | 'name' | 'default' | 'drop' | 'rename' | 'type' | 'nullable' | 'key' | 'facility';

export class PluginShapeError extends Error {
  constructor(readonly reason: PluginShapeErrorReason, message: string) {
    super(message);
    this.name = 'PluginShapeError';
  }
}

export interface ShapePlan {
  schema: string;
  /** True when the schema does not exist yet. */
  createSchema: boolean;
  /** New tables, by name. */
  createTables: TableShape[];
  /** New nullable columns on tables that already exist. */
  addColumns: { table: string; column: ColumnShape }[];
  /** New indexes on tables that already exist. */
  addIndexes: { table: string; name: string; columns: string[]; unique: boolean }[];
}

/** Passed only by pg-mem tests, which cannot run ALTER TABLE ... ROW LEVEL SECURITY or CREATE
 *  POLICY. The package root does not export it (see index.ts), so code outside packages/db cannot
 *  turn row-level security off. */
export const PG_MEM_WITHOUT_RLS: unique symbol = Symbol('pg-mem tests without row-level security');

export interface PluginSchemas {
  schemaName(pluginId: string): string;
  plan(pluginId: string, shapes: TableShape[]): Promise<ShapePlan>;
  /** `created` lists new tables. `added` lists new columns as `table.column` and new indexes as
   *  `table(index name)`. */
  apply(pluginId: string, shapes: TableShape[]): Promise<{ created: string[]; added: string[] }>;
  /** Drops the plugin's schema. Never drops a schema CE did not make for this plugin id: it returns
   *  `dropped: false` with the reason, and the caller goes on removing the plugin. */
  drop(pluginId: string): Promise<{ dropped: boolean; reason?: string }>;
}

/** The table inside each plugin schema that records the shapes CE applied, and for which plugin id.
 *  Its name starts with `_`, so no declared table (which must start with a letter) can take it. */
export const SHAPES_TABLE = '_openldr_shapes';
export const FACILITY_POLICY = 'openldr_facility_scope';
export const FACILITIES_SETTING = 'openldr.facilities';
/** The no-login role plugin data requests switch to under a login that bypasses row-level
 *  security (migration 145, design 2026-11-25-plugin-data-rls-role). */
export const PLUGIN_DATA_ROLE = 'openldr_plugin_data';

/** The SQL type for each declared type. Looked up here, never passed through from the manifest. */
const SQL_TYPES: Readonly<Record<ColumnType, string>> = Object.freeze({
  text: 'text', integer: 'integer', bigint: 'bigint', numeric: 'numeric', boolean: 'boolean',
  timestamptz: 'timestamptz', date: 'date', jsonb: 'jsonb', uuid: 'uuid',
});

/** Names CE makes itself: a leading `_`, so they never meet a declared table name in the schema's
 *  one namespace for tables and indexes, and a hash, so Postgres never cuts two to the same 63 bytes. */
const CE_NAME = /^_(ix|pk)_[0-9a-f]{16}$/;
const SCHEMA_NAME = /^plugin_[a-z0-9_]{1,56}$/;

const MAX_TEXT_DEFAULT = 1000;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function checkName(name: string, what: string): string {
  if (typeof name !== 'string' || !PLUGIN_IDENTIFIER.test(name)) {
    throw new PluginShapeError('name', `${what} '${String(name)}' must match ^[a-z][a-z0-9_]{0,62}$`);
  }
  return name;
}

function checkCeName(name: string): string {
  if (!CE_NAME.test(name)) throw new PluginShapeError('name', `internal name '${name}' is not one CE makes`);
  return name;
}

function hash16(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function indexName(table: string, columns: string[], unique: boolean): string {
  return checkCeName(`_ix_${hash16(`${table}|${columns.join(',')}|${unique ? 1 : 0}`)}`);
}

function primaryKeyName(table: string): string {
  return checkCeName(`_pk_${hash16(table)}`);
}

/** `plugin_` plus the id lowercased, every character outside [a-z0-9_] made `_`, cut to 63. */
export function pluginSchemaName(pluginId: string): string {
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    throw new PluginShapeError('name', 'a plugin id is needed for its schema name');
  }
  const name = `plugin_${pluginId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`.slice(0, 63);
  if (!SCHEMA_NAME.test(name)) throw new PluginShapeError('name', `plugin id '${pluginId}' gives no safe schema name`);
  return name;
}

function sqlType(type: ColumnType): string {
  if (!Object.prototype.hasOwnProperty.call(SQL_TYPES, type)) {
    throw new PluginShapeError('type', `column type '${String(type)}' is not one CE allows`);
  }
  return SQL_TYPES[type];
}

function badDefault(col: ColumnShape, why: string): PluginShapeError {
  return new PluginShapeError('default', `column ${col.name}: default ${JSON.stringify(col.default)} ${why}`);
}

/** A string default is sent as a quoted literal. Kysely doubles any single quote. A backslash or a
 *  NUL is refused as well, so the literal reads the same whatever standard_conforming_strings is. */
function checkStringDefault(col: ColumnShape, value: unknown): string {
  if (typeof value !== 'string') throw badDefault(col, `must be a string for ${col.type}`);
  if (value.length > MAX_TEXT_DEFAULT) throw badDefault(col, `is longer than ${MAX_TEXT_DEFAULT} characters`);
  if (value.includes('\\') || value.includes('\u0000')) throw badDefault(col, 'may not hold a backslash or a NUL');
  return value;
}

/** The checked DEFAULT for a column, or undefined for none. Never a function call: only a literal
 *  of the column's own type, with a cast to that type. */
export function columnDefault(col: ColumnShape): RawBuilder<unknown> | undefined {
  const v = col.default;
  if (v === undefined || v === null) return undefined;
  const cast = sql.raw(sqlType(col.type));
  switch (col.type) {
    case 'integer':
      if (typeof v !== 'number' || !Number.isInteger(v) || v < INT32_MIN || v > INT32_MAX) throw badDefault(col, 'must be a whole number in the integer range');
      return sql`(${sql.lit(v)})::${cast}`;
    case 'bigint':
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw badDefault(col, 'must be a whole number');
      return sql`(${sql.lit(v)})::${cast}`;
    case 'numeric':
      if (typeof v !== 'number' || !Number.isFinite(v)) throw badDefault(col, 'must be a finite number');
      return sql`(${sql.lit(v)})::${cast}`;
    case 'boolean':
      if (typeof v !== 'boolean') throw badDefault(col, 'must be true or false');
      return sql`${sql.lit(v)}::${cast}`;
    case 'text':
      return sql`${sql.lit(checkStringDefault(col, v))}::${cast}`;
    case 'uuid': {
      const s = checkStringDefault(col, v);
      if (!UUID.test(s)) throw badDefault(col, 'is not a uuid');
      return sql`${sql.lit(s.toLowerCase())}::${cast}`;
    }
    case 'date': {
      // A pattern, so words Postgres reads as dates ('today', 'infinity') are refused.
      const s = checkStringDefault(col, v);
      const m = DATE.exec(s);
      const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
      if (!m || !d || d.toISOString().slice(0, 10) !== s) throw badDefault(col, 'is not a date like 2026-01-31');
      return sql`${sql.lit(s)}::${cast}`;
    }
    case 'timestamptz': {
      // A pattern, so 'now' (read once at DDL time) and other words are refused.
      const s = checkStringDefault(col, v);
      if (!TIMESTAMP.test(s) || !Number.isFinite(Date.parse(s))) throw badDefault(col, 'is not a timestamp like 2026-01-31T08:00:00Z');
      return sql`${sql.lit(s)}::${cast}`;
    }
    case 'jsonb': {
      const s = checkStringDefault(col, v);
      let parsed: unknown;
      try { parsed = JSON.parse(s); } catch { throw badDefault(col, 'is not JSON'); }
      return sql`${sql.lit(checkStringDefault(col, JSON.stringify(parsed)))}::${cast}`;
    }
    default:
      throw new PluginShapeError('type', `column type '${String(col.type)}' is not one CE allows`);
  }
}

/** Parse the shapes again with the manifest schema, then check every name and default here too. */
function checkShapes(shapes: TableShape[]): TableShape[] {
  const parsed = tableShapesSchema.safeParse(shapes);
  if (!parsed.success) {
    throw new PluginShapeError('invalid', `table shapes are not valid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  for (const t of parsed.data) {
    checkName(t.name, 'table');
    for (const c of t.columns) {
      checkName(c.name, `table ${t.name}: column`);
      if ((CE_MANAGED_COLUMNS as readonly string[]).includes(c.name)) {
        throw new PluginShapeError('name', `table ${t.name}: column ${c.name} is added by CE`);
      }
      sqlType(c.type);
      columnDefault(c);
    }
    for (const k of t.primaryKey) checkName(k, `table ${t.name}: primary key column`);
    for (const idx of t.indexes ?? []) for (const k of idx.columns) checkName(k, `table ${t.name}: index column`);
    if (t.facilityColumn !== undefined) checkName(t.facilityColumn, `table ${t.name}: facility column`);
  }
  return parsed.data;
}

/** NOT NULL when declared so, when in the primary key, and always for the facility column, so no
 *  row escapes the facility rule. */
function notNull(t: TableShape, c: ColumnShape): boolean {
  return c.nullable === false || t.primaryKey.includes(c.name) || t.facilityColumn === c.name;
}

function indexesOf(t: TableShape): { name: string; columns: string[]; unique: boolean }[] {
  return (t.indexes ?? []).map((i) => ({ name: indexName(t.name, i.columns, i.unique === true), columns: i.columns, unique: i.unique === true }));
}

function sameDefault(a: ColumnShape['default'], b: ColumnShape['default']): boolean {
  return (a ?? null) === (b ?? null);
}

/** What changes from the applied shape `was` to the declared shape `now`, refusing anything that is not additive. */
function diffTable(was: TableShape, now: TableShape, plan: ShapePlan): void {
  const nowCols = new Map(now.columns.map((c) => [c.name, c]));
  const wasCols = new Map(was.columns.map((c) => [c.name, c]));
  const newCols = now.columns.filter((c) => !wasCols.has(c.name));
  if (was.primaryKey.join(',') !== now.primaryKey.join(',')) throw new PluginShapeError('key', `table ${now.name}: the primary key changes`);
  if ((was.facilityColumn ?? null) !== (now.facilityColumn ?? null)) throw new PluginShapeError('facility', `table ${now.name}: the facility column changes`);
  for (const old of was.columns) {
    const cur = nowCols.get(old.name);
    if (!cur) {
      const renamed = newCols.find((c) => c.type === old.type);
      if (renamed) throw new PluginShapeError('rename', `table ${now.name}: column ${old.name} looks renamed to ${renamed.name}; columns cannot be renamed`);
      throw new PluginShapeError('drop', `table ${now.name}: column ${old.name} is gone; columns cannot be dropped`);
    }
    if (cur.type !== old.type) throw new PluginShapeError('type', `table ${now.name}: column ${old.name} changes type from ${old.type} to ${cur.type}`);
    if (notNull(was, old) !== notNull(now, cur)) throw new PluginShapeError('nullable', `table ${now.name}: column ${old.name} changes whether it may be empty`);
    if (!sameDefault(old.default, cur.default)) throw new PluginShapeError('default', `table ${now.name}: column ${old.name} changes its default`);
  }
  for (const c of newCols) {
    if (notNull(now, c)) throw new PluginShapeError('nullable', `table ${now.name}: new column ${c.name} must be nullable`);
    plan.addColumns.push({ table: now.name, column: c });
  }
  const wasIdx = new Set(indexesOf(was).map((i) => i.name));
  const nowIdx = indexesOf(now);
  const nowNames = new Set(nowIdx.map((i) => i.name));
  for (const name of wasIdx) {
    if (!nowNames.has(name)) throw new PluginShapeError('drop', `table ${now.name}: an index is gone; indexes cannot be dropped`);
  }
  for (const i of nowIdx) if (!wasIdx.has(i.name)) plan.addIndexes.push({ table: now.name, ...i });
}

/** A shape read back from _openldr_shapes, parsed again, so a corrupt row is refused plainly. */
function storedShape(schema: string, table: string, raw: unknown): TableShape {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { value = undefined; }
  }
  const parsed = tableShapeSchema.safeParse(value);
  if (!parsed.success || parsed.data.name !== table) {
    throw new PluginShapeError('invalid', `schema ${schema}: the recorded shape of table ${table} is not valid`);
  }
  return parsed.data;
}

function isMissingRelation(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === '42P01' || err?.code === '3F000' || /does not exist|schema not found/i.test(String(err?.message ?? ''));
}

/** True when the plugin data role exists. False when it does not, or when the question fails
 *  (pg-mem has no pg_roles). */
export async function pluginDataRoleExists(db: Kysely<any>): Promise<boolean> {
  try {
    const r = await sql<{ n: number }>`select count(*)::int as n from pg_roles where rolname = ${PLUGIN_DATA_ROLE}`.execute(db);
    return r.rows[0].n === 1;
  } catch {
    return false;
  }
}

/** Grants the plugin data role every schema CE made for a plugin (each holds the shapes table) and
 *  all its tables. Idempotent. Run when CE switches to the role, so a schema made while the role was
 *  missing is covered too. */
export async function grantPluginDataRoleAll(db: Kysely<any>): Promise<void> {
  const r = await sql<{ nspname: string }>`
    select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname = ${SHAPES_TABLE} and c.relkind = 'r'`.execute(db);
  for (const { nspname } of r.rows) await grantRoleSchema(db, nspname);
}

/** The role's rights in one plugin schema: use it, read and write its tables, and only read the
 *  shapes table. Requests read the recorded shapes; only CE's own login writes them. */
async function grantRoleSchema(db: Kysely<any>, schema: string): Promise<void> {
  await sql`grant usage on schema ${sql.id(schema)} to ${sql.id(PLUGIN_DATA_ROLE)}`.execute(db);
  await sql`grant select, insert, update, delete on all tables in schema ${sql.id(schema)} to ${sql.id(PLUGIN_DATA_ROLE)}`.execute(db);
  await sql`revoke insert, update, delete, truncate on ${sql.id(schema, SHAPES_TABLE)} from ${sql.id(PLUGIN_DATA_ROLE)}`.execute(db);
}

export function createPluginSchemas(db: Kysely<any>, pgMem?: typeof PG_MEM_WITHOUT_RLS): PluginSchemas {
  const rls = pgMem !== PG_MEM_WITHOUT_RLS;

  /** The shapes applied before, and whether the schema exists. Refuses a schema CE did not make for
   *  this plugin id: one with no shapes table, or one that two plugin ids both map to. */
  async function applied(pluginId: string, schema: string): Promise<{ exists: boolean; shapes: Map<string, TableShape> }> {
    const ns = await sql<{ n: string }>`select nspname as n from pg_catalog.pg_namespace where nspname = ${schema}`.execute(db);
    let rows: { table_name: string; plugin_id: string; shape: unknown }[];
    try {
      rows = await db.withSchema(schema).selectFrom(SHAPES_TABLE).select(['table_name', 'plugin_id', 'shape']).execute();
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
      if (ns.rows.length > 0) throw new PluginShapeError('name', `schema ${schema} exists but CE did not make it for a plugin`);
      return { exists: false, shapes: new Map() };
    }
    const shapes = new Map<string, TableShape>();
    for (const r of rows) {
      if (r.plugin_id !== pluginId) {
        throw new PluginShapeError('name', `schema ${schema} belongs to plugin '${r.plugin_id}', and '${pluginId}' maps to the same name`);
      }
      shapes.set(r.table_name, storedShape(schema, r.table_name, r.shape));
    }
    return { exists: true, shapes };
  }

  async function plan(pluginId: string, shapes: TableShape[]): Promise<ShapePlan> {
    const schema = pluginSchemaName(pluginId);
    const declared = checkShapes(shapes);
    const before = await applied(pluginId, schema);
    const out: ShapePlan = { schema, createSchema: !before.exists, createTables: [], addColumns: [], addIndexes: [] };
    const names = new Set(declared.map((t) => t.name));
    for (const name of before.shapes.keys()) {
      if (!names.has(name)) throw new PluginShapeError('drop', `table ${name} is gone; tables cannot be dropped`);
    }
    for (const t of declared) {
      const was = before.shapes.get(t.name);
      if (was) diffTable(was, t, out);
      else out.createTables.push(t);
    }
    return out;
  }

  async function createTable(trx: Kysely<any>, schema: string, t: TableShape): Promise<void> {
    let b = trx.schema.withSchema(schema).createTable(checkName(t.name, 'table'));
    for (const c of t.columns) {
      const def = columnDefault(c);
      b = b.addColumn(checkName(c.name, 'column'), sql.raw(sqlType(c.type)), (col) => {
        let x = notNull(t, c) ? col.notNull() : col;
        if (def) x = x.defaultTo(def);
        return x;
      });
    }
    for (const m of CE_MANAGED_COLUMNS) {
      b = b.addColumn(m, sql.raw('timestamptz'), (col) => col.notNull().defaultTo(sql`now()`));
    }
    b = b.addPrimaryKeyConstraint(primaryKeyName(t.name), t.primaryKey.map((k) => checkName(k, 'primary key column')) as never);
    await b.execute();
    for (const i of indexesOf(t)) await createIndex(trx, schema, t.name, i);
    if (t.facilityColumn !== undefined && rls) {
      const table = sql.id(schema, t.name);
      const fc = sql.id(checkName(t.facilityColumn, 'facility column'));
      const setting = sql`current_setting(${sql.lit(FACILITIES_SETTING)}, true)`;
      const rule = sql`(${setting} = ${sql.lit('*')} OR ${fc}::text = ANY(string_to_array(${setting}, ${sql.lit(',')})))`;
      await sql`alter table ${table} enable row level security`.execute(trx);
      await sql`alter table ${table} force row level security`.execute(trx);
      await sql`create policy ${sql.id(FACILITY_POLICY)} on ${table} using ${rule} with check ${rule}`.execute(trx);
    }
  }

  /** Grants the plugin data role the schema and all its tables. */
  async function grantPluginDataRole(trx: Kysely<any>, schema: string): Promise<void> {
    await grantRoleSchema(trx, schema);
  }

  async function createIndex(trx: Kysely<any>, schema: string, table: string, i: { name: string; columns: string[]; unique: boolean }): Promise<void> {
    let b = trx.schema.withSchema(schema).createIndex(checkCeName(i.name)).on(checkName(table, 'table'))
      .columns(i.columns.map((k) => checkName(k, 'index column')));
    if (i.unique) b = b.unique();
    await b.execute();
  }

  async function record(trx: Kysely<any>, schema: string, pluginId: string, t: TableShape, isNew: boolean): Promise<void> {
    const row = { table_name: t.name, plugin_id: pluginId, shape: JSON.stringify(t), applied_at: new Date() };
    if (isNew) await trx.withSchema(schema).insertInto(SHAPES_TABLE).values(row).execute();
    else await trx.withSchema(schema).updateTable(SHAPES_TABLE).set({ shape: row.shape, applied_at: row.applied_at }).where('table_name', '=', t.name).execute();
  }

  return {
    schemaName: pluginSchemaName,
    plan,

    async apply(pluginId, shapes) {
      const p = await plan(pluginId, shapes);
      const created: string[] = [];
      const added: string[] = [];
      if (p.createSchema && p.createTables.length === 0) return { created, added };
      const changedTables = new Set([...p.addColumns.map((a) => a.table), ...p.addIndexes.map((a) => a.table)]);
      if (p.createTables.length === 0 && changedTables.size === 0) return { created, added };
      const declared = new Map(checkShapes(shapes).map((t) => [t.name, t]));
      // Asked before the transaction: a failed question (pg-mem has no pg_roles) is no role, and
      // must not abort the table change.
      const roleExists = rls && p.createTables.length > 0 && await pluginDataRoleExists(db);
      await db.transaction().execute(async (trx) => {
        if (p.createSchema) {
          // No IF NOT EXISTS: a schema that appeared since the plan is refused by Postgres, not taken over.
          await trx.schema.createSchema(p.schema).execute();
          await trx.schema.withSchema(p.schema).createTable(SHAPES_TABLE)
            .addColumn('table_name', 'text', (c) => c.primaryKey())
            .addColumn('plugin_id', 'text', (c) => c.notNull())
            .addColumn('shape', 'jsonb', (c) => c.notNull())
            .addColumn('applied_at', 'timestamptz', (c) => c.notNull())
            .execute();
        }
        for (const t of p.createTables) {
          await createTable(trx, p.schema, t);
          await record(trx, p.schema, pluginId, t, true);
          created.push(t.name);
        }
        // The plugin data role reads and writes the schema's tables, and only reads the shapes table.
        if (roleExists && p.createTables.length > 0) await grantPluginDataRole(trx, p.schema);
        for (const a of p.addColumns) {
          const def = columnDefault(a.column);
          await trx.schema.withSchema(p.schema).alterTable(checkName(a.table, 'table'))
            .addColumn(checkName(a.column.name, 'column'), sql.raw(sqlType(a.column.type)), (col) => (def ? col.defaultTo(def) : col))
            .execute();
          added.push(`${a.table}.${a.column.name}`);
        }
        for (const i of p.addIndexes) {
          await createIndex(trx, p.schema, i.table, i);
          added.push(`${i.table}(${i.name})`);
        }
        for (const name of changedTables) await record(trx, p.schema, pluginId, declared.get(name)!, false);
      });
      return { created, added };
    },

    async drop(pluginId) {
      const schema = pluginSchemaName(pluginId);
      let before: { exists: boolean };
      try {
        before = await applied(pluginId, schema);
      } catch (e) {
        // Another plugin id maps to the same schema name, or CE did not make the schema. Either way
        // it is not this plugin's to drop, and a plugin without tables must still be removable.
        if (e instanceof PluginShapeError && e.reason === 'name') return { dropped: false, reason: e.message };
        throw e;
      }
      if (!before.exists) return { dropped: false };
      // CASCADE would also drop any CE object that depends on a plugin table (a view, a foreign
      // key). None may exist: CE never builds on a plugin's tables.
      await sql`drop schema ${sql.id(schema)} cascade`.execute(db);
      return { dropped: true };
    },
  };
}

