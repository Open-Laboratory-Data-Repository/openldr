import type { SavedMapping } from './apply';
import { shapeOf, type Shape } from './shape';

/**
 * What kind of item this is: FHIR already, a match for one of CE's forms, a row a saved mapping
 * knows, or a new shape a person has to map. Checked in that order. Never throws.
 *
 * A saved mapping knows a row when every key of the row is one of the mapping's `fieldNames`. A
 * file reader drops blank cells and reads number-like cells as numbers, so rows of one file differ
 * in keys and types; a missing column is empty to `applyMapping`, which fails a required one by
 * name. Types and `shapeHash` play no part (the hash names the sample the mapping was made from).
 * A row with a key the mapping never saw is a new shape. A row with no keys matches nothing.
 */

export interface ClassifyForm {
  id: string;
  fieldIds: string[];
  requiredIds: string[];
}

export type Classification =
  | { kind: 'fhir' }
  | { kind: 'form'; formId: string }
  | { kind: 'mapped'; mapping: SavedMapping }
  | { kind: 'unknown'; shape: Shape };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isResource(v: unknown): boolean {
  return isPlainObject(v) && typeof v.resourceType === 'string';
}

export function classify(json: unknown, forms: ClassifyForm[], mappings: SavedMapping[]): Classification {
  if (isResource(json)) return { kind: 'fhir' };
  if (Array.isArray(json) && json.length > 0 && json.every(isResource)) return { kind: 'fhir' };
  if (!isPlainObject(json)) return { kind: 'unknown', shape: shapeOf({}) };

  const shape = shapeOf(json);
  const keys = shape.fields.map((f) => f.name);

  if (keys.length > 0) {
    const form = forms.find((f) => keys.every((k) => f.fieldIds.includes(k)) && f.requiredIds.every((id) => keys.includes(id)));
    if (form) return { kind: 'form', formId: form.id };
  }

  // The tightest fit wins: the fewest field names, and the first in the list on a tie.
  let mapping: SavedMapping | null = null;
  if (keys.length > 0) {
    for (const m of mappings) {
      if (!keys.every((k) => m.fieldNames.includes(k))) continue;
      if (!mapping || m.fieldNames.length < mapping.fieldNames.length) mapping = m;
    }
  }
  if (mapping) return { kind: 'mapped', mapping };

  return { kind: 'unknown', shape };
}
