/**
 * A row as the Map to FHIR node reads it: nested objects and lists of objects turned into columns.
 *
 * - An object's keys join with a dot, at any depth: `{ patient: { number } }` gives `patient.number`.
 * - A list of objects gives one list column per key, lined up by position, with null where an entry
 *   lacks the key: `results: [{ code }, { code }]` gives `results.code: [..]`. The mapping reads such a
 *   column the way it reads one column per test.
 * - One list level only. A list inside a list entry stays one column of lists, which the mapping
 *   notes as nested data it cannot read. So does a list that mixes objects and plain values.
 * - A flattened row flattens to itself.
 *
 * Two columns that end with one name fail, naming the column and never a value.
 */

export type FlattenResult = { ok: true; row: Record<string, unknown> } | { ok: false; reason: string; field: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

class Clash extends Error {
  constructor(readonly field: string) {
    super(`${field}: two columns have this name once flattened`);
  }
}

function put(out: Record<string, unknown>, name: string, value: unknown): void {
  if (Object.prototype.hasOwnProperty.call(out, name)) throw new Clash(name);
  out[name] = value;
}

/** One list entry's columns: objects join with a dot, a list stays a value. */
function entryColumns(prefix: string, obj: Record<string, unknown>, out: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) entryColumns(name, v, out);
    else put(out, name, v);
  }
}

function walk(prefix: string, obj: Record<string, unknown>, out: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) {
      walk(name, v, out);
      continue;
    }
    const listOfObjects = Array.isArray(v) && v.length > 0 && v.every((e) => e === null || isPlainObject(e)) && v.some(isPlainObject);
    if (!listOfObjects) {
      put(out, name, v);
      continue;
    }
    const entries = (v as (Record<string, unknown> | null)[]).map((e) => {
      const cols: Record<string, unknown> = {};
      if (e) entryColumns('', e, cols);
      return cols;
    });
    const keys: string[] = [];
    for (const cols of entries) for (const key of Object.keys(cols)) if (!keys.includes(key)) keys.push(key);
    for (const key of keys) put(out, `${name}.${key}`, entries.map((cols) => (key in cols ? cols[key] : null)));
  }
}

export function flattenRow(json: Record<string, unknown>): FlattenResult {
  const row: Record<string, unknown> = {};
  try {
    walk('', json, row);
  } catch (err) {
    if (err instanceof Clash) return { ok: false, reason: err.message, field: err.field };
    throw err;
  }
  return { ok: true, row };
}
