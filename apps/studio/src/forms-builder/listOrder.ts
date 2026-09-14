import type { FormField, FormSection } from '@openldr/forms/pure';
import { buildFieldTree } from './fieldTree';

/**
 * How the field list lays out its rows, in one place. The list draws from it, and the page walks
 * `drawnOrder` for Shift-click ranges and for `j` and `k`, so a key moves through the rows on screen.
 * Moved out of `FieldListPane.tsx` unchanged, apart from the search arriving as an argument.
 */

export interface SectionBucket {
  /** Null is the "No section" bucket. */
  sectionId: string | null;
  label: string;
  /** The bucket's top-level rows. Group children hang off their group instead. */
  fields: FormField[];
}

export interface FieldListModel {
  /** Every field the search keeps, sorted by order, group children included. */
  visible: FormField[];
  /** The visible children of each group, in order. */
  childrenByGroup: Map<string, FormField[]>;
  /** False when the list draws without headers. There is then one bucket, holding every top-level row. */
  showSectionHeaders: boolean;
  buckets: SectionBucket[];
}

/** Whether a field matches the list search: its label or FHIR path contains the query. */
export function matchesFieldSearch(field: FormField, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return field.displayLabel.toLowerCase().includes(q) || (field.fhirPath?.toLowerCase().includes(q) ?? false);
}

export function buildFieldListModel(
  fields: readonly FormField[],
  sections: readonly FormSection[],
  query: string,
): FieldListModel {
  const visible = fields.filter((f) => matchesFieldSearch(f, query)).sort((a, b) => a.order - b.order);
  const topLevel = visible.filter((f) => !f.groupId);

  const childrenByGroup = new Map<string, FormField[]>();
  for (const f of visible) {
    if (!f.groupId) continue;
    const list = childrenByGroup.get(f.groupId) ?? [];
    list.push(f);
    childrenByGroup.set(f.groupId, list);
  }

  // Headers show when the form defines sections, or when its fields use more than one section id.
  const distinct = new Set(fields.flatMap((f) => (f.section ? [f.section] : [])));
  const showSectionHeaders = sections.length > 0 || distinct.size > 1;
  if (!showSectionHeaders) {
    return { visible, childrenByGroup, showSectionHeaders, buckets: [{ sectionId: null, label: '', fields: topLevel }] };
  }

  const labels = new Map(sections.map((s) => [s.id, s.label]));
  const orderedIds: Array<string | null> = [...sections].sort((a, b) => a.order - b.order).map((s) => s.id);
  for (const f of topLevel) {
    if (f.section && !orderedIds.includes(f.section)) orderedIds.push(f.section);
  }
  if (topLevel.some((f) => !f.section)) orderedIds.push(null);

  const buckets: SectionBucket[] = [];
  for (const sectionId of orderedIds) {
    const bucketFields = topLevel.filter((f) => (sectionId === null ? !f.section : f.section === sectionId));
    if (bucketFields.length === 0) continue;
    const label = sectionId === null ? 'No section' : (labels.get(sectionId) ?? sectionId);
    buckets.push({ sectionId, label, fields: bucketFields });
  }
  return { visible, childrenByGroup, showSectionHeaders, buckets };
}

/** Row ids in the order the list draws them, top to bottom. */
export function drawnOrder(model: FieldListModel): string[] {
  const out: string[] = [];
  const walk = (field: FormField) => {
    out.push(field.id);
    if (field.fieldType !== 'group') return;
    for (const child of model.childrenByGroup.get(field.id) ?? []) walk(child);
  };
  for (const bucket of model.buckets) {
    for (const node of buildFieldTree(bucket.fields)) {
      if (node.kind === 'field') walk(node.field);
      else node.slots.forEach(walk);
    }
  }
  return out;
}
