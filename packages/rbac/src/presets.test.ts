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

  // Task 7 adds ingest.run and data.export. No Studio screen gives an unlocked preset the same power,
  // so lab_admin holds them and every other preset stays exactly as it was.
  it('lab_admin holds every new key and the other presets are unchanged unless listed', () => {
    const role = (slug: string) => SYSTEM_ROLES.find((r) => r.slug === slug)!.capabilities;
    for (const key of ['ingest.run', 'data.export']) {
      expect(role('lab_admin')).toContain(key);
      expect(SYSTEM_ROLES.filter((r) => r.capabilities.includes(key)).map((r) => r.slug)).toEqual(['lab_admin']);
    }
    expect(role('lab_manager')).toEqual([
      'dashboards.view', 'dashboards.create', 'dashboards.edit', 'dashboards.delete',
      'reports.view', 'reports.run', 'reports.export', 'reports.edit_templates',
      'forms.view', 'forms.submit', 'forms.edit', 'forms.publish',
      'workflows.view', 'workflows.edit', 'workflows.run', 'workflows.manage_secrets',
      'query.run',
      'terminology.view', 'terminology.manage',
      'facilities.view', 'facilities.manage',
      'patients.view', 'patients.view_identifiers', 'patients.manage',
      'activity.view', 'notifications.view',
    ]);
    expect(role('data_analyst')).toEqual([
      'dashboards.view', 'reports.view', 'reports.run', 'reports.export', 'forms.view', 'query.run',
      'terminology.view', 'facilities.view', 'patients.view', 'activity.view', 'notifications.view',
    ]);
    expect(role('system_auditor')).toEqual([
      'dashboards.view', 'reports.view', 'forms.view', 'terminology.view', 'facilities.view', 'patients.view',
      'activity.view', 'notifications.view', 'audit.view',
    ]);
    expect(role('lab_technician')).toEqual(['forms.view', 'forms.submit']);
  });

  it('every preset capability is a real catalog key', () => {
    const keys = new Set(CAPABILITY_KEYS);
    for (const r of SYSTEM_ROLES) for (const c of r.capabilities) expect(keys.has(c)).toBe(true);
  });
});
