import { normalizeDiscriminator, toStoredDiscriminator, type FormField } from '@openldr/forms/pure';
import type { RepeatNode } from './fieldTree';

/**
 * Builders for a field made from the structure it belongs to. Pure. Ported from corlix
 * `apps/desktop/src/renderer/lib/newFormFields.ts`.
 */

/**
 * Another slot of one repeating list, shaped like the slot above it: same path, value field, type
 * and discriminator elements, with the values blank. The API property, codes, ValueSet binding and
 * translations belong to the slot already written, so they stay behind. Two blank slots correctly
 * trip the duplicate-path lint: with the same blank values they really are the same slot.
 */
export function buildNamedSlot(node: RepeatNode, id: string, label: string): FormField {
  const template = node.slots[node.slots.length - 1];
  const rule = normalizeDiscriminator(template.fhirDiscriminator);
  const seen = new Set<string>();
  const conds = (rule?.conds ?? [])
    .filter((c) => (seen.has(c.el) ? false : (seen.add(c.el), true)))
    .map((c) => ({ el: c.el, op: 'equals' as const, val: '' }));
  return {
    id,
    displayLabel: label,
    description: null,
    fieldType: template.fieldType,
    required: false,
    enabled: true,
    order: template.order,
    cardinality: { min: 0, max: '1' },
    section: template.section,
    fhirPath: template.fhirPath,
    fhirValueField: template.fhirValueField,
    fhirDiscriminator: toStoredDiscriminator({
      join: rule?.join ?? 'all',
      // An empty template seeds one blank row, as the editor's own "+ Add condition" does.
      conds: conds.length > 0 ? conds : [{ el: '', op: 'equals', val: '' }],
    }),
  };
}

/**
 * A new part of a group. The FHIR path is left empty on purpose: guessing a child element name
 * would ship a mapping that looks valid and points at nothing. No section: a part sits wherever
 * its group sits.
 */
export function buildGroupPart(group: FormField, id: string, label: string): FormField {
  return {
    id,
    displayLabel: label,
    description: null,
    fieldType: 'text',
    required: false,
    enabled: true,
    order: group.order,
    cardinality: { min: 0, max: '1' },
    groupId: group.id,
    fhirPath: null,
  };
}

/** Insert `field` after `anchorId` in form order, then renumber `order` from 0. */
export function insertFieldAfter(fields: readonly FormField[], anchorId: string, field: FormField): FormField[] {
  const ordered = [...fields].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex((f) => f.id === anchorId);
  const inserted = at === -1 ? [...ordered, field] : [...ordered.slice(0, at + 1), field, ...ordered.slice(at + 1)];
  return inserted.map((f, index) => ({ ...f, order: index }));
}

/** The id a new part goes after: the group's last child, or the group itself while it has none. */
export function lastPartIdOf(fields: readonly FormField[], groupId: string): string {
  const parts = fields.filter((f) => f.groupId === groupId).sort((a, b) => a.order - b.order);
  return parts.length > 0 ? parts[parts.length - 1].id : groupId;
}
