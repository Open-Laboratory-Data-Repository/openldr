import type { CatalogTestResultParam, LoincFieldPlan } from '@/api';

// The pure rules for LOINC's result fields on the unsaved test (plan calls 2 to 4). A pick or a panel
// fill puts params on the draft and keeps a record of them, so another pick can take back what it added
// and nothing the operator ticked by hand.

/** What a LOINC pick or a panel fill put on the draft, so another pick can take it back. */
export interface LoincAdded {
  loinc: string;
  /** Every param code it put on the draft, new fields and dictionary fields alike. */
  params: string[];
  /** The plans among them with `exists: false`, which Save makes first. */
  newFields: LoincFieldPlan[];
}

/** Put the plans' params on the draft. Add skips a code already there and keeps that param as it is (its
 *  type, value set and ranges). Replace drops every param first. `added` lists the codes put on the draft.
 *  `systemOf` gives a code's result dictionary system, which a plan does not carry. */
export function addFromLoinc(
  params: CatalogTestResultParam[],
  plans: LoincFieldPlan[],
  mode: 'add' | 'replace',
  systemOf: (code: string) => string = () => '',
): { params: CatalogTestResultParam[]; added: string[] } {
  const next = mode === 'replace' ? [] : [...params];
  const added: string[] = [];
  for (const plan of plans) {
    if (next.some((p) => p.code === plan.code)) continue;
    next.push({ system: systemOf(plan.code), code: plan.code, resultType: plan.resultType, valueSetUrl: plan.valueSetUrl, bands: [] });
    added.push(plan.code);
  }
  return { params: next, added };
}

/** Take off the draft the params a record lists. A param ticked by hand is not in the record, so it stays. */
export function dropLoincAdded(params: CatalogTestResultParam[], added: LoincAdded | null): CatalogTestResultParam[] {
  if (!added || added.params.length === 0) return params;
  return params.filter((p) => !added.params.includes(p.code));
}
