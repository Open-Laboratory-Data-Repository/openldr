import { describe, it, expect } from 'vitest';
import { CAPABILITY_KEYS } from './catalog';
import { LIMITED_SCOPE_DROPS, capabilitiesUnderScope } from './data-scope';

// Design 2026-11-18-roles-scope, part 3: what a limited user loses, in one place.
describe('capabilities under a data limit', () => {
  it('names only capabilities the catalog has', () => {
    for (const c of LIMITED_SCOPE_DROPS) expect(CAPABILITY_KEYS).toContain(c);
  });

  it('drops exactly the planned list for a limited user', () => {
    expect([...LIMITED_SCOPE_DROPS].sort()).toEqual([
      'activity.view', 'audit.view', 'connectors.manage', 'dashboards.create', 'dashboards.edit', 'data.export',
      'facilities.view', 'imports.correct_held', 'patients.manage', 'patients.view', 'patients.view_identifiers',
      'query.manage', 'query.run', 'reports.edit_templates', 'reports.export', 'reports.run', 'reports.view',
      'sync.manage', 'sync.view', 'workflows.edit', 'workflows.run', 'workflows.view',
    ]);
  });

  it('keeps every capability for Everything, and the rest for Limited', () => {
    const all = [...CAPABILITY_KEYS];
    expect(capabilitiesUnderScope(all, { limited: false })).toEqual(all);
    const kept = capabilitiesUnderScope(all, { limited: true, facilities: [], districts: [], regions: [] });
    expect(kept).toContain('dashboards.view');
    expect(kept).toContain('forms.submit');
    expect(kept).toContain('roles.manage');
    expect(kept.length).toBe(all.length - LIMITED_SCOPE_DROPS.length);
  });
});
