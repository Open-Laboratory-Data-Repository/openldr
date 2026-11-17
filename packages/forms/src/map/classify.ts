import type { SavedMapping } from './apply';
import { shapeOf, type Shape } from './shape';

/**
 * What kind of item this is: FHIR already, a match for one of CE's forms, a shape a saved mapping
 * knows, or a new shape a person has to map. Never throws.
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

  const sortedKeys = JSON.stringify(keys); // shape fields are already sorted by name
  const mapping = mappings.find((m) => m.shapeHash === shape.hash && JSON.stringify([...m.fieldNames].sort()) === sortedKeys);
  if (mapping) return { kind: 'mapped', mapping };

  return { kind: 'unknown', shape };
}
