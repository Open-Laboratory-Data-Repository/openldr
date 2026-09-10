// Pure rules behind the widget editor's Variables sheet. They live here, not in the component,
// because Radix Select cannot be driven in jsdom (see BuilderForm.test.tsx), so the picker's
// option list can only be proven as a function.
import type { DashboardFilterDef, WidgetVariableDef } from '../../api';

type VarType = WidgetVariableDef['type'];

/** Every `{{name}}` in `s`, once each, in first-seen order. */
export function extractVariables(s: string): string[] {
  const m = s.match(/\{\{(\w+)\}\}/g);
  return m ? [...new Set(m.map((x) => x.slice(2, -2)))] : [];
}

/** Collapse `_from`/`_to` of a date-range variable into its logical parent, so the Variables
 *  sheet lists one entry for a range rather than two halves. A `_from` whose parent is not a
 *  declared date-range is left alone: it is just a variable that happens to end in `_from`. */
export function extractLogicalVariables(s: string, defs: Record<string, WidgetVariableDef>): string[] {
  const logical = new Set<string>();
  for (const v of extractVariables(s)) {
    if (v.endsWith('_from') || v.endsWith('_to')) {
      const base = v.replace(/_(from|to)$/, '');
      if (defs[base]?.type === 'date-range') {
        logical.add(base);
        continue;
      }
    }
    logical.add(v);
  }
  return [...logical];
}

/** Dashboard filters a variable of `varType` may bind to: same type only.
 *
 *  `boundId` is kept whatever its type. A saved binding that no longer matches has to stay in
 *  the list, because dropping it would render a blank picker and hide the mismatch instead of
 *  showing it. The caller marks it; this function never unbinds anything. */
export function compatibleFilters(
  varType: VarType,
  filters: DashboardFilterDef[],
  boundId: string | undefined,
): DashboardFilterDef[] {
  return filters.filter((f) => f.type === varType || f.id === boundId);
}

/** True when a date-range variable's SQL writes the bare `{{name}}`.
 *
 *  `resolveValues` only ever produces `name_from` and `name_to` for a range, so the bare token
 *  resolves to NULL every time: the clause is dropped inside `[[ ]]`, or compares against NULL
 *  without it. A one-sided range (`{{name_from}}` alone) is a real authoring choice and is not
 *  flagged. */
export function hasBareDateRangeToken(sql: string, name: string, type: VarType): boolean {
  return type === 'date-range' && extractVariables(sql).includes(name);
}
