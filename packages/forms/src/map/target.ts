import type { Coding } from 'fhir/r4';
import { normalizeDiscriminator } from '../discriminator';
import type { StarterPackEntry } from '../starter-pack';
import { canWriteFromCell } from './write';

/**
 * One part of a record's id: the value the row wrote for a target path key (after its rule), or
 * the id of another record of the target, which is worked out first.
 */
export type IdentityPart = { field: string; optional?: boolean } | { record: string };

/**
 * What a mapping writes into: the records it makes, how they link, FHIR's own required status
 * values, and the fields a person can map a source field to. Built from starter packs.
 */
export interface MapTarget {
  id: string;
  name: string;
  records: { type: string; packId: string; repeats: boolean }[];
  /** For example from 'Observation', path 'Observation.subject', to 'Patient'. */
  links: { from: string; path: string; to: string }[];
  /** Values every record of a type gets: FHIR's required status fields, and the like. */
  defaults: { path: string; value: string | Coding }[];
  /** `path` is the field's key: see `targetPathKey`. */
  fields: { path: string; label: string; required: boolean; repeats: boolean; valueSet: string | null }[];
  /**
   * How each record's id is made from the row, one entry per record type. `fallback` is used when a
   * part of `parts` that is not optional has no value. See `applyMapping`.
   */
  identity: { record: string; parts: IdentityPart[]; fallback?: IdentityPart[] }[];
  /**
   * Fields the mapping fills itself when no row maps them: `path`, on a record that does not repeat,
   * gets one coding per distinct coding at `from` across the row's repeating records. Never part of
   * an id. For example the order's test codes from its results'.
   */
  derived?: { path: string; from: string }[];
  /**
   * Repeating record types made only when they hold a result value (a `value[x]`): a test whose
   * result is blank gives no result record, and the run notes it. Its code still reaches `derived`.
   */
  needsValue?: string[];
}

// Only these characters are escaped, so a key stays readable: `Patient.name.given?use=official`.
function escape(s: string): string {
  return s.replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
}

/** A target field's key: the FHIR path, plus `?el=val&el2=val2` (keys sorted) for pinned values. */
export function targetPathKey(path: string, where: Record<string, string>): string {
  const els = Object.keys(where).sort();
  if (els.length === 0) return path;
  return `${path}?${els.map((el) => `${escape(el)}=${escape(where[el])}`).join('&')}`;
}

/**
 * The FHIR path and pinned values of a key. Null for a malformed key: a bad escape, a pair with no
 * `=` or no element, or one element twice. A key is config, so the caller reports it by name.
 */
export function parseTargetPath(key: string): { path: string; where: Record<string, string> } | null {
  const q = key.indexOf('?');
  if (q === -1) return { path: key, where: {} };
  const where: Record<string, string> = {};
  for (const pair of key.slice(q + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) return null;
    let el: string;
    let val: string;
    try {
      el = decodeURIComponent(pair.slice(0, eq));
      val = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      return null; // a stray % is not an escape this file wrote
    }
    if (Object.hasOwn(where, el)) return null;
    where[el] = val;
  }
  return { path: key.slice(0, q), where };
}

/** The values an entry's discriminator pins, or null when it does not pin any it names. */
function pinnedValues(entry: StarterPackEntry): Record<string, string> | null {
  const rule = normalizeDiscriminator(entry.discriminator);
  if (!rule) return {};
  if (rule.join !== 'all') return null;
  const where: Record<string, string> = {};
  for (const c of rule.conds) {
    if (c.op !== 'equals') return null;
    if (Object.hasOwn(where, c.el) && where[c.el] !== c.val) return null;
    where[c.el] = c.val;
  }
  return where;
}

export function buildTarget(
  id: string,
  name: string,
  packs: { pack: { id: string; resourceType: string }; entries: StarterPackEntry[]; repeats?: boolean }[],
  /**
   * `extra`: fields no pack holds. Each goes first among its record's fields and takes its repeats.
   * `required`: when given, a field is required exactly when its key is listed, whatever the pack says.
   */
  opts: {
    links: MapTarget['links'];
    defaults: MapTarget['defaults'];
    identity: MapTarget['identity'];
    extra?: MapTarget['fields'];
    required?: string[];
    derived?: MapTarget['derived'];
    needsValue?: MapTarget['needsValue'];
  },
): MapTarget {
  const linkPaths = new Set(opts.links.map((l) => l.path));
  const records: MapTarget['records'] = [];
  const fields: MapTarget['fields'] = [];
  const keys = new Set<string>();
  const extra = opts.extra ?? [];
  const typeOf = (key: string) => key.split(/[.?]/)[0];

  for (const { pack, entries, repeats = false } of packs) {
    // Links name records by type, so two records of one type would be ambiguous.
    if (records.some((r) => r.type === pack.resourceType)) {
      throw new Error(`map target ${id}: two packs make a ${pack.resourceType} record`);
    }
    records.push({ type: pack.resourceType, packId: pack.id, repeats });

    for (const f of extra) {
      if (typeOf(f.path) !== pack.resourceType) continue;
      if (linkPaths.has(parseTargetPath(f.path)?.path ?? f.path)) {
        throw new Error(`map target ${id}: the extra field ${f.path} is a link the target writes`);
      }
      if (!canWriteFromCell(f.path)) throw new Error(`map target ${id}: no single cell can fill the extra field ${f.path}`);
      if (keys.has(f.path)) throw new Error(`map target ${id}: two entries share the key ${f.path}`);
      keys.add(f.path);
      fields.push({ ...f, repeats });
    }

    for (const entry of entries) {
      if (!entry.fhirPath || linkPaths.has(entry.fhirPath)) continue;
      const where = pinnedValues(entry);
      if (!where) continue;
      const key = targetPathKey(entry.fhirPath, where);
      // An Extension or another complex leaf cannot take one cell, so it is not offered.
      if (!canWriteFromCell(key)) {
        if (entry.required) throw new Error(`map target ${id}: the required entry ${key} cannot be filled from one cell`);
        continue;
      }
      if (keys.has(key)) throw new Error(`map target ${id}: two entries share the key ${key}`);
      keys.add(key);
      fields.push({ path: key, label: entry.label, required: entry.required, repeats, valueSet: entry.boundValueSet });
    }
  }

  for (const f of extra) {
    if (!records.some((r) => r.type === typeOf(f.path))) {
      throw new Error(`map target ${id}: the extra field ${f.path} has no ${typeOf(f.path)} record`);
    }
  }

  if (opts.required) {
    const listed = new Set(opts.required);
    for (const key of listed) if (!keys.has(key)) throw new Error(`map target ${id}: the required key ${key} is not a field`);
    for (const f of fields) f.required = listed.has(f.path);
  }

  checkIdentity(id, records, fields, opts.identity);
  for (const d of opts.derived ?? []) {
    for (const key of [d.path, d.from]) if (!keys.has(key)) throw new Error(`map target ${id}: the derived field names ${key}, which is not a field`);
    if (!records.find((r) => r.type === typeOf(d.from))?.repeats) throw new Error(`map target ${id}: the derived field ${d.path} reads ${d.from}, which does not repeat`);
    if (records.find((r) => r.type === typeOf(d.path))?.repeats) throw new Error(`map target ${id}: the derived field ${d.path} is on a record that repeats`);
  }
  return {
    id, name, records, links: opts.links, defaults: opts.defaults, fields, identity: opts.identity,
    ...(opts.derived ? { derived: opts.derived } : {}),
    ...(opts.needsValue ? { needsValue: opts.needsValue } : {}),
  };
}

function checkIdentity(id: string, records: MapTarget['records'], fields: MapTarget['fields'], identity: MapTarget['identity']): void {
  const recordOf = new Map(records.map((r) => [r.type, r]));
  const fieldOf = new Map(fields.map((f) => [f.path, f]));
  const byRecord = new Map<string, MapTarget['identity'][number]>();
  for (const ident of identity) {
    if (!recordOf.has(ident.record)) throw new Error(`map target ${id}: an identity names ${ident.record}, which is not a record`);
    if (byRecord.has(ident.record)) throw new Error(`map target ${id}: two identities for ${ident.record}`);
    byRecord.set(ident.record, ident);
  }
  for (const record of records) {
    const ident = byRecord.get(record.type);
    if (!ident) throw new Error(`map target ${id}: ${record.type} has no identity`);
    for (const parts of [ident.parts, ident.fallback]) {
      if (!parts) continue;
      if (parts.length === 0) throw new Error(`map target ${id}: the identity of ${record.type} has no parts`);
      for (const part of parts) {
        if ('record' in part) {
          const to = recordOf.get(part.record);
          if (!to) throw new Error(`map target ${id}: the identity of ${record.type} names ${part.record}, which is not a record`);
          if (to.repeats) throw new Error(`map target ${id}: the identity of ${record.type} names ${part.record}, which repeats`);
        } else {
          const f = fieldOf.get(part.field);
          if (!f) throw new Error(`map target ${id}: the identity of ${record.type} names ${part.field}, which is not a field`);
          if (f.repeats && !record.repeats) {
            throw new Error(`map target ${id}: the identity of ${record.type} reads ${part.field}, which repeats`);
          }
        }
      }
    }
  }
  // A record part means "work that record out first", so the parts must not loop.
  const state = new Map<string, 'open' | 'done'>();
  const visit = (type: string, path: string[]): void => {
    if (state.get(type) === 'done') return;
    if (state.get(type) === 'open') throw new Error(`map target ${id}: the identities form a cycle: ${[...path, type].join(' -> ')}`);
    state.set(type, 'open');
    const ident = byRecord.get(type)!;
    for (const part of [...ident.parts, ...(ident.fallback ?? [])]) if ('record' in part) visit(part.record, [...path, type]);
    state.set(type, 'done');
  };
  for (const record of records) visit(record.type, []);
}
