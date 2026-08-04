import { describe, it, expect } from 'vitest';
import { CAPABILITIES, CAPABILITY_KEYS, CAPABILITY_GROUPS } from './catalog';
import { SYSTEM_ROLES } from './presets';

describe('capability catalog', () => {
  it('includes the data_exposure.manage capability', () => {
    expect(CAPABILITY_KEYS).toContain('data_exposure.manage');
  });

  // 37 -> 38: forms.submit was split out of forms.view when form submission stopped being a
  // read-only echo and started writing clinical records.
  // 38 -> 40: facilities.view and facilities.manage were added for the Facilities workspace.
  it('exposes 40 unique capability keys', () => {
    expect(CAPABILITY_KEYS.length).toBe(40);
    expect(new Set(CAPABILITY_KEYS).size).toBe(40);
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
