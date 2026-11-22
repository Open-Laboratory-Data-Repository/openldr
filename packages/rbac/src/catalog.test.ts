import { describe, it, expect } from 'vitest';
import { CAPABILITIES, CAPABILITY_KEYS, CAPABILITY_GROUPS } from './catalog';
import { SYSTEM_ROLES } from './presets';
import { LIMITED_SCOPE_DROPS } from './data-scope';

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
  // 48 -> 55: the seven lab.* keys of the lab module (design 2026-11-22-lab-module).
  it('exposes 55 unique capability keys', () => {
    expect(CAPABILITY_KEYS.length).toBe(55);
    expect(new Set(CAPABILITY_KEYS).size).toBe(55);
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
});

describe('lab capabilities', () => {
  const LAB = [
    { key: 'lab.receive', label: 'Receive samples', description: 'Find and register requests, receive samples, correct a typo in a request, and link its patient.' },
    { key: 'lab.reject', label: 'Return and reject', description: 'Return a request to its site for correction, or reject a sample and ask for a redraw.' },
    { key: 'lab.results.enter', label: 'Enter results', description: 'Enter and change results that are not yet authorised.' },
    { key: 'lab.results.authorise', label: 'Authorise results', description: 'Authorise results entered by someone else.' },
    { key: 'lab.results.amend', label: 'Amend results', description: 'Correct a released result, with a reason.' },
    { key: 'lab.worklist.view', label: 'View worklists', description: "See the lab's worklists." },
    { key: 'lab.settings', label: 'Lab settings', description: "Set the lab's sections, which tests need review, and self-authorisation." },
  ];

  it('has the seven lab keys, in order, in the lab group', () => {
    expect(CAPABILITY_GROUPS.find((g) => g.key === 'lab')).toEqual({
      key: 'lab',
      label: 'Lab',
      capabilities: LAB.map((c) => ({ ...c, group: 'lab' })),
    });
  });

  it('keeps every lab key for a user with a data limit', () => {
    for (const c of LAB) expect(LIMITED_SCOPE_DROPS).not.toContain(c.key);
  });
});
