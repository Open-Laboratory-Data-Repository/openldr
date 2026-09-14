import type { FieldType } from '@openldr/forms/pure';

/**
 * A FHIR leaf type as a builder field type. Ported from corlix `lib/fhirTypeMap.ts`.
 *
 * CE's path table keeps the TypeScript type from `@types/fhir`, so every string-like primitive
 * (date, dateTime, uri, id and the rest) arrives as `string` and becomes text. Corlix reads the
 * FHIR primitive name and makes dates date fields; CE cannot until the generator keeps that name.
 */
const TYPE_MAP: Record<string, FieldType> = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
  code: 'select',
  CodeableConcept: 'select',
  Coding: 'select',
  Reference: 'reference',
  Identifier: 'identifier',
  Address: 'address',
  ContactPoint: 'phone',
  Attachment: 'attachment',
};

/**
 * A BackboneElement holds named sub-fields, so a group is the only type that fits. `@types/fhir`
 * names one after its resource (`LocationHoursOfOperation`, `PatientContact`), which is how it is
 * told apart from a shared datatype such as `HumanName`.
 */
export function fieldTypeForLeaf(leafType: string, resourceType: string): FieldType {
  const mapped = TYPE_MAP[leafType];
  if (mapped) return mapped;
  if (leafType.startsWith(resourceType) && leafType.length > resourceType.length) return 'group';
  return 'text';
}

/** A short name for an element: its last path segment with camelCase split into words. */
export function elementDisplayName(path: string): string {
  const segment = path.split('.').pop() ?? path;
  const words = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A coded element's label in `@types/fhir` is its enum, `active | suspended | inactive`. Read it as
 * options, as corlix reads the schema's enum values. Null when the label is ordinary prose.
 */
export function codeOptionsFromLabel(label: string): { code: string; display: string }[] | null {
  if (!/^[\w-]+( \| [\w-]+)+$/.test(label.trim())) return null;
  return label.split('|').map((part) => part.trim()).map((code) => ({ code, display: code }));
}
