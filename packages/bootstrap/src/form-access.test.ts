import { describe, it, expect } from 'vitest';
import type { FormAccess, FormAccessStore } from '@openldr/db';
import { drivesAppPage, formAccess, FormAccessError, formOpenRule, formUserOf, setFormAccess } from './form-access';

// Design 2026-11-18-roles-scope, part 1: the one check the form routes, the CLI and the list use.
function memStore(lists: Record<string, FormAccess>): FormAccessStore {
  return {
    async get(id) { return lists[id] ?? { open: [], submit: [] }; },
    async set(id, a) { const before = lists[id] ?? { open: [], submit: [] }; lists[id] = a; return { before, after: a }; },
    async forForms(ids) { return new Map(ids.filter((id) => lists[id]).map((id) => [id, lists[id]!])); },
    async removeRole() {},
  };
}
const clerk = { roleIds: ['r-clerk'], capabilities: ['forms.view', 'forms.submit'] };
const twoRoles = { roleIds: ['r-other', 'r-clerk'], capabilities: ['forms.view', 'forms.submit'] };
const viewer = { roleIds: ['r-viewer'], capabilities: ['forms.view'] };
const admin = { roleIds: ['r-admin'], capabilities: ['forms.view', 'roles.manage'] };

describe('formAccess', () => {
  const access = formAccess({ access: memStore({
    open: { open: [], submit: [] },
    tracking: { open: ['r-clerk'], submit: [] },
    locked: { open: ['r-clerk'], submit: ['r-nobody'] },
  }) });

  it('keeps today\'s rule for a form with empty lists: the capability alone', async () => {
    expect(await access.mayOpen(viewer, 'open')).toBe(true);
    expect(await access.maySubmit(viewer, 'open')).toBe(false);
    expect(await access.maySubmit(clerk, 'open')).toBe(true);
  });

  it('narrows to the listed roles, and any one of a person\'s roles is enough', async () => {
    expect(await access.mayOpen(viewer, 'tracking')).toBe(false);
    expect(await access.mayOpen(clerk, 'tracking')).toBe(true);
    expect(await access.mayOpen(twoRoles, 'tracking')).toBe(true);
  });

  it('an open list with no submit list lets every submitter among the listed roles submit', async () => {
    expect(await access.maySubmit(clerk, 'tracking')).toBe(true);
    expect(await access.maySubmit(clerk, 'locked')).toBe(false);
  });

  it('a submitter must also be allowed to open the form', async () => {
    const other = { roleIds: ['r-nobody'], capabilities: ['forms.view', 'forms.submit'] };
    expect(await access.maySubmit(other, 'locked')).toBe(false);
  });

  it('an admin passes everything', async () => {
    expect(await access.mayOpen(admin, 'locked')).toBe(true);
    expect(await access.maySubmit({ ...admin, capabilities: [...admin.capabilities, 'forms.submit'] }, 'locked')).toBe(true);
  });

  it('says which of many forms a person may open', async () => {
    expect([...(await access.visible(viewer, ['open', 'tracking', 'locked']))]).toEqual(['open']);
    expect([...(await access.visible(clerk, ['open', 'tracking', 'locked']))].sort()).toEqual(['locked', 'open', 'tracking']);
  });
});

// The form routes, the entries routes and the CLI open forms by one rule (design 2026-11-22-form-entries).
describe('formOpenRule', () => {
  const rule = formOpenRule(formAccess({ access: memStore({ tracking: { open: ['r-clerk'], submit: [] } }) }));
  const editor = { roleIds: [], capabilities: ['forms.view', 'forms.edit'] };

  it('an editor opens every form, anyone else only the forms their roles may open', async () => {
    expect(await rule.mayOpen(editor, 'tracking')).toBe(true);
    expect(await rule.mayOpen(viewer, 'tracking')).toBe(false);
    expect(await rule.mayOpen(clerk, 'tracking')).toBe(true);
    expect([...(await rule.openable(editor, ['open', 'tracking']))]).toEqual(['open', 'tracking']);
    expect([...(await rule.openable(viewer, ['open', 'tracking']))]).toEqual(['open']);
  });
});

describe('drivesAppPage', () => {
  it('is true only for a form with target pages that leave out the Forms page', () => {
    expect(drivesAppPage(null)).toBe(false);
    expect(drivesAppPage([])).toBe(false);
    expect(drivesAppPage(['forms'])).toBe(false);
    expect(drivesAppPage(['users', 'forms'])).toBe(false);
    expect(drivesAppPage(['users'])).toBe(true);
  });
});

// The route and the CLI set the lists through one function, so they check the same things.
describe('setFormAccess', () => {
  const roles = [{ id: 'r-clerk', slug: 'clerk' }, { id: 'r-nurse', slug: 'nurse' }];
  const deps = (lists: Record<string, FormAccess> = {}) => ({
    access: memStore(lists),
    forms: { async get(id: string) { return id === 'f1' ? { id } : null; } },
    roles: { async list() { return roles; } },
  });

  it('saves the lists, taking a role by id or by slug, and returns them before and after', async () => {
    const lists: Record<string, FormAccess> = { f1: { open: ['r-nurse'], submit: [] } };
    const out = await setFormAccess(deps(lists), 'f1', { open: ['clerk', 'r-nurse'], submit: [] });
    expect(out.before).toEqual({ open: ['r-nurse'], submit: [] });
    expect(out.after).toEqual({ open: ['r-clerk', 'r-nurse'], submit: [] });
  });

  it('refuses a form that does not exist and a role that does not exist, saving nothing', async () => {
    const lists: Record<string, FormAccess> = { f1: { open: [], submit: [] } };
    await expect(setFormAccess(deps(lists), 'nope', { open: [], submit: [] })).rejects.toThrow(FormAccessError);
    await expect(setFormAccess(deps(lists), 'f1', { open: ['ghost'], submit: [] })).rejects.toThrow(/no role ghost/);
    expect(lists.f1).toEqual({ open: [], submit: [] });
  });

  it('keeps each role once in a list', async () => {
    const out = await setFormAccess(deps(), 'f1', { open: ['clerk', 'r-clerk'], submit: [] });
    expect(out.after.open).toEqual(['r-clerk']);
  });
});

// A served CLI command knows only the caller's id, so it looks their roles up as sign-in does
// (roles review FR4).
describe('formUserOf', () => {
  const deps = {
    users: { async get(id: string) { return id === 'u1' ? { id: 'u1', subject: 'kc-1' } : id === 'u2' ? { id: 'u2', subject: null } : null; } },
    roles: {
      async resolveCapabilities(subject: string) { return subject === 'kc-1' ? ['forms.view'] : ['forms.view', 'forms.edit']; },
      async rolesForUser(subject: string) { return subject === 'kc-1' ? [{ id: 'r-clerk' }] : [{ id: 'r-lead' }]; },
    },
  };

  it('finds role ids and capabilities by the subject, or the id when there is none', async () => {
    expect(await formUserOf(deps, 'u1')).toEqual({ roleIds: ['r-clerk'], capabilities: ['forms.view'] });
    expect(await formUserOf(deps, 'u2')).toEqual({ roleIds: ['r-lead'], capabilities: ['forms.view', 'forms.edit'] });
  });

  it('answers null for an unknown user', async () => {
    expect(await formUserOf(deps, 'nobody')).toBeNull();
  });
});
