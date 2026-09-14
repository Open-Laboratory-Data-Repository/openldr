import type { FormField } from '@openldr/forms/pure';

/**
 * How the field list is drawn, without changing how it is stored.
 *
 * CE stores a repeating FHIR element as loose sibling fields that share a `fhirPath` and are
 * told apart by `fhirDiscriminator`. The list therefore says "two fields" where FHIR says "one
 * list, two slots". This draws the list. Nothing here writes, and `fields` keeps its flat shape.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/fieldTree.ts`.
 */

export interface FieldNode {
  kind: 'field';
  field: FormField;
}

export interface RepeatNode {
  kind: 'repeat';
  /** The list path, for example `Location.identifier`. Also the node's identity. */
  path: string;
  /** Last segment of the path. Derived, because nothing stores a list label. */
  label: string;
  slots: FormField[];
}

export type TreeNode = FieldNode | RepeatNode;

/**
 * The list a discriminated field is a slot of, or null when it is not one.
 *
 * Both a discriminator and a value field are required, matching corlix: its renderer takes the
 * list branch only when both are set, so a field missing either is not a slot.
 */
export function arrayPathOf(field: FormField): string | null {
  if (!field.fhirDiscriminator || !field.fhirValueField || !field.fhirPath) return null;
  const suffix = `.${field.fhirValueField}`;
  if (!field.fhirPath.endsWith(suffix)) return null;
  return field.fhirPath.slice(0, -suffix.length);
}

/**
 * Group slots of one list under a repeat node, leaving everything else alone.
 *
 * A repeat takes the position of its first slot, so the list does not reorder under the reader.
 * Group children are skipped: `groupId` already nests them, and hoisting one into a repeat would
 * nest it twice.
 */
export function buildFieldTree(fields: FormField[]): TreeNode[] {
  const ordered = [...fields].sort((a, b) => a.order - b.order);
  const nodes: TreeNode[] = [];
  const repeats = new Map<string, RepeatNode>();

  for (const field of ordered) {
    const path = field.groupId ? null : arrayPathOf(field);
    if (!path) {
      nodes.push({ kind: 'field', field });
      continue;
    }
    const existing = repeats.get(path);
    if (existing) {
      existing.slots.push(field);
      continue;
    }
    const node: RepeatNode = { kind: 'repeat', path, label: path.split('.').pop() ?? path, slots: [field] };
    repeats.set(path, node);
    nodes.push(node);
  }

  return nodes;
}
