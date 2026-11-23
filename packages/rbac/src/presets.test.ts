import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLES } from './presets';
import { CAPABILITY_KEYS } from './catalog';

describe('system role presets', () => {
  it('defines the six system roles by slug', () => {
    expect(SYSTEM_ROLES.map((r) => r.slug).sort()).toEqual(
      ['data_analyst', 'lab_admin', 'lab_manager', 'lab_technician', 'reception', 'system_auditor'],
    );
  });

  it('administrator (lab_admin) holds every capability and is locked', () => {
    const admin = SYSTEM_ROLES.find((r) => r.slug === 'lab_admin')!;
    expect(admin.locked).toBe(true);
    expect(admin.capabilities.sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  it('technician enters data and results at the bench', () => {
    const tech = SYSTEM_ROLES.find((r) => r.slug === 'lab_technician')!;
    expect(tech.capabilities).toEqual(['forms.view', 'forms.submit', 'lab.reject', 'lab.results.enter', 'lab.worklist.view']);
    // The role holds lab.reject, so its description says it can reject.
    expect(tech.description).toMatch(/reject a sample or test/);
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
    for (const key of ['ingest.run', 'data.export', 'imports.correct_held']) {
      expect(role('lab_admin')).toContain(key);
      expect(SYSTEM_ROLES.filter((r) => r.capabilities.includes(key)).map((r) => r.slug)).toEqual(['lab_admin']);
    }
    expect(role('lab_manager')).toEqual([
      'dashboards.view', 'dashboards.create', 'dashboards.edit', 'dashboards.delete',
      'reports.view', 'reports.run', 'reports.export', 'reports.edit_templates',
      'forms.view', 'forms.submit', 'forms.edit', 'forms.publish', 'forms.void_entries',
      'workflows.view', 'workflows.edit', 'workflows.run', 'workflows.manage_secrets',
      'query.run', 'query.manage',
      'terminology.view', 'terminology.manage',
      'facilities.view', 'facilities.manage',
      'patients.view', 'patients.view_identifiers', 'patients.manage',
      'activity.view', 'notifications.view',
      'lab.receive', 'lab.reject', 'lab.results.enter', 'lab.results.authorise', 'lab.results.amend',
      'lab.worklist.view', 'lab.settings',
    ]);
    expect(role('data_analyst')).toEqual([
      'dashboards.view', 'reports.view', 'reports.run', 'reports.export', 'forms.view', 'query.run', 'query.manage',
      'terminology.view', 'facilities.view', 'patients.view', 'activity.view', 'notifications.view',
    ]);
    expect(role('system_auditor')).toEqual([
      'dashboards.view', 'reports.view', 'forms.view', 'terminology.view', 'facilities.view', 'patients.view',
      'activity.view', 'notifications.view', 'audit.view',
    ]);
    expect(role('lab_technician')).toEqual(['forms.view', 'forms.submit', 'lab.reject', 'lab.results.enter', 'lab.worklist.view']);
  });

  // Marking a form entry as entered in error withdraws a saved record, so only the roles that
  // manage content hold it. Bench and read-only roles do not.
  it('grants forms.void_entries to lab_admin and lab_manager only', () => {
    const holders = SYSTEM_ROLES.filter((r) => r.capabilities.includes('forms.void_entries')).map((r) => r.slug).sort();
    expect(holders).toEqual(['lab_admin', 'lab_manager']);
  });

  // The lab module (design 2026-11-22-lab-module). Reception registers and receives samples and
  // finds the patient; the technician enters results; the manager holds every lab key.
  it('reception receives, returns and rejects, and sees worklists and the masked patient index', () => {
    const reception = SYSTEM_ROLES.find((r) => r.slug === 'reception')!;
    expect(reception).toMatchObject({ name: 'Reception', locked: false });
    expect(reception.capabilities).toEqual(['lab.receive', 'lab.reject', 'lab.worklist.view', 'patients.view']);
  });

  it('grants each lab key to the roles the lab module names', () => {
    const holders = (key: string) => SYSTEM_ROLES.filter((r) => r.capabilities.includes(key)).map((r) => r.slug).sort();
    expect(holders('lab.receive')).toEqual(['lab_admin', 'lab_manager', 'reception']);
    expect(holders('lab.reject')).toEqual(['lab_admin', 'lab_manager', 'lab_technician', 'reception']);
    expect(holders('lab.results.enter')).toEqual(['lab_admin', 'lab_manager', 'lab_technician']);
    expect(holders('lab.results.authorise')).toEqual(['lab_admin', 'lab_manager']);
    expect(holders('lab.results.amend')).toEqual(['lab_admin', 'lab_manager']);
    expect(holders('lab.worklist.view')).toEqual(['lab_admin', 'lab_manager', 'lab_technician', 'reception']);
    expect(holders('lab.settings')).toEqual(['lab_admin', 'lab_manager']);
  });

  it('every preset capability is a real catalog key', () => {
    const keys = new Set(CAPABILITY_KEYS);
    for (const r of SYSTEM_ROLES) for (const c of r.capabilities) expect(keys.has(c)).toBe(true);
  });
});
