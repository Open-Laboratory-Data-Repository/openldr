import { type Expression, type Kysely, type SqlBool, sql } from 'kysely';
import { z } from 'zod';
import { pluginSchemaName, SHAPES_TABLE, FACILITIES_SETTING, PLUGIN_DATA_ROLE, grantPluginDataRoleAll } from './plugin-schema';
import {
  CE_MANAGED_COLUMNS, PLUGIN_IDENTIFIER, tableShapeSchema, type ColumnType, type TableShape,
} from './plugin-table-shape';

/** The only way plugin code reads and writes its own tables. A plugin never sends SQL: it sends a
 *  structured request, and CE builds the statement with Kysely inside the plugin's schema.
 *
 *  Every table and column name is checked twice: first against the shapes the caller passes (before
 *  any SQL), then against the shapes CE recorded in `_openldr_shapes` when it made the tables. Every
 *  declared column must be recorded with the same type; the recorded table may hold more columns,
 *  which a newer version of the plugin added. The statement is built from the declared shapes, so a
 *  version never reads or writes a column it does not declare. Every value is checked against its
 *  column type and bound, never written into the SQL text.
 *
 *  On a facility table CE adds the caller's facility filter to every select, update and delete, and
 *  refuses an insert or update that sets a facility outside the caller's facilities. CE's login may
 *  be a superuser, and Postgres skips row-level security for superusers, so this filter is the real
 *  guard and must be complete on its own. The row-level security policy is the second guard. */

export type PluginCaller = {
  userId: string;
  displayName: string | null;
  capabilities: string[];
  facilities: string[] | '*';
  /** Who CE audits the call as, when it is not the signed-in page user: `openldr plugin call`
   *  passes the CLI's actor (actor type `cli`, or the user with `origin: { via: 'cli' }`). */
  auditActor?: { actorType: string; actorId?: string | null; actorName?: string | null; origin?: unknown };
};

/** `conflict`: a conditional step (`expect`) changed a different number of rows; nothing was saved. */
export type PluginRequestErrorReason = 'invalid' | 'table' | 'column' | 'value' | 'key' | 'facility' | 'shape' | 'conflict';

export class PluginRequestError extends Error {
  constructor(readonly reason: PluginRequestErrorReason, message: string) {
    super(message);
    this.name = 'PluginRequestError';
  }
}

export const MAX_SELECT_LIMIT = 1000;
export const DEFAULT_SELECT_LIMIT = 100;
export const MAX_SELECT_OFFSET = 1_000_000;
export const MAX_IN_VALUES = 1000;
export const MAX_FILTERS = 50;
export const MAX_ORDER = 10;
export const MAX_WRITE_STEPS = 500;
export const STATEMENT_TIMEOUT = '5s';
const MAX_TEXT_VALUE = 1_000_000;

const identifier = z.string().regex(PLUGIN_IDENTIFIER, 'must match ^[a-z][a-z0-9_]{0,62}$');
const scalar = z.union([z.string(), z.number(), z.boolean()]);

const filterSchema = z.discriminatedUnion('op', [
  z.object({ column: identifier, op: z.enum(['eq', 'lt', 'lte', 'gt', 'gte']), value: scalar }).strict(),
  z.object({ column: identifier, op: z.literal('in'), values: z.array(scalar).min(1).max(MAX_IN_VALUES) }).strict(),
  z.object({ column: identifier, op: z.literal('is_null'), value: z.boolean() }).strict(),
  z.object({ column: identifier, op: z.literal('prefix'), value: z.string() }).strict(),
]);
export type SelectFilter = z.infer<typeof filterSchema>;

export const selectRequestSchema = z.object({
  table: identifier,
  columns: z.array(identifier).min(1).max(200).optional(),
  where: z.array(filterSchema).max(MAX_FILTERS).optional(),
  orderBy: z.array(z.object({ column: identifier, direction: z.enum(['asc', 'desc']).optional() }).strict()).max(MAX_ORDER).optional(),
  limit: z.number().int().min(1).max(MAX_SELECT_LIMIT).optional(),
  offset: z.number().int().min(0).max(MAX_SELECT_OFFSET).optional(),
  count: z.boolean().optional(),
}).strict();
export type SelectRequest = z.infer<typeof selectRequestSchema>;

const rowValues = z.record(identifier, z.unknown());
const writeStepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert'), table: identifier, values: rowValues }).strict(),
  // `where` and `expect` make a step conditional (design 2026-11-25-plugin-conditional-write).
  z.object({
    op: z.literal('update'), table: identifier, key: rowValues, set: rowValues,
    where: z.array(filterSchema).max(MAX_FILTERS).optional(), expect: z.number().int().min(0).optional(),
  }).strict(),
  z.object({
    op: z.literal('delete'), table: identifier, key: rowValues,
    where: z.array(filterSchema).max(MAX_FILTERS).optional(), expect: z.number().int().min(0).optional(),
  }).strict(),
]);
export type WriteStep = z.infer<typeof writeStepSchema>;

export const writeRequestSchema = z.object({
  steps: z.array(writeStepSchema).min(1).max(MAX_WRITE_STEPS),
}).strict();
export type WriteRequest = z.infer<typeof writeRequestSchema>;

export interface PluginRequests {
  select(pluginId: string, shapes: TableShape[], caller: PluginCaller, req: SelectRequest): Promise<{ rows: Record<string, unknown>[]; count?: number }>;
  write(pluginId: string, shapes: TableShape[], caller: PluginCaller, req: WriteRequest): Promise<{ results: { rowCount: number }[] }>;
}

/** What CE knows about one table, from a checked shape. */
interface TableFacts {
  name: string;
  types: Map<string, ColumnType>;
  notNull: Set<string>;
  primaryKey: string[];
  facilityColumn: string | null;
  /** Columns that may not be empty and have no default, so an insert must set them. */
  required: Set<string>;
}

const MANAGED = new Set<string>(CE_MANAGED_COLUMNS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const DECIMAL = /^-?\d{1,131072}(\.\d{1,16383})?$/;
const BIGINT = /^-?\d{1,19}$/;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const RANGE_OPS = new Set(['lt', 'lte', 'gt', 'gte']);
const OPS = { eq: '=', lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;

function parse<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new PluginRequestError('invalid', `${what} is not valid: ${r.error.issues.map((i) => `${i.path.join('.') || '(request)'}: ${i.message}`).join('; ')}`);
  }
  return r.data;
}

function factsOf(t: TableShape): TableFacts {
  const types = new Map<string, ColumnType>();
  const notNull = new Set<string>();
  const required = new Set<string>();
  for (const c of t.columns) {
    types.set(c.name, c.type);
    if (c.nullable === false || t.primaryKey.includes(c.name) || t.facilityColumn === c.name) {
      notNull.add(c.name);
      if (c.default === undefined || c.default === null) required.add(c.name);
    }
  }
  return { name: t.name, types, notNull, required, primaryKey: [...t.primaryKey], facilityColumn: t.facilityColumn ?? null };
}

/** The tables a request may name, from shapes parsed again with the manifest schema. Only declared
 *  names are in the map, and a declared name starts with a letter, so `_openldr_shapes` is never one. */
function declaredTables(shapes: TableShape[], what: string): Map<string, TableFacts> {
  const out = new Map<string, TableFacts>();
  if (!Array.isArray(shapes)) throw new PluginRequestError('shape', `${what} are not a list`);
  for (const s of shapes) {
    const t = parse(tableShapeSchema, s, `${what}: a table shape`);
    out.set(t.name, factsOf(t));
  }
  return out;
}

function tableOf(tables: Map<string, TableFacts>, name: string): TableFacts {
  const t = tables.get(name);
  if (!t || !PLUGIN_IDENTIFIER.test(name)) throw new PluginRequestError('table', `table '${name}' is not one of the plugin's declared tables`);
  return t;
}

/** The type of a column a request may read: a declared column or one CE adds. */
function readable(t: TableFacts, column: string): ColumnType {
  const type = t.types.get(column);
  if (type) return type;
  if (MANAGED.has(column)) return 'timestamptz';
  throw new PluginRequestError('column', `table ${t.name}: column '${column}' is not declared`);
}

/** The type of a column a request may write: a declared column only. */
function writable(t: TableFacts, column: string): ColumnType {
  if (MANAGED.has(column)) throw new PluginRequestError('column', `table ${t.name}: column ${column} is set by CE`);
  const type = t.types.get(column);
  if (!type) throw new PluginRequestError('column', `table ${t.name}: column '${column}' is not declared`);
  return type;
}

function badValue(t: TableFacts, column: string, value: unknown, why: string): PluginRequestError {
  const shown = JSON.stringify(value);
  return new PluginRequestError('value', `table ${t.name}: column ${column}: value ${shown === undefined ? String(value) : shown.slice(0, 80)} ${why}`);
}

function checkText(t: TableFacts, column: string, v: unknown): string {
  if (typeof v !== 'string') throw badValue(t, column, v, 'must be a string');
  if (v.length > MAX_TEXT_VALUE) throw badValue(t, column, v, `is longer than ${MAX_TEXT_VALUE} characters`);
  if (v.includes('\u0000')) throw badValue(t, column, v, 'may not hold a NUL');
  return v;
}

/** A value checked against its column type, in the form it is bound. Never null here. */
function checkValue(t: TableFacts, column: string, type: ColumnType, v: unknown): unknown {
  switch (type) {
    case 'text':
      return checkText(t, column, v);
    case 'integer':
      if (typeof v !== 'number' || !Number.isInteger(v) || v < -2147483648 || v > 2147483647) throw badValue(t, column, v, 'must be a whole number in the integer range');
      return v;
    case 'bigint':
      if (typeof v === 'number') {
        if (!Number.isSafeInteger(v)) throw badValue(t, column, v, 'must be a whole number');
        return String(v);
      }
      if (typeof v !== 'string' || !BIGINT.test(v) || BigInt(v) < INT64_MIN || BigInt(v) > INT64_MAX) throw badValue(t, column, v, 'must be a whole number in the bigint range');
      return v;
    case 'numeric':
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) throw badValue(t, column, v, 'must be a finite number');
        return v;
      }
      if (typeof v !== 'string' || !DECIMAL.test(v)) throw badValue(t, column, v, 'must be a number');
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') throw badValue(t, column, v, 'must be true or false');
      return v;
    case 'uuid':
      if (typeof v !== 'string' || !UUID.test(v)) throw badValue(t, column, v, 'is not a uuid');
      return v.toLowerCase();
    case 'date': {
      const m = typeof v === 'string' ? DATE.exec(v) : null;
      const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
      if (!m || !d || d.toISOString().slice(0, 10) !== v) throw badValue(t, column, v, 'is not a date like 2026-01-31');
      return v;
    }
    case 'timestamptz':
      if (typeof v !== 'string' || !TIMESTAMP.test(v) || !Number.isFinite(Date.parse(v))) throw badValue(t, column, v, 'is not a timestamp like 2026-01-31T08:00:00Z');
      return v;
    case 'jsonb': {
      let text: string | undefined;
      try { text = JSON.stringify(v); } catch { text = undefined; }
      if (text === undefined) throw badValue(t, column, v, 'is not JSON');
      if (text.length > MAX_TEXT_VALUE) throw badValue(t, column, v, `is longer than ${MAX_TEXT_VALUE} characters as JSON`);
      return text;
    }
    default:
      throw new PluginRequestError('column', `table ${t.name}: column ${column} has a type CE does not know`);
  }
}

/** A value to write: null only where the column may be empty. */
function checkWriteValue(t: TableFacts, column: string, type: ColumnType, v: unknown): unknown {
  if (v === null) {
    if (t.notNull.has(column)) throw badValue(t, column, v, 'may not be empty');
    return null;
  }
  if (v === undefined) throw badValue(t, column, v, 'is missing');
  return checkValue(t, column, type, v);
}

/** The caller's facilities as CE writes and compares them: lowercased, since the policy compares as
 *  text and a uuid reads back lowercase. An id with a comma or a `*` would read differently in the
 *  policy's comma list, so it is refused. */
function callerFacilities(caller: PluginCaller): string[] | '*' {
  if (caller?.facilities === '*') return '*';
  if (!Array.isArray(caller?.facilities)) throw new PluginRequestError('facility', 'the caller has no facility list');
  return caller.facilities.map((f) => {
    if (typeof f !== 'string' || f.length === 0 || f.includes(',') || f.includes('*') || f.includes('\u0000')) {
      throw new PluginRequestError('facility', `facility id ${JSON.stringify(f)} cannot be used`);
    }
    return f.toLowerCase();
  });
}

function settingFor(facilities: string[] | '*'): string {
  return facilities === '*' ? '*' : facilities.join(',');
}

/** A facility value the request writes: stored lowercased, and inside the caller's facilities. */
function checkFacilityValue(t: TableFacts, value: unknown, facilities: string[] | '*'): string {
  const type = t.types.get(t.facilityColumn!)!;
  if (value === null || value === undefined) throw badValue(t, t.facilityColumn!, value, 'may not be empty');
  const v = (checkValue(t, t.facilityColumn!, type, value) as string).toLowerCase();
  if (facilities !== '*' && !facilities.includes(v)) {
    throw new PluginRequestError('facility', `table ${t.name}: facility ${JSON.stringify(v)} is outside the caller's facilities`);
  }
  return v;
}

/** The filter CE adds on a facility table. The request's own filters are joined to it with AND, so
 *  no `eq` or `in` on the facility column can widen it. */
function facilityFilter(t: TableFacts, facilities: string[] | '*'): Expression<SqlBool> | null {
  if (!t.facilityColumn || facilities === '*') return null;
  if (facilities.length === 0) return sql<SqlBool>`false`;
  return sql<SqlBool>`${sql.ref(t.facilityColumn)}::text in (${sql.join(facilities)})`;
}

/** A key that names exactly the primary key columns. */
function checkKey(t: TableFacts, key: Record<string, unknown>): [string, unknown][] {
  const names = Object.keys(key);
  if (names.length !== t.primaryKey.length || !t.primaryKey.every((k) => Object.prototype.hasOwnProperty.call(key, k))) {
    throw new PluginRequestError('key', `table ${t.name}: a key must name exactly the primary key (${t.primaryKey.join(', ')})`);
  }
  return t.primaryKey.map((k) => {
    const v = key[k];
    if (v === null || v === undefined) throw badValue(t, k, v, 'may not be empty in a key');
    return [k, checkValue(t, k, t.types.get(k)!, v)];
  });
}

/** Why a declared table cannot use the stored one, or null when it can. Every declared column must
 *  be stored with the same type and the same rule on being empty, and the primary key and facility
 *  column must match. The stored table may have more columns: a newer version of the plugin added
 *  them, and an older version (after a rollback, or while an upgrade runs) never names them. */
function mismatch(declared: TableFacts, stored: TableFacts): string | null {
  if (declared.facilityColumn !== stored.facilityColumn) return 'the facility column differs';
  if (declared.primaryKey.join(',') !== stored.primaryKey.join(',')) return 'the primary key differs';
  for (const [k, v] of declared.types) {
    const was = stored.types.get(k);
    if (was === undefined) return `column ${k} is not in the stored table`;
    if (was !== v) return `column ${k} is ${v} here but ${was} in the stored table`;
    if (declared.notNull.has(k) !== stored.notNull.has(k)) return `column ${k} differs on whether it may be empty`;
  }
  return null;
}

/** Stored columns this version does not declare but an insert would have to set. */
function undeclaredRequired(declared: TableFacts, stored: TableFacts): string[] {
  return [...stored.required].filter((k) => !declared.types.has(k));
}

/** A select, checked and ready to build. */
interface PlannedSelect {
  table: TableFacts;
  columns: string[];
  filters: { column: string; type: ColumnType; f: SelectFilter; bound: unknown }[];
  order: { column: string; direction: 'asc' | 'desc' }[];
  limit: number;
  offset: number;
  count: boolean;
}

/** A filter checked against the table, with its bound value, ready to apply. */
type PlannedFilter = { column: string; type: ColumnType; f: SelectFilter; bound: unknown };

/** Checks filters against the declared columns. A select's `where` and a conditional step's use it. */
function planFilters(t: TableFacts, where: SelectFilter[]): PlannedFilter[] {
  return where.map((f) => {
    const type = readable(t, f.column);
    let bound: unknown;
    switch (f.op) {
      case 'is_null':
        bound = f.value;
        break;
      case 'prefix':
        if (type !== 'text') throw new PluginRequestError('value', `table ${t.name}: prefix needs a text column, and ${f.column} is ${type}`);
        // Escape LIKE's own characters, so the prefix matches only itself. Postgres reads `\` as the escape.
        bound = `${checkText(t, f.column, f.value).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
        break;
      case 'in':
        if (type === 'jsonb') throw new PluginRequestError('value', `table ${t.name}: in cannot be used on jsonb column ${f.column}`);
        bound = f.values.map((v) => checkValue(t, f.column, type, v));
        break;
      default:
        if (RANGE_OPS.has(f.op) && (type === 'jsonb' || type === 'boolean')) {
          throw new PluginRequestError('value', `table ${t.name}: ${f.op} cannot be used on ${type} column ${f.column}`);
        }
        bound = checkValue(t, f.column, type, f.value);
    }
    return { column: f.column, type, f, bound };
  });
}

/** Adds planned filters to a select, update or delete. */
function applyFilters(q: any, filters: PlannedFilter[]): any {
  let out = q;
  for (const { column, f, bound } of filters) {
    if (f.op === 'is_null') out = out.where(column, bound ? 'is' : 'is not', null);
    else if (f.op === 'prefix') out = out.where(column, 'like', bound);
    else if (f.op === 'in') out = out.where(column, 'in', bound);
    else out = out.where(column, OPS[f.op], bound);
  }
  return out;
}

function planSelect(tables: Map<string, TableFacts>, req: SelectRequest): PlannedSelect {
  const t = tableOf(tables, req.table);
  const all = [...t.types.keys(), ...CE_MANAGED_COLUMNS];
  const columns = req.columns ?? all;
  for (const c of columns) readable(t, c);
  const filters = planFilters(t, req.where ?? []);
  const order = (req.orderBy ?? []).map((o) => {
    const type = readable(t, o.column);
    if (type === 'jsonb') throw new PluginRequestError('column', `table ${t.name}: cannot order by jsonb column ${o.column}`);
    return { column: o.column, direction: o.direction ?? 'asc' as const };
  });
  // The primary key goes last, so paging with an offset is stable.
  for (const k of t.primaryKey) if (!order.some((o) => o.column === k)) order.push({ column: k, direction: 'asc' });
  return { table: t, columns, filters, order, limit: req.limit ?? DEFAULT_SELECT_LIMIT, offset: req.offset ?? 0, count: req.count === true };
}

/** A write step, checked and ready to build. */
type PlannedStep =
  | { op: 'insert'; table: TableFacts; values: Record<string, unknown> }
  | { op: 'update'; table: TableFacts; key: [string, unknown][]; set: Record<string, unknown>; filters: PlannedFilter[]; expect?: number }
  | { op: 'delete'; table: TableFacts; key: [string, unknown][]; filters: PlannedFilter[]; expect?: number };

function planStep(tables: Map<string, TableFacts>, step: WriteStep, facilities: string[] | '*'): PlannedStep {
  const t = tableOf(tables, step.table);
  const values = (input: Record<string, unknown>, what: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const names = Object.keys(input);
    if (names.length === 0) throw new PluginRequestError('invalid', `table ${t.name}: ${what} names no columns`);
    for (const c of names) {
      const type = writable(t, c);
      out[c] = c === t.facilityColumn ? checkFacilityValue(t, input[c], facilities) : checkWriteValue(t, c, type, input[c]);
    }
    return out;
  };
  switch (step.op) {
    case 'insert': {
      const v = values(step.values, 'an insert');
      if (t.facilityColumn && !Object.prototype.hasOwnProperty.call(v, t.facilityColumn)) {
        throw new PluginRequestError('facility', `table ${t.name}: an insert must set the facility column ${t.facilityColumn}`);
      }
      return { op: 'insert', table: t, values: v };
    }
    case 'update':
      return { op: 'update', table: t, key: checkKey(t, step.key), set: values(step.set, 'an update'), filters: planFilters(t, step.where ?? []), expect: step.expect };
    case 'delete':
      return { op: 'delete', table: t, key: checkKey(t, step.key), filters: planFilters(t, step.where ?? []), expect: step.expect };
  }
}

/** What a plugin data request does about the plugin data role (design 2026-11-25-plugin-data-rls-role):
 *  - `switch`: CE's login bypasses row-level security (a superuser, or BYPASSRLS) and may use the
 *    role, so each request runs as it and the facility policy applies.
 *  - `not-needed`: the login does not bypass row-level security, so the forced policy already applies
 *    (also pg-mem, which has no roles).
 *  - `missing`: the login bypasses it but the role is missing or not usable (migration 145 could not
 *    make it). The CE filter alone guards, as before. */
export type PluginDataRoleStatus = 'switch' | 'not-needed' | 'missing';

/** The check itself. `unknown` when it could not run (a failed query); pg-mem is `not-needed`. A
 *  login may switch to the role when it holds SET on it (Postgres 16 and later) or is a member
 *  (before 16); a superuser always may. */
async function readPluginDataRoleStatus(db: Kysely<any>): Promise<PluginDataRoleStatus | 'unknown'> {
  try {
    const v = await sql<{ v: number }>`select current_setting('server_version_num')::int as v`.execute(db);
    const option = (v.rows[0]?.v ?? 0) >= 160000 ? 'SET' : 'MEMBER';
    const r = await sql<{ bypass: boolean; usable: boolean }>`
      select (me.rolsuper or me.rolbypassrls) as bypass,
             coalesce((select pg_has_role(current_user, r.oid, ${option}) from pg_roles r where r.rolname = ${PLUGIN_DATA_ROLE}), false) as usable
      from pg_roles me where me.rolname = current_user`.execute(db);
    const row = r.rows[0];
    if (!row || !row.bypass) return 'not-needed';
    return row.usable ? 'switch' : 'missing';
  } catch (e) {
    // pg-mem has no roles and no current_setting: its error has no SQLSTATE code and says "does not
    // exist". Real Postgres always gives a code, so that answer lasts. Anything else may pass.
    const err = e as { code?: unknown; message?: unknown } | null;
    if (err?.code === undefined && /does not exist/.test(String(err?.message ?? ''))) return 'not-needed';
    return 'unknown';
  }
}

export async function pluginDataRoleStatus(db: Kysely<any>): Promise<PluginDataRoleStatus> {
  const s = await readPluginDataRoleStatus(db);
  return s === 'unknown' ? 'not-needed' : s;
}

/** What CE keeps of the role check, per process. An answer is kept; a check that could not run is
 *  not, so the next request checks again (one failed query does not turn the second guard off for
 *  good). Before the first switch the role is granted every plugin schema; if that grant fails, CE
 *  keeps `missing` and its own filter guards. `forget` drops the kept answer: a request that finds
 *  the role gone calls it, then checks again. */
export function createRoleStatus(
  read: () => Promise<PluginDataRoleStatus | 'unknown'>,
  grantAll: () => Promise<void>,
): { get: () => Promise<PluginDataRoleStatus>; forget: () => void } {
  let kept: Promise<PluginDataRoleStatus> | null = null;
  return {
    get() {
      if (kept) return kept;
      const p = (async (): Promise<PluginDataRoleStatus | 'unknown'> => {
        const s = await read();
        if (s !== 'switch') return s;
        try {
          await grantAll();
          return 'switch';
        } catch {
          return 'missing';
        }
      })().then((s) => {
        if (s === 'unknown') {
          if (kept === answer) kept = null;
          return 'not-needed' as const;
        }
        return s;
      });
      const answer = p;
      kept = answer;
      return answer;
    },
    forget() { kept = null; },
  };
}

/** SET ROLE on a role dropped while CE runs: Postgres answers 22023 (invalid_parameter_value),
 *  "role ... does not exist". */
const roleGone = (e: unknown): boolean => {
  const err = e as { code?: unknown; message?: unknown } | null;
  return err?.code === '22023' && /role .* does not exist/.test(String(err?.message ?? ''));
};

export function createPluginRequests(db: Kysely<any>): PluginRequests {
  // Read at the first request and kept (createRoleStatus). A server started before migration 145
  // ran switches after a restart.
  const roles = createRoleStatus(() => readPluginDataRoleStatus(db), () => grantPluginDataRoleAll(db));

  /** Runs one request's transaction with the role answer. If the role was dropped while CE runs,
   *  SET ROLE fails and the transaction rolls back: forget the answer, check again, and run once
   *  more (CE then does not switch, and its own filter guards). */
  async function withRole<T>(run: (role: PluginDataRoleStatus) => Promise<T>): Promise<T> {
    const role = await roles.get();
    try {
      return await run(role);
    } catch (e) {
      if (role !== 'switch' || !roleGone(e)) throw e;
      roles.forget();
      return run(await roles.get());
    }
  }

  /** Inside the request's transaction: set the timeout and the facility setting, then read the
   *  recorded shapes for the named tables and check the declared ones fit inside them. Returns the
   *  recorded facts. Statements are still built from the declared facts. */
  async function begin(trx: Kysely<any>, pluginId: string, schema: string, declared: Map<string, TableFacts>, names: Set<string>, facilities: string[] | '*', role: PluginDataRoleStatus): Promise<Map<string, TableFacts>> {
    await sql`set local statement_timeout = ${sql.lit(STATEMENT_TIMEOUT)}`.execute(trx);
    await sql`select set_config(${FACILITIES_SETTING}, ${settingFor(facilities)}, true)`.execute(trx);
    // Under a login that bypasses row-level security, run the rest of this transaction as the plugin
    // data role, so the facility policy applies as a second guard. SET LOCAL ends with the transaction.
    if (role === 'switch') await sql`set local role ${sql.id(PLUGIN_DATA_ROLE)}`.execute(trx);
    const rows = await trx.withSchema(schema).selectFrom(SHAPES_TABLE)
      .select(['table_name', 'plugin_id', 'shape']).where('table_name', 'in', [...names]).execute();
    const recorded = new Map<string, TableFacts>();
    for (const r of rows) {
      if (r.plugin_id !== pluginId) throw new PluginRequestError('shape', `schema ${schema} belongs to plugin '${r.plugin_id}'`);
      const shape = typeof r.shape === 'string' ? JSON.parse(r.shape) : r.shape;
      const t = factsOf(parse(tableShapeSchema, shape, `the recorded shape of ${r.table_name}`));
      if (t.name !== r.table_name) throw new PluginRequestError('shape', `the recorded shape of ${r.table_name} names another table`);
      recorded.set(t.name, t);
    }
    for (const name of names) {
      const was = recorded.get(name);
      if (!was) throw new PluginRequestError('table', `table '${name}' was never made for this plugin`);
      const why = mismatch(declared.get(name)!, was);
      if (why) throw new PluginRequestError('shape', `table ${name}: the declared shape does not match the one CE made: ${why}`);
    }
    return recorded;
  }

  return {
    async select(pluginId, shapes, caller, input) {
      // Everything here runs before any SQL.
      const schema = pluginSchemaName(pluginId);
      const req = parse(selectRequestSchema, input, 'the select request');
      const facilities = callerFacilities(caller);
      const declared = declaredTables(shapes, 'the declared shapes');
      planSelect(declared, req);

      return withRole((role) => db.transaction().execute(async (trx) => {
        await begin(trx, pluginId, schema, declared, new Set([req.table]), facilities, role);
        const p = planSelect(declared, req);
        const t = p.table;
        const scoped = (q: any) => {
          let out = q;
          const ff = facilityFilter(t, facilities);
          if (ff) out = out.where(ff);
          return applyFilters(out, p.filters);
        };
        let q = scoped(trx.withSchema(schema).selectFrom(t.name).select(p.columns));
        for (const o of p.order) q = q.orderBy(o.column, o.direction);
        const rows = (await q.limit(p.limit).offset(p.offset).execute()) as Record<string, unknown>[];
        if (!p.count) return { rows };
        const c = await scoped(trx.withSchema(schema).selectFrom(t.name).select((eb: any) => eb.fn.countAll().as('n'))).executeTakeFirst();
        return { rows, count: Number(c?.n ?? 0) };
      }));
    },

    async write(pluginId, shapes, caller, input) {
      const schema = pluginSchemaName(pluginId);
      const req = parse(writeRequestSchema, input, 'the write request');
      const facilities = callerFacilities(caller);
      const declared = declaredTables(shapes, 'the declared shapes');
      for (const s of req.steps) planStep(declared, s, facilities);

      return withRole((role) => db.transaction().execute(async (trx) => {
        const recorded = await begin(trx, pluginId, schema, declared, new Set(req.steps.map((s) => s.table)), facilities, role);
        for (const s of req.steps) {
          if (s.op !== 'insert') continue;
          const missing = undeclaredRequired(declared.get(s.table)!, recorded.get(s.table)!);
          if (missing.length > 0) {
            throw new PluginRequestError('shape', `table ${s.table}: cannot add a row, because column ${missing.join(', ')} may not be empty and this version of the plugin does not declare it`);
          }
        }
        const results: { rowCount: number }[] = [];
        for (const [i, s] of req.steps.entries()) {
          const p = planStep(declared, s, facilities);
          const t = p.table;
          if (p.op === 'insert') {
            const r = await trx.withSchema(schema).insertInto(t.name).values(p.values).executeTakeFirst();
            results.push({ rowCount: Number(r.numInsertedOrUpdatedRows ?? 0n) });
            continue;
          }
          let q: any = p.op === 'update'
            ? trx.withSchema(schema).updateTable(t.name).set({ ...p.set, updated_at: sql`now()` })
            : trx.withSchema(schema).deleteFrom(t.name);
          for (const [k, v] of p.key) q = q.where(k, '=', v);
          const ff = facilityFilter(t, facilities);
          if (ff) q = q.where(ff);
          q = applyFilters(q, p.filters);
          const r = await q.executeTakeFirst();
          const n = Number((p.op === 'update' ? r.numUpdatedRows : r.numDeletedRows) ?? 0n);
          // Thrown inside the transaction, so every step of the request is rolled back.
          if (p.expect !== undefined && n !== p.expect) {
            throw new PluginRequestError('conflict', `step ${i + 1} on table ${t.name}: expected ${p.expect} rows to change, ${n} did; nothing was saved`);
          }
          results.push({ rowCount: n });
        }
        return { results };
      }));
    },
  };
}
