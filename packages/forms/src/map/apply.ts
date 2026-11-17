import type { FhirResource } from 'fhir/r4';
import { z } from 'zod';
import { applyRule, MapRuleSchema, type MapValue, type RuleDeps } from './rules';
import { parseTargetPath, type MapTarget } from './target';
import { writeValue, type WriteValue } from './write';

/**
 * Turn one item (one row of a lab's data) into linked FHIR records through a saved mapping.
 * Every reason names a field, a path or a label. None carries a value from the item.
 */

export const FieldMappingSchema = z.object({
  /** A target field's key, or a plain FHIR path for a row a person added. */
  targetPath: z.string().min(1),
  from: z.union([
    z.object({ field: z.string().min(1) }).strict(),
    z.object({ fields: z.array(z.string().min(1)).min(1) }).strict(),
    z.object({ fixed: z.string() }).strict(),
  ]),
  rule: MapRuleSchema.optional(),
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const SavedMappingSchema = z.object({
  shapeHash: z.string().min(1),
  fieldNames: z.array(z.string()),
  targetId: z.string().min(1),
  rows: z.array(FieldMappingSchema),
});
export type SavedMapping = z.infer<typeof SavedMappingSchema>;

export interface ApplyDeps extends RuleDeps {
  newId(): string;
}

export type ApplyResult = { ok: true; resources: FhirResource[] } | { ok: false; reason: string; field?: string };
type Failure = Extract<ApplyResult, { ok: false }>;

type Resource = Record<string, unknown> & { resourceType: string; id: string };

interface ResolvedRow {
  row: FieldMapping;
  label: string;
  required: boolean;
  /** The source field names, for reasons. */
  sources: string[];
  /** One entry per value; null where the source is missing or empty. */
  values: (MapValue | null)[];
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function sourcesOf(row: FieldMapping, json: Record<string, unknown>): { field: string; value: unknown }[] {
  const from = row.from;
  if ('fixed' in from) return [{ field: row.targetPath, value: from.fixed }];
  if ('fields' in from) return from.fields.map((f) => ({ field: f, value: json[f] }));
  const v = json[from.field];
  if (Array.isArray(v) && v.length > 0) return v.map((e) => ({ field: from.field, value: e }));
  return [{ field: from.field, value: Array.isArray(v) ? undefined : v }];
}

async function resolveRow(
  row: FieldMapping,
  target: MapTarget,
  json: Record<string, unknown>,
  deps: ApplyDeps,
): Promise<ResolvedRow | Failure> {
  const field = target.fields.find((f) => f.path === row.targetPath);
  const sources = sourcesOf(row, json);
  const values: (MapValue | null)[] = [];
  for (const s of sources) {
    if (isEmpty(s.value)) {
      values.push(null);
      continue;
    }
    if (typeof s.value !== 'string' && typeof s.value !== 'number' && typeof s.value !== 'boolean') {
      return { ok: false, reason: `${s.field}: expected a single value, not a list or an object`, field: s.field };
    }
    if (!row.rule) {
      values.push(s.value);
      continue;
    }
    const r = await applyRule(row.rule, s.value, s.field, deps);
    if (!r.ok) return r;
    values.push(r.value);
  }
  return {
    row,
    label: field?.label ?? row.targetPath,
    required: field?.required ?? false,
    sources: [...new Set(sources.map((s) => s.field))],
    values,
  };
}

function missing(key: string, label: string): Failure {
  return { ok: false, reason: `${label} is required and has no value`, field: key };
}

function write(resource: Resource, key: string, value: WriteValue): Failure | null {
  const r = writeValue(resource, key, value);
  return r.ok ? null : { ok: false, reason: r.reason, field: key };
}

export async function applyMapping(
  mapping: SavedMapping,
  target: MapTarget,
  json: Record<string, unknown>,
  deps: ApplyDeps,
): Promise<ApplyResult> {
  const recordOf = new Map(target.records.map((r) => [r.type, r]));

  const mapped = new Set(mapping.rows.map((r) => r.targetPath));
  for (const f of target.fields) if (f.required && !mapped.has(f.path)) return missing(f.path, f.label);

  for (const link of target.links) {
    if (!recordOf.has(link.from)) continue;
    const to = recordOf.get(link.to);
    if (!to || to.repeats) {
      return { ok: false, reason: `${link.path} must link to one ${link.to} record, and the target has none`, field: link.path };
    }
  }

  // Resolve every row first, grouped by the record type it writes.
  const rowsOf = new Map<string, ResolvedRow[]>();
  for (const row of mapping.rows) {
    const parsed = parseTargetPath(row.targetPath);
    if (!parsed) return { ok: false, reason: `the target path ${row.targetPath} is malformed`, field: row.targetPath };
    const type = parsed.path.split('.')[0];
    const record = recordOf.get(type);
    if (!record) return { ok: false, reason: `the target has no ${type} record`, field: row.targetPath };
    const resolved = await resolveRow(row, target, json, deps);
    if ('ok' in resolved) return resolved;
    if (!record.repeats && resolved.values.length > 1) {
      const field = resolved.sources[0];
      return { ok: false, reason: `${resolved.sources.join(', ')}: more than one value for ${resolved.label}, which does not repeat`, field };
    }
    rowsOf.set(type, [...(rowsOf.get(type) ?? []), resolved]);
  }

  const ids = new Map<string, string>();
  const fill = (resource: Resource, rows: ResolvedRow[], index: number): Failure | null => {
    for (const d of target.defaults) {
      if (d.path.split('.')[0] !== resource.resourceType) continue;
      const f = write(resource, d.path, d.value);
      if (f) return f;
    }
    for (const r of rows) {
      const value = r.values.length === 1 ? r.values[0] : r.values[index];
      if (value === null) {
        if (r.required) return missing(r.row.targetPath, r.label);
        continue;
      }
      const f = write(resource, r.row.targetPath, value);
      if (f) return f;
    }
    for (const link of target.links) {
      if (link.from !== resource.resourceType) continue;
      const f = write(resource, link.path, { reference: `${link.to}/${ids.get(link.to)}` });
      if (f) return f;
    }
    return null;
  };

  const single: Resource[] = [];
  for (const record of target.records) {
    if (record.repeats) continue;
    const resource: Resource = { resourceType: record.type, id: deps.newId() };
    ids.set(record.type, resource.id);
    single.push(resource);
  }
  for (const resource of single) {
    const f = fill(resource, rowsOf.get(resource.resourceType) ?? [], 0);
    if (f) return f;
  }

  const repeated: Resource[] = [];
  for (const record of target.records) {
    if (!record.repeats) continue;
    const rows = rowsOf.get(record.type) ?? [];
    const n = Math.max(1, ...rows.map((r) => r.values.length));
    const bad = rows.find((r) => r.values.length !== 1 && r.values.length !== n);
    if (bad) {
      return { ok: false, reason: `${bad.sources.join(', ')}: ${bad.values.length} values where the other rows give ${n}`, field: bad.sources[0] };
    }
    const multi = rows.filter((r) => r.values.length === n && n > 1);
    for (let i = 0; i < n; i++) {
      if (multi.length > 0 && multi.every((r) => r.values[i] === null)) continue;
      const resource: Resource = { resourceType: record.type, id: deps.newId() };
      const f = fill(resource, rows, i);
      if (f) return f;
      repeated.push(resource);
    }
  }

  return { ok: true, resources: [...single, ...repeated] as unknown as FhirResource[] };
}
