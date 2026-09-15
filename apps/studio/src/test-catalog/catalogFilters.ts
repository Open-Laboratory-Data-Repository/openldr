import type { FilterRule } from '@/components/data-table';
import type { TestCatalogListParams } from '@/api';

export type CatalogFilterParams = Pick<TestCatalogListParams, 'category' | 'loinc' | 'enabled' | 'status'>;

/**
 * Turn the toolbar's filter rules into GET /api/test-catalog's named parameters, as Notifications.tsx
 * does for its API. Each filterable column offers only `eq`. A rule the API cannot express is dropped,
 * and a later rule on the same column wins.
 */
export function translateFilters(filters: FilterRule[]): CatalogFilterParams {
  const params: CatalogFilterParams = {};
  for (const f of filters) {
    if (f.operator !== 'eq' || typeof f.value !== 'string' || !f.value) continue;
    if (f.column === 'category') params.category = f.value;
    else if (f.column === 'loinc' && (f.value === 'linked' || f.value === 'none')) params.loinc = f.value;
    else if (f.column === 'enabled' && (f.value === 'on' || f.value === 'off')) params.enabled = f.value;
    else if (f.column === 'status' && (f.value === 'active' || f.value === 'retired')) params.status = f.value;
  }
  return params;
}
