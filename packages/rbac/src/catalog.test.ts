import { describe, it, expect } from 'vitest';
import { CAPABILITIES, CAPABILITY_KEYS, CAPABILITY_GROUPS, permissionGroup, reservedPermissionGroups } from './catalog';
import { SYSTEM_ROLES } from './presets';

describe('capability catalog', () => {
  it('includes the data_exposure.manage capability', () => {
    expect(CAPABILITY_KEYS).toContain('data_exposure.manage');
  });

  // 37 -> 38: forms.submit was split out of forms.view when form submission stopped being a
  // read-only echo and started writing clinical records.
  // 38 -> 40: facilities.view and facilities.manage were added for the Facilities workspace.
  // 40 -> 43: patients.view, patients.view_identifiers and patients.manage for the Patient Index.
  // 43 -> 45: ingest.run and data.export, for CLI commands that no Studio screen covers.
  // 45 -> 46: imports.correct_held, for correcting held requests (design 2026-11-18-held-corrections).
  // 46 -> 47: query.manage, for changing saved queries (design 2026-11-19-manage-saved-queries).
  // 47 -> 48: forms.void_entries, for marking a form entry as entered in error (plan 2026-11-22-form-entries).
  // 48 -> 49: patients.find, a strong-match lookup a limited user keeps (plan 2026-11-23-plugin-host-2b, ruling 5).
  // 49 -> 50: reports.view_issued, for reading individual signed results.
  it('exposes 50 unique capability keys', () => {
    expect(CAPABILITY_KEYS.length).toBe(50);
    expect(new Set(CAPABILITY_KEYS).size).toBe(50);
  });

  it('has forms.void_entries in the forms group', () => {
    expect(CAPABILITIES.find((c) => c.key === 'forms.void_entries')).toEqual({
      key: 'forms.void_entries',
      group: 'forms',
      label: 'Mark entries as entered in error',
      description: 'Withdraw a saved form entry. The entry stays on record, marked as entered in error.',
    });
  });

  it('has imports.correct_held in its own group', () => {
    const find = (k: string) => CAPABILITIES.find((c) => c.key === k);
    expect(find('imports.correct_held')).toMatchObject({ group: 'imports', label: 'Correct held requests' });
    expect(CAPABILITY_GROUPS.find((g) => g.key === 'imports')?.label).toBe('Imports');
  });

  it('separates submitting a form from viewing one', () => {
    expect(CAPABILITY_KEYS).toContain('forms.submit');
    expect(CAPABILITY_KEYS).toContain('forms.view');
  });

  it('every capability belongs to a declared group', () => {
    const groupKeys = new Set(CAPABILITY_GROUPS.map((g) => g.key));
    for (const c of CAPABILITIES) expect(groupKeys.has(c.group)).toBe(true);
  });

  it('every capability has a non-empty label and description', () => {
    for (const c of CAPABILITIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it('groups partition the catalog with no orphan or duplicate', () => {
    const flat = CAPABILITY_GROUPS.flatMap((g) => g.capabilities.map((c) => c.key));
    expect(flat.sort()).toEqual([...CAPABILITY_KEYS].sort());
  });
});

describe('keys for CLI commands no Studio screen covers', () => {
  it('has ingest.run and data.export, each in its own group', () => {
    const find = (key: string) => CAPABILITIES.find((c) => c.key === key);
    expect(find('ingest.run')?.group).toBe('ingest');
    expect(find('data.export')?.group).toBe('data');
    expect(CAPABILITY_GROUPS.find((g) => g.key === 'ingest')?.label).toBe('Ingest');
    expect(CAPABILITY_GROUPS.find((g) => g.key === 'data')?.label).toBe('Data');
  });
});

describe('facilities capabilities', () => {
  it('exposes view and manage', () => {
    expect(CAPABILITY_KEYS).toContain('facilities.view');
    expect(CAPABILITY_KEYS).toContain('facilities.manage');
  });

  it('mirrors terminology: manager manages, analyst and auditor only view', () => {
    // Facilities are reference data, exactly like terminology — same shape, same audience.
    const role = (slug: string) => SYSTEM_ROLES.find((r) => r.slug === slug)!;
    expect(role('lab_manager').capabilities).toEqual(expect.arrayContaining(['facilities.view', 'facilities.manage']));
    expect(role('data_analyst').capabilities).toContain('facilities.view');
    expect(role('data_analyst').capabilities).not.toContain('facilities.manage');
    expect(role('system_auditor').capabilities).toContain('facilities.view');
    expect(role('system_auditor').capabilities).not.toContain('facilities.manage');
    // A bench technician fills forms; they do not curate the facility register.
    expect(role('lab_technician').capabilities).not.toContain('facilities.view');
  });
});

describe('patients capabilities', () => {
  const role = (slug: string) => SYSTEM_ROLES.find((r) => r.slug === slug)!;

  it('exposes view, view_identifiers and manage', () => {
    expect(CAPABILITY_KEYS).toEqual(expect.arrayContaining(['patients.view', 'patients.view_identifiers', 'patients.manage']));
  });

  it('gives the manager all three, analyst and auditor only the masked view, the technician none', () => {
    expect(role('lab_manager').capabilities).toEqual(expect.arrayContaining(['patients.view', 'patients.view_identifiers', 'patients.manage']));
    for (const slug of ['data_analyst', 'system_auditor']) {
      expect(role(slug).capabilities).toContain('patients.view');
      expect(role(slug).capabilities).not.toContain('patients.view_identifiers');
      expect(role(slug).capabilities).not.toContain('patients.manage');
    }
    expect(role('lab_technician').capabilities.some((c) => c.startsWith('patients.'))).toBe(false);
  });

  it('has patients.find in the patients group, held by the Administrator and no other preset', () => {
    expect(CAPABILITIES.find((c) => c.key === 'patients.find')).toEqual({
      key: 'patients.find',
      group: 'patients',
      label: 'Find a patient',
      description: 'Find a patient by an exact identifier, or by name with full birth date, at your own facilities.',
    });
    for (const r of SYSTEM_ROLES) {
      expect(r.capabilities.includes('patients.find'), r.slug).toBe(r.slug === 'lab_admin');
    }
  });
});

describe('reserved permission groups', () => {
  it('keeps the first segment of every CE capability and every group name, and not lab', () => {
    const reserved = reservedPermissionGroups();
    for (const k of CAPABILITY_KEYS) expect(reserved.has(permissionGroup(k)), k).toBe(true);
    for (const g of CAPABILITY_GROUPS) expect(reserved.has(g.key), g.key).toBe(true);
    expect(reserved.has('lab')).toBe(false);
    expect(permissionGroup('lab.orders.receive')).toBe('lab');
  });
});

describe('the lab group stays free for the lab plugin', () => {
  // The lab plugin claims the group `lab` (plan 2026-11-23-plugin-host-2b, ruling 1). If CE ever
  // takes it, the plugin can no longer install, and the kept lab.* grants from step 1 are lost.
  it('no CE capability key and no capability group name starts with the segment lab', () => {
    expect(CAPABILITY_KEYS.filter((k) => permissionGroup(k) === 'lab')).toEqual([]);
    expect(CAPABILITY_GROUPS.map((g) => g.key).filter((g) => permissionGroup(g) === 'lab')).toEqual([]);
    expect(reservedPermissionGroups().has('lab')).toBe(false);
  });
});
