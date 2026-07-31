import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLES } from './presets';
import { CAPABILITY_KEYS } from './catalog';

describe('system role presets', () => {
  it('defines the five system roles by slug', () => {
    expect(SYSTEM_ROLES.map((r) => r.slug).sort()).toEqual(
      ['data_analyst', 'lab_admin', 'lab_manager', 'lab_technician', 'system_auditor'],
    );
  });

  it('administrator (lab_admin) holds every capability and is locked', () => {
    const admin = SYSTEM_ROLES.find((r) => r.slug === 'lab_admin')!;
    expect(admin.locked).toBe(true);
    expect(admin.capabilities.sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  it('technician is data-entry-only', () => {
    const tech = SYSTEM_ROLES.find((r) => r.slug === 'lab_technician')!;
    expect(tech.capabilities).toEqual(['forms.view', 'forms.submit']);
  });

  // forms.submit WRITES clinical records (POST /api/forms/:id/responses runs the submission
  // through the ingest pipeline). It must reach the data-entry roles and no others — an auditor
  // described as "Read-only oversight" holding it is the defect the split fixes.
  it('grants forms.submit to the data-entry roles only', () => {
    const holders = SYSTEM_ROLES.filter((r) => r.capabilities.includes('forms.submit')).map((r) => r.slug).sort();
    expect(holders).toEqual(['lab_admin', 'lab_manager', 'lab_technician']);
  });

  it('read-only presets keep forms.view without forms.submit', () => {
    for (const slug of ['data_analyst', 'system_auditor']) {
      const role = SYSTEM_ROLES.find((r) => r.slug === slug)!;
      expect(role.capabilities).toContain('forms.view');
      expect(role.capabilities).not.toContain('forms.submit');
    }
  });

  it('only administrator is locked', () => {
    expect(SYSTEM_ROLES.filter((r) => r.locked).map((r) => r.slug)).toEqual(['lab_admin']);
  });

  it('every preset capability is a real catalog key', () => {
    const keys = new Set(CAPABILITY_KEYS);
    for (const r of SYSTEM_ROLES) for (const c of r.capabilities) expect(keys.has(c)).toBe(true);
  });
});
