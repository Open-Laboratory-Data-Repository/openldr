import { z } from 'zod';

/** The table shapes a plugin declares in its signed manifest. A plugin never sends SQL: CE reads
 *  these shapes as data and builds the tables itself, inside the plugin's own schema. So every name
 *  and type here is checked against a fixed list before any DDL is written from it. */

/** The only column types a plugin may declare. */
export const COLUMN_TYPES = ['text', 'integer', 'bigint', 'numeric', 'boolean', 'timestamptz', 'date', 'jsonb', 'uuid'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

/** A table or column name: lower case, starts with a letter, at most 63 characters (Postgres's limit). */
export const PLUGIN_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

/** CE adds these two columns to every plugin table and keeps them up to date, so a plugin may not declare them. */
export const CE_MANAGED_COLUMNS = ['created_at', 'updated_at'] as const;

export const MAX_PLUGIN_TABLES = 50;
export const MAX_PLUGIN_COLUMNS = 100;

const identifier = z.string().regex(PLUGIN_IDENTIFIER, 'must match ^[a-z][a-z0-9_]{0,62}$');

export const columnShapeSchema = z.object({
  name: identifier.refine((n) => !(CE_MANAGED_COLUMNS as readonly string[]).includes(n), {
    message: 'created_at and updated_at are added by CE and may not be declared',
  }),
  type: z.enum(COLUMN_TYPES),
  nullable: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
}).strict();
export type ColumnShape = z.infer<typeof columnShapeSchema>;

export const tableShapeSchema = z.object({
  name: identifier,
  columns: z.array(columnShapeSchema).min(1).max(MAX_PLUGIN_COLUMNS),
  primaryKey: z.array(z.string()).min(1),
  indexes: z.array(z.object({ columns: z.array(z.string()).min(1), unique: z.boolean().optional() }).strict()).optional(),
  facilityColumn: z.string().optional(),
}).strict().superRefine((t, ctx) => {
  const types = new Map<string, ColumnType>();
  for (const c of t.columns) {
    if (types.has(c.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: `table ${t.name}: column '${c.name}' is declared twice` });
    }
    types.set(c.name, c.type);
  }
  for (const k of t.primaryKey) {
    if (!types.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primaryKey'], message: `table ${t.name}: primary key column '${k}' is not a declared column` });
  }
  if (new Set(t.primaryKey).size !== t.primaryKey.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primaryKey'], message: `table ${t.name}: primary key names a column twice` });
  }
  for (const [i, idx] of (t.indexes ?? []).entries()) {
    for (const k of idx.columns) {
      if (!types.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['indexes', i], message: `table ${t.name}: index column '${k}' is not a declared column` });
    }
  }
  if (t.facilityColumn !== undefined) {
    const type = types.get(t.facilityColumn);
    if (type === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['facilityColumn'], message: `table ${t.name}: facility column '${t.facilityColumn}' is not a declared column` });
    } else if (type !== 'text' && type !== 'uuid') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['facilityColumn'], message: `table ${t.name}: facility column '${t.facilityColumn}' must be text or uuid` });
    }
  }
});
export type TableShape = z.infer<typeof tableShapeSchema>;

/** A plugin's whole list of tables: at most 50, each name used once. */
export const tableShapesSchema = z.array(tableShapeSchema).max(MAX_PLUGIN_TABLES).superRefine((tables, ctx) => {
  const seen = new Set<string>();
  for (const t of tables) {
    if (seen.has(t.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `table '${t.name}' is declared twice` });
    seen.add(t.name);
  }
});
