import { normalizeDiscriminator } from '../discriminator';
import type { StarterPackEntry } from '../starter-pack';

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
  /** FHIR's own required status fields. */
  defaults: { path: string; value: string }[];
  /** `path` is the field's key: see `targetPathKey`. */
  fields: { path: string; label: string; required: boolean; repeats: boolean; valueSet: string | null }[];
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
  opts: { links: MapTarget['links']; defaults: MapTarget['defaults'] },
): MapTarget {
  const linkPaths = new Set(opts.links.map((l) => l.path));
  const records: MapTarget['records'] = [];
  const fields: MapTarget['fields'] = [];
  const keys = new Set<string>();

  for (const { pack, entries, repeats = false } of packs) {
    // Links name records by type, so two records of one type would be ambiguous.
    if (records.some((r) => r.type === pack.resourceType)) {
      throw new Error(`map target ${id}: two packs make a ${pack.resourceType} record`);
    }
    records.push({ type: pack.resourceType, packId: pack.id, repeats });

    for (const entry of entries) {
      if (!entry.fhirPath || linkPaths.has(entry.fhirPath)) continue;
      const where = pinnedValues(entry);
      if (!where) continue;
      const key = targetPathKey(entry.fhirPath, where);
      if (keys.has(key)) throw new Error(`map target ${id}: two entries share the key ${key}`);
      keys.add(key);
      fields.push({ path: key, label: entry.label, required: entry.required, repeats, valueSet: entry.boundValueSet });
    }
  }

  return { id, name, records, links: opts.links, defaults: opts.defaults, fields };
}
