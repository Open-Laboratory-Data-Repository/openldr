import { lookupFhirPath } from '@openldr/fhir/paths';
import { setPath } from '../extract/set-path';
import type { MapValue } from './rules';
import { parseTargetPath } from './target';

/**
 * Write one value into a record at a target path key. `setPath` needs array indices, and FHIR
 * needs list entries and wrapped values, so this turns the key into a concrete dotted path and the
 * value into what the leaf's type holds. A path the FHIR path table does not know is never written.
 * Reasons name the path and the expected type, never the value.
 */

/** A value to write: a rule's output, or a link's `{ reference }`. */
export type WriteValue = MapValue | { reference: string };

export type WriteResult = { ok: true } | { ok: false; reason: string };

const PRIMITIVE_LEAVES = new Set(['string', 'code', 'number', 'boolean']);
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
const isIndex = (s: string) => /^\d+$/.test(s);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type Wrapped = { ok: true; value: unknown } | { ok: false; reason: string };

function wrap(leafType: string, value: WriteValue, path: string): Wrapped {
  const text = isObject(value) ? null : String(value);
  switch (leafType) {
    case 'CodeableConcept':
      return { ok: true, value: isObject(value) ? { coding: [value] } : { text } };
    case 'Coding':
      return isObject(value) ? { ok: true, value } : { ok: false, reason: `${path} needs a code from a code list` };
    case 'Reference':
      return { ok: true, value: isObject(value) ? value : { display: text } };
    case 'number':
      if (typeof value === 'number') return { ok: true, value };
      if (text !== null && PLAIN_NUMBER.test(text.trim())) return { ok: true, value: Number(text.trim()) };
      return { ok: false, reason: `${path} needs a number` };
    default:
      return { ok: true, value };
  }
}

export function writeValue(resource: Record<string, unknown>, key: string, value: WriteValue): WriteResult {
  const { path, where } = parseTargetPath(key);
  const [type, ...rest] = path.split('.');
  if (type !== resource.resourceType || rest.length === 0) {
    return { ok: false, reason: `${path} is not a path on a ${String(resource.resourceType)} record` };
  }
  const tablePath = [type, ...rest.filter((s) => !isIndex(s))].join('.');
  const leaf = lookupFhirPath(tablePath);
  if (!leaf) return { ok: false, reason: `the FHIR path ${tablePath} is not known` };

  const hasWhere = Object.keys(where).length > 0;
  const out: string[] = [];
  let whereAt: string | null = null; // the dotted path of the object that takes the pinned values
  let listLeaf = false; // the leaf is itself a list of primitives
  let cumulative = type;
  let cur: unknown = resource;

  for (let i = 0; i < rest.length; i++) {
    const seg = rest[i];
    out.push(seg);
    cur = isObject(cur) || Array.isArray(cur) ? (cur as Record<string, unknown>)[seg] : undefined;
    if (isIndex(seg)) continue;
    cumulative += `.${seg}`;
    const info = lookupFhirPath(cumulative);
    if (!info) return { ok: false, reason: `the FHIR path ${cumulative} is not known` };
    if (!info.ownArray || isIndex(rest[i + 1] ?? '')) continue;

    const isLeaf = i === rest.length - 1;
    if (isLeaf && PRIMITIVE_LEAVES.has(leaf.leafType)) {
      listLeaf = true;
      break;
    }
    let index = 0;
    if (hasWhere && whereAt === null) {
      const list = Array.isArray(cur) ? cur : [];
      const found = list.findIndex((e) => isObject(e) && Object.entries(where).every(([el, val]) => e[el] === val));
      index = found === -1 ? list.length : found;
      whereAt = [...out, String(index)].join('.');
    }
    out.push(String(index));
    cur = Array.isArray(cur) ? cur[index] : undefined;
  }

  const fullPath = out.join('.');
  if (hasWhere && whereAt === null) whereAt = fullPath;

  const wrapped = wrap(leaf.leafType, value, tablePath);
  if (!wrapped.ok) return wrapped;
  const finalValue = listLeaf ? [wrapped.value] : wrapped.value;
  if (whereAt === fullPath && !isObject(finalValue)) {
    return { ok: false, reason: `${path} cannot hold the pinned values ${Object.keys(where).sort().join(', ')}` };
  }

  setPath(resource, fullPath, finalValue);
  if (whereAt !== null) {
    for (const [el, val] of Object.entries(where)) setPath(resource, `${whereAt}.${el}`, val);
  }
  return { ok: true };
}
