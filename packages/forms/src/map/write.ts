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
/** Every leaf type `wrap` fills from one value. `canWriteFromCell` reads the same set. */
const CELL_LEAVES = new Set([...PRIMITIVE_LEAVES, 'CodeableConcept', 'Coding', 'Reference']);
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
const isIndex = (s: string) => /^\d+$/.test(s);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type Wrapped = { ok: true; value: unknown } | { ok: false; reason: string };

const isCoding = (v: unknown): v is { code: string } =>
  isObject(v) && typeof v.code === 'string' && !('reference' in v);
const isReference = (v: unknown): v is { reference: string } => isObject(v) && typeof v.reference === 'string';

/**
 * The value in the shape the leaf's FHIR type holds, or a failure. Never writes a shape FHIR does
 * not allow for the leaf.
 */
function wrap(leafType: string, value: WriteValue, path: string): Wrapped {
  const no = (expected: string): Wrapped => ({ ok: false, reason: `${path} needs ${expected}` });
  const complex: Wrapped = { ok: false, reason: `${path} is a ${leafType}, which takes no single value: pick a more specific path under it` };
  if (!CELL_LEAVES.has(leafType)) return complex;
  const primitive = !isObject(value);
  switch (leafType) {
    case 'string':
    case 'code':
      if (primitive) return { ok: true, value: String(value) };
      return isCoding(value) ? { ok: true, value: value.code } : no('text');
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      const t = typeof value === 'string' ? value.trim().toLowerCase() : '';
      return t === 'true' || t === 'false' ? { ok: true, value: t === 'true' } : no('true or false');
    }
    case 'number':
      if (typeof value === 'number') return { ok: true, value };
      if (typeof value === 'string' && PLAIN_NUMBER.test(value.trim())) return { ok: true, value: Number(value.trim()) };
      return no('a number');
    case 'CodeableConcept':
      // A plain text is the lab's own code with no system (ruling R35), so the warehouse, which
      // reads coding[0].code, finds it. A code list rule gives a standard Coding instead.
      if (primitive) return { ok: true, value: { text: String(value), coding: [{ code: String(value) }] } };
      return isCoding(value) ? { ok: true, value: { coding: [value] } } : no('text or a code from a code list');
    case 'Coding':
      return isCoding(value) ? { ok: true, value } : no('a code from a code list');
    case 'Reference':
      if (typeof value === 'string') return { ok: true, value: { display: value } };
      return isReference(value) ? { ok: true, value } : no('text or a link');
    default:
      return complex;
  }
}

/** The FHIR path table form of a key: no pinned values, no list indices. Null for a bad key. */
function tablePathOf(key: string): string | null {
  const parsed = parseTargetPath(key);
  if (!parsed) return null;
  return parsed.path.split('.').filter((s) => !isIndex(s)).join('.');
}

/**
 * Whether the writer can fill this key from one value, judged by its leaf type alone. False for a
 * malformed key, a path the table does not know, and a complex leaf such as an Extension.
 */
export function canWriteFromCell(key: string): boolean {
  const tablePath = tablePathOf(key);
  const leaf = tablePath ? lookupFhirPath(tablePath) : null;
  return leaf !== null && CELL_LEAVES.has(leaf.leafType);
}

export function writeValue(resource: Record<string, unknown>, key: string, value: WriteValue): WriteResult {
  const parsed = parseTargetPath(key);
  if (!parsed) return { ok: false, reason: `the target path ${key} is malformed` };
  const { path, where } = parsed;
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
  // A single object already pinned another way: `requester` is one Reference, so it can be the
  // Practitioner or the Organization, not both. A list entry was matched on `where`, so it agrees.
  const existing = cur;
  if (whereAt === fullPath && isObject(existing) && Object.entries(where).some(([el, val]) => existing[el] !== undefined && existing[el] !== val)) {
    return { ok: false, reason: `the record can hold only one ${path}, and another pinned one is already written` };
  }

  setPath(resource, fullPath, finalValue);
  if (whereAt !== null) {
    for (const [el, val] of Object.entries(where)) setPath(resource, `${whereAt}.${el}`, val);
  }
  return { ok: true };
}
