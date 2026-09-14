import type { FormField } from '@openldr/forms/pure';

/**
 * What a bulk action does to the fields. Pure: each returns the new array, and the page makes each
 * call one undo step. Ported from corlix `pages/FormBuilderPage.tsx:620-648`.
 */

/** Each chosen field moves into one section, or out of every section when `sectionId` is undefined. */
export function moveFieldsToSection(
  fields: readonly FormField[],
  ids: ReadonlySet<string>,
  sectionId: string | undefined,
): FormField[] {
  return fields.map((f) => (ids.has(f.id) ? { ...f, section: sectionId } : f));
}

/**
 * Switch the chosen fields together, by corlix's majority rule: when at least half of the unlocked
 * ones are on, all of them go off, otherwise all go on. A locked field keeps its state.
 */
export function toggleFieldsEnabled(fields: readonly FormField[], ids: ReadonlySet<string>): FormField[] {
  const targets = fields.filter((f) => ids.has(f.id) && !f.locked);
  if (targets.length === 0) return [...fields];
  const onCount = targets.filter((f) => f.enabled).length;
  const next = onCount < targets.length / 2;
  const targetIds = new Set(targets.map((f) => f.id));
  return fields.map((f) => (targetIds.has(f.id) ? { ...f, enabled: next } : f));
}

/** Remove the chosen fields. A locked field stays, as it does for the single Delete. */
export function deleteFields(fields: readonly FormField[], ids: ReadonlySet<string>): FormField[] {
  return fields.filter((f) => !ids.has(f.id) || f.locked);
}
