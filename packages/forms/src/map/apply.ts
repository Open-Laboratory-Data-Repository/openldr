import type { Coding, FhirResource } from 'fhir/r4';
import { lookupFhirPath } from '@openldr/fhir/paths';
import { z } from 'zod';
import { applyRule, MapRuleSchema, type MapValue, type RuleDeps } from './rules';
import { parseTargetPath, type IdentityPart, type MapTarget } from './target';
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
    /**
     * One fixed value per position, paired with the other rows of a repeating record that give a
     * list: the test of each column of a file with one column per test. Config only: what the person
     * typed, or a column's name. Allowed only on a field of a repeating record.
     */
    z.object({ fixedList: z.array(z.string().min(1)).min(1) }).strict(),
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
  /**
   * A record's id from its type and identity values, so the same row always gives the same ids.
   * It must hash, so no row value shows in an id, and give a FHIR id (letters, digits, `-`, `.`,
   * at most 64). It must join the parts in a way that cannot be confused, for example sha256 hex
   * of `JSON.stringify(parts)`: a plain separator could occur inside a value.
   *
   * `parts` is the record type, then `'fallback'` when the identity's fallback was used, then one
   * entry per identity part: another record's id, `t:` plus the trimmed text, `c:` plus
   * `JSON.stringify([system, code])` for a coding, or `''` for a missing optional part.
   */
  hashId(parts: string[]): string | Promise<string>;
}

const FHIR_ID = /^[A-Za-z0-9.-]{1,64}$/;

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
  /** True for a fixed value or a list of them. A fixed value never keeps a position alive. */
  fixed: boolean;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function sourcesOf(row: FieldMapping, json: Record<string, unknown>): { field: string; value: unknown }[] {
  const from = row.from;
  if ('fixed' in from) return [{ field: row.targetPath, value: from.fixed }];
  if ('fixedList' in from) return from.fixedList.map((v) => ({ field: row.targetPath, value: v }));
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
    fixed: 'fixed' in row.from || 'fixedList' in row.from,
  };
}

function missing(key: string, label: string): Failure {
  return { ok: false, reason: `${label} is required and has no value`, field: key };
}

/**
 * An identity part's value, tagged by kind so two kinds never meet: `c:` plus `[system, code]`
 * for a coding, `t:` plus the trimmed text for anything else. Only the id sees the trim; the
 * record keeps the value as the row gave it.
 */
function partText(v: MapValue): string {
  return typeof v === 'object' ? `c:${JSON.stringify([v.system ?? '', v.code])}` : `t:${String(v).trim()}`;
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
  const linkPaths = new Set(target.links.map((l) => l.path));
  const rowsOf = new Map<string, ResolvedRow[]>();
  for (const row of mapping.rows) {
    const parsed = parseTargetPath(row.targetPath);
    if (!parsed) return { ok: false, reason: `the target path ${row.targetPath} is malformed`, field: row.targetPath };
    const type = parsed.path.split('.')[0];
    // An id comes from the identity and a link from the target. A hand-edited config cannot map either.
    const plain = parsed.path.split('.').filter((s) => !/^\d+$/.test(s)).join('.');
    if (plain === `${type}.id`) {
      return { ok: false, reason: `${row.targetPath}: a record's id is made from its identity and cannot be mapped`, field: row.targetPath };
    }
    if (linkPaths.has(plain)) {
      return { ok: false, reason: `${row.targetPath}: the target makes this link itself, so it cannot be mapped`, field: row.targetPath };
    }
    const record = recordOf.get(type);
    if (!record) return { ok: false, reason: `the target has no ${type} record`, field: row.targetPath };
    if ('fixedList' in row.from && !record.repeats) {
      return { ok: false, reason: `${row.targetPath}: a list of fixed values is allowed only on a field of a repeating record`, field: row.targetPath };
    }
    const resolved = await resolveRow(row, target, json, deps);
    if ('ok' in resolved) return resolved;
    if (!record.repeats && resolved.values.length > 1) {
      const field = resolved.sources[0];
      return { ok: false, reason: `${resolved.sources.join(', ')}: more than one value for ${resolved.label}, which does not repeat`, field };
    }
    rowsOf.set(type, [...(rowsOf.get(type) ?? []), resolved]);
  }

  const rowOf = new Map<string, ResolvedRow>();
  for (const rows of rowsOf.values()) for (const r of rows) if (!rowOf.has(r.row.targetPath)) rowOf.set(r.row.targetPath, r);
  const identityOf = new Map(target.identity.map((i) => [i.record, i]));
  const ids = new Map<string, string>();

  // A required value that is empty is reported as required, before an id needs it.
  for (const f of target.fields) {
    if (!f.required) continue;
    const r = rowOf.get(f.path);
    if (r && r.values.every((v) => v === null)) return missing(f.path, f.label);
  }

  /** The values of one list of parts, or the first part with no value. */
  const collect = (parts: IdentityPart[], index: number): { values: string[] } | { missing: string } => {
    const values: string[] = [];
    for (const part of parts) {
      if ('record' in part) {
        const got = ids.get(part.record);
        if (got === undefined) throw new Error(`map target ${target.id}: the identity names ${part.record}, which has no id yet`);
        values.push(got);
        continue;
      }
      const r = rowOf.get(part.field);
      const v = r ? (r.values.length === 1 ? r.values[0] : r.values[index]) : null;
      if (v === null || v === undefined) {
        if (!part.optional) return { missing: part.field };
        values.push('');
      } else values.push(partText(v));
    }
    return { values };
  };

  const labelOf = (key: string) => target.fields.find((f) => f.path === key)?.label ?? key;

  const idFor = async (type: string, index: number): Promise<{ id: string; parts: IdentityPart[] } | Failure> => {
    const ident = identityOf.get(type);
    if (!ident) throw new Error(`map target ${target.id}: ${type} has no identity`);
    let used = ident.parts;
    let marker: string[] = [];
    let got = collect(ident.parts, index);
    if ('missing' in got && ident.fallback) {
      // With no value for the fallback either, its missing part is the one to name: the primary
      // part is often a column the lab does not have.
      got = collect(ident.fallback, index);
      used = ident.fallback;
      marker = ['fallback']; // so a fallback id never shares a hash input with a primary one
    }
    if ('missing' in got) {
      return { ok: false, reason: `${labelOf(got.missing)} is needed to tell one ${type} record from another, and has no value`, field: got.missing };
    }
    const id = await deps.hashId([type, ...marker, ...got.values]);
    if (typeof id !== 'string' || !FHIR_ID.test(id)) {
      throw new Error(`map target ${target.id}: hashId gave a ${type} id FHIR does not allow`);
    }
    return { id, parts: used };
  };

  // Single records first, each after the records its identity names.
  const singleId = async (type: string, seen: string[]): Promise<Failure | null> => {
    if (ids.has(type)) return null;
    if (seen.includes(type)) throw new Error(`map target ${target.id}: the identities form a cycle through ${type}`);
    const ident = identityOf.get(type);
    for (const part of [...(ident?.parts ?? []), ...(ident?.fallback ?? [])]) {
      if (!('record' in part)) continue;
      const to = recordOf.get(part.record);
      if (!to || to.repeats) throw new Error(`map target ${target.id}: the identity of ${type} names ${part.record}, which is not one record`);
      const f = await singleId(part.record, [...seen, type]);
      if (f) return f;
    }
    const r = await idFor(type, 0);
    if ('ok' in r) return r;
    ids.set(type, r.id);
    return null;
  };
  for (const record of target.records) {
    if (record.repeats) continue;
    const f = await singleId(record.type, []);
    if (f) return f;
  }

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
    single.push({ resourceType: record.type, id: ids.get(record.type)! });
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
    // The rows that read a list from the data. A position where every one of them is empty gives no
    // record; a fixed value, alone or in a list, never keeps a position alive.
    const multi = rows.filter((r) => !r.fixed && r.values.length === n && n > 1);
    const taken = new Set<string>();
    for (let i = 0; i < n; i++) {
      if (multi.length > 0 && multi.every((r) => r.values[i] === null)) continue;
      const got = await idFor(record.type, i);
      if ('ok' in got) return got;
      if (taken.has(got.id)) {
        // Name the source field of the first id part that changes from record to record.
        const key = got.parts.find((p): p is { field: string } => 'field' in p && (rowOf.get(p.field)?.values.length ?? 0) > 1)?.field
          ?? got.parts.find((p): p is { field: string } => 'field' in p)?.field ?? record.type;
        const r = rowOf.get(key);
        const field = r ? (r.sources[i] ?? r.sources[0]) : key;
        return { ok: false, reason: `${labelOf(key)}: two ${record.type} records in this row have the same value, so they would share one id`, field };
      }
      taken.add(got.id);
      const resource: Resource = { resourceType: record.type, id: got.id };
      const f = fill(resource, rows, i);
      if (f) return f;
      repeated.push(resource);
    }
  }

  // A field the target fills from the repeating records when no row maps it: the order's test
  // codes from its results'. It is written after every id is made, so no id reads it.
  const mappedPlain = new Set(mapping.rows.map((r) => plainPath(r.targetPath)));
  for (const d of target.derived ?? []) {
    if (mappedPlain.has(d.path)) continue;
    const holder = single.find((r) => r.resourceType === d.path.split('.')[0]);
    if (!holder) continue;
    const fromType = d.from.split('.')[0];
    const seen = new Set<string>();
    const codings: Coding[] = [];
    for (const r of repeated) {
      if (r.resourceType !== fromType) continue;
      for (const c of codingsAt(r, d.from)) {
        const key = JSON.stringify([c.system ?? '', c.code]);
        if (seen.has(key)) continue;
        seen.add(key);
        codings.push(c);
      }
    }
    if (codings.length === 0) continue;
    const many = lookupFhirPath(d.path)?.leafType === 'CodeableConcept';
    for (const [i, c] of (many ? codings : codings.slice(0, 1)).entries()) {
      const f = write(holder, many ? `${d.path}.coding.${i}` : d.path, c);
      if (f) return f;
    }
  }

  return { ok: true, resources: [...single, ...repeated] as unknown as FhirResource[] };
}

/** A key's FHIR path with no pinned values and no list indexes. */
function plainPath(key: string): string {
  const parsed = parseTargetPath(key);
  return (parsed?.path ?? key).split('.').filter((s) => !/^\d+$/.test(s)).join('.');
}

/** Every coding a record holds at a plain path: a CodeableConcept's codings, or a Coding itself. */
function codingsAt(resource: Resource, path: string): Coding[] {
  let values: unknown[] = [resource];
  for (const seg of path.split('.').slice(1)) {
    values = values.flatMap((v) => {
      const next = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[seg] : undefined;
      return Array.isArray(next) ? next : next === undefined ? [] : [next];
    });
  }
  const out: Coding[] = [];
  const isCoding = (v: unknown): v is Coding => !!v && typeof v === 'object' && typeof (v as Coding).code === 'string';
  for (const v of values) {
    const coding = v && typeof v === 'object' ? (v as { coding?: unknown }).coding : undefined;
    if (Array.isArray(coding)) out.push(...coding.filter(isCoding));
    else if (isCoding(v)) out.push(v);
  }
  return out.map((c) => (c.system ? { system: c.system, code: c.code } : { code: c.code! }));
}
