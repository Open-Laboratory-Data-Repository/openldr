import { describe, it, expect } from 'vitest';
import type { FormAccess, FormAccessStore } from '@openldr/db';
import { formAccess, FormAccessError, setFormAccess } from './form-access';

// Design 2026-11-18-roles-scope, part 1: the one check the form routes, the CLI and the list use.
function memStore(lists: Record<string, FormAccess>): FormAccessStore {
  return {
    async get(id) { return lists[id] ?? { open: [], submit: [] }; },
    async set(id, a) { lists[id] = a; },
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
