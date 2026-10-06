import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CustomQueryInputSchema, validateSelectSql } from '@openldr/dashboards';
import type { CustomQueryParam, CustomQueryStore } from '@openldr/db';
import { DEFAULT_CONNECTOR_NAME } from './seed';

export const CUSTOM_QUERY_FILE_FORMAT = 'openldr.custom-queries';

export interface CustomQueryFile {
  format: typeof CUSTOM_QUERY_FILE_FORMAT;
  version: 1;
  exportedAt: string;
  queries: { name: string; sql: string; params: CustomQueryParam[] }[];
}
export type ImportOutcome = 'created' | 'replaced' | 'skipped';
export interface ImportResult { results: { name: string; outcome: ImportOutcome; id: string }[] }
export interface TransferDeps {
  customQueries: CustomQueryStore;
  connectors: { list(): Promise<{ id: string; name: string }[]> };
  newId?: () => string;
  now?: () => Date;
}

export class CustomQueryTransferError extends Error {}

const FileSchema = z.object({
  format: z.literal(CUSTOM_QUERY_FILE_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  queries: z.array(z.object({
    name: z.string().min(1),
    sql: z.string().min(1),
    // Params are checked per query below, with the shared CustomQueryInputSchema.
    params: z.array(z.unknown()),
  })),
});

export async function exportCustomQueries(
  deps: TransferDeps,
  select?: { ids?: string[]; names?: string[] },
): Promise<CustomQueryFile> {
  let rows = await deps.customQueries.list();
  if (select?.ids) rows = rows.filter((r) => select.ids!.includes(r.id));
  if (select?.names) rows = rows.filter((r) => select.names!.includes(r.name));
  rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  return {
    format: CUSTOM_QUERY_FILE_FORMAT,
    version: 1,
    exportedAt: (deps.now ?? (() => new Date()))().toISOString(),
    queries: rows.map((r) => ({ name: r.name, sql: r.sql, params: r.params })),
  };
}

function parseFile(file: unknown): z.infer<typeof FileSchema> {
  const head = (typeof file === 'object' && file !== null ? file : {}) as { format?: unknown; version?: unknown };
  if (head.format !== CUSTOM_QUERY_FILE_FORMAT) {
    throw new CustomQueryTransferError(`not a custom query file (expected format "${CUSTOM_QUERY_FILE_FORMAT}")`);
  }
  if (head.version !== 1) {
    throw new CustomQueryTransferError(`unsupported file version ${String(head.version)} (this server reads version 1)`);
  }
  const parsed = FileSchema.safeParse(file);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new CustomQueryTransferError(`invalid custom query file: ${i.path.join('.') || 'file'}: ${i.message}`);
  }
  return parsed.data;
}

function validateFile(file: unknown): {
  parsed: z.infer<typeof FileSchema>;
  checked: { name: string; sql: string; params: CustomQueryParam[] }[];
} {
  const parsed = parseFile(file);

  // Validate every query before any write.
  const seen = new Set<string>();
  const checked: { name: string; sql: string; params: CustomQueryParam[] }[] = [];
  for (const query of parsed.queries) {
    if (seen.has(query.name)) {
      throw new CustomQueryTransferError(`query "${query.name}": name appears more than once in the file`);
    }
    seen.add(query.name);
    const shape = CustomQueryInputSchema.safeParse({ ...query, connectorId: 'pending' });
    if (!shape.success) {
      throw new CustomQueryTransferError(`query "${query.name}": ${shape.error.issues[0].message}`);
    }
    checked.push({ name: query.name, sql: query.sql, params: shape.data.params });
    try {
      validateSelectSql(query.sql);
    } catch (e) {
      throw new CustomQueryTransferError(`query "${query.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { parsed, checked };
}

/** The checks `importCustomQueries` runs before it writes anything. Throws `CustomQueryTransferError`. */
export function checkCustomQueryFile(file: unknown): void {
  validateFile(file);
}

export async function importCustomQueries(
  deps: TransferDeps,
  file: unknown,
  opts: { connectorName?: string; replace: boolean },
): Promise<ImportResult> {
  const { parsed, checked } = validateFile(file);

  // Look up which names exist, then resolve the connector only if something will be created.
  const existing = new Map<string, { id: string }>();
  for (const query of parsed.queries) {
    const hit = await deps.customQueries.getByName(query.name);
    if (hit) existing.set(query.name, { id: hit.id });
  }
  let connectorId: string | undefined;
  if (checked.some((x) => !existing.has(x.name))) {
    const wanted = opts.connectorName ?? DEFAULT_CONNECTOR_NAME;
    const found = (await deps.connectors.list()).find((c) => c.name === wanted);
    if (!found) throw new CustomQueryTransferError(`connector "${wanted}" not found`);
    connectorId = found.id;
  }

  const newId = deps.newId ?? (() => `cq_${randomUUID().slice(0, 8)}`);
  const results: ImportResult['results'] = [];
  for (const query of checked) {
    const hit = existing.get(query.name);
    if (!hit) {
      const id = newId();
      await deps.customQueries.create({ id, name: query.name, connectorId: connectorId!, sql: query.sql, params: query.params });
      results.push({ name: query.name, outcome: 'created', id });
    } else if (opts.replace) {
      await deps.customQueries.update(hit.id, { sql: query.sql, params: query.params });
      results.push({ name: query.name, outcome: 'replaced', id: hit.id });
    } else {
      results.push({ name: query.name, outcome: 'skipped', id: hit.id });
    }
  }
  return { results };
}
