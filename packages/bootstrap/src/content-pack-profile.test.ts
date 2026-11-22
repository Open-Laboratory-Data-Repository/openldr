import { describe, it, expect, vi } from 'vitest';
import type { ContentPackStep } from '@openldr/marketplace';
import type { PackItem } from '@openldr/db';
import { checkProfileSteps, dropLeftOut, PackRemovalError, runProfileStep, type ProfileDeps } from './content-pack-profile';

const PACK = 'collection-site';

// The collection site steps from the Task 1 parse test.
const STEPS: ContentPackStep[] = [
  { kind: 'needs', bundles: [{ id: 'sample-tracking', version: '>=0.1.0' }] },
  { kind: 'role', slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view', 'forms.submit', 'patients.view'] },
  { kind: 'layout', key: 'collection-site', name: 'Collection site', startPage: '/forms', pages: ['/forms', '/patients', '/docs'], roles: ['sample-clerk'] },
  { kind: 'form', key: 'lab-request', questionnaire: { resourceType: 'Questionnaire', title: 'Lab request' }, open: ['sample-clerk'], submit: ['sample-clerk'] },
];

interface Fake {
  items?: PackItem[];
  roles?: { id: string; slug: string }[];
  layouts?: { id: string; name: string }[];
  members?: Record<string, string[]>;
  installed?: Record<string, string>;
  formCheck?: (q: unknown) => void;
}

function fakeDeps(f: Fake = {}): ProfileDeps {
  const roles = f.roles ?? [];
  const role = (r: { id: string; slug: string }) => ({ ...r, name: r.slug, description: null, isSystem: false, locked: false, capabilities: [], memberCount: 0 });
  const unused = () => { throw new Error('the check phase must not write'); };
  return {
    packItems: {
      list: vi.fn(async (packId: string) => (f.items ?? []).filter((i) => i.packId === packId)),
      owners: vi.fn(async () => new Map()),
      put: vi.fn(unused),
      remove: vi.fn(unused),
    },
    roles: {
      get: vi.fn(async (id: string) => { const r = roles.find((x) => x.id === id); return r ? role(r) : null; }),
      getBySlug: vi.fn(async (slug: string) => { const r = roles.find((x) => x.slug === slug); return r ? role(r) : null; }),
      create: vi.fn(unused),
      update: vi.fn(unused),
      remove: vi.fn(unused),
    },
    roleMembers: vi.fn(async (id: string) => f.members?.[id] ?? []),
    layouts: {
      list: vi.fn(async () => ({ layouts: (f.layouts ?? []).map((l) => ({ ...l, startPage: null, pages: ['/forms'], roles: [] })), roleOrder: [] })),
      save: vi.fn(unused),
      remove: vi.fn(unused),
    },
    forms: {
      install: vi.fn(unused),
      check: vi.fn(f.formCheck ?? (() => undefined)),
      setAccess: vi.fn(unused),
    },
    installedVersion: vi.fn(async (id: string) => (f.installed ?? { 'sample-tracking': '0.1.0' })[id] ?? null),
    capabilityKeys: ['forms.view', 'forms.submit', 'patients.view', 'roles.manage', 'marketplace.manage'],
  };
}

const ALL_CAPS = ['forms.view', 'forms.submit', 'patients.view', 'roles.manage', 'marketplace.manage'] as const;

describe('checkProfileSteps', () => {
  it('passes the collection site steps with all capabilities, and writes nothing', async () => {
    const deps = fakeDeps();
    await expect(checkProfileSteps(deps, PACK, STEPS, 'all')).resolves.toBeUndefined();
    expect(deps.forms.check).toHaveBeenCalledWith({ resourceType: 'Questionnaire', title: 'Lab request' });
  });

  it('passes when the installer holds every capability the role grants', async () => {
    await expect(checkProfileSteps(fakeDeps(), PACK, STEPS, ALL_CAPS)).resolves.toBeUndefined();
  });

  it('refuses a needed bundle that is not installed', async () => {
    await expect(checkProfileSteps(fakeDeps({ installed: {} }), PACK, STEPS, 'all'))
      .rejects.toThrow('this pack needs sample-tracking >=0.1.0, which is not installed');
  });

  it('refuses a needed bundle installed outside the range', async () => {
    const steps: ContentPackStep[] = [{ kind: 'needs', bundles: [{ id: 'sample-tracking', version: '>=0.2.0' }] }];
    await expect(checkProfileSteps(fakeDeps(), PACK, steps, 'all'))
      .rejects.toThrow('this pack needs sample-tracking >=0.2.0; 0.1.0 is installed');
  });

  it('refuses a role step when the installer lacks roles.manage', async () => {
    await expect(checkProfileSteps(fakeDeps(), PACK, STEPS, ['forms.view', 'forms.submit', 'patients.view', 'marketplace.manage']))
      .rejects.toThrow('installing this pack needs the roles.manage capability');
  });

  it('refuses a role capability the running CE does not know', async () => {
    const steps: ContentPackStep[] = [{ kind: 'role', slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view', 'moon.launch'] }];
    await expect(checkProfileSteps(fakeDeps(), PACK, steps, 'all')).rejects.toThrow('unknown capability: moon.launch');
  });

  it('refuses a role capability the installer does not hold', async () => {
    await expect(checkProfileSteps(fakeDeps(), PACK, STEPS, ['forms.view', 'forms.submit', 'roles.manage']))
      .rejects.toThrow('you cannot install a role that grants patients.view, because you do not hold it');
  });

  it('refuses a role slug taken by a role this pack did not make', async () => {
    const deps = fakeDeps({ roles: [{ id: 'r-admin', slug: 'sample-clerk' }] });
    await expect(checkProfileSteps(deps, PACK, STEPS, 'all'))
      .rejects.toThrow('a role with the slug sample-clerk already exists and this pack did not make it');
  });

  it('refuses a role slug another pack made', async () => {
    const deps = fakeDeps({
      roles: [{ id: 'r1', slug: 'sample-clerk' }],
      items: [{ packId: 'other-pack', kind: 'role', key: 'sample-clerk', itemId: 'r1' }],
    });
    await expect(checkProfileSteps(deps, PACK, STEPS, 'all'))
      .rejects.toThrow('a role with the slug sample-clerk already exists and this pack did not make it');
  });

  it('passes a role and layout this pack already made', async () => {
    const deps = fakeDeps({
      roles: [{ id: 'r1', slug: 'sample-clerk' }],
      layouts: [{ id: 'l1', name: 'Collection site' }],
      items: [
        { packId: PACK, kind: 'role', key: 'sample-clerk', itemId: 'r1' },
        { packId: PACK, kind: 'layout', key: 'collection-site', itemId: 'l1' },
      ],
    });
    await expect(checkProfileSteps(deps, PACK, STEPS, 'all')).resolves.toBeUndefined();
  });

  it('refuses a layout name taken by a layout this pack did not make', async () => {
    const deps = fakeDeps({ layouts: [{ id: 'l-admin', name: 'Collection site' }] });
    await expect(checkProfileSteps(deps, PACK, STEPS, 'all'))
      .rejects.toThrow('a layout named Collection site already exists and this pack did not make it');
  });

  it('refuses a layout that names a role no earlier step creates', async () => {
    const steps: ContentPackStep[] = [STEPS[2], STEPS[1]];
    await expect(checkProfileSteps(fakeDeps(), PACK, steps, 'all'))
      .rejects.toThrow('step 1 names the role sample-clerk, which no earlier step of this pack creates');
  });

  it('refuses a form that names a role no earlier step creates', async () => {
    const steps: ContentPackStep[] = [STEPS[1], { kind: 'form', key: 'lab-request', questionnaire: { resourceType: 'Questionnaire' }, open: ['sample-clerk'], submit: ['lab_admin'] }];
    await expect(checkProfileSteps(fakeDeps(), PACK, steps, 'all'))
      .rejects.toThrow('step 2 names the role lab_admin, which no earlier step of this pack creates');
  });

  it('refuses a layout the layout schema refuses, with its first message', async () => {
    const steps: ContentPackStep[] = [{ kind: 'layout', key: 'collection-site', name: 'Collection site', startPage: '/patients', pages: ['/forms'], roles: [] }];
    await expect(checkProfileSteps(fakeDeps(), PACK, steps, 'all')).rejects.toThrow('the start page must be one of the pages');
  });

  it('lets a form check error through', async () => {
    const deps = fakeDeps({ formCheck: () => { throw new Error('questionnaire item 3 has no linkId'); } });
    await expect(checkProfileSteps(deps, PACK, STEPS, 'all')).rejects.toThrow('questionnaire item 3 has no linkId');
  });

  it('refuses to leave out an owned role that users still hold', async () => {
    const deps = fakeDeps({
      roles: [{ id: 'r1', slug: 'sample-clerk' }, { id: 'r2', slug: 'old-clerk' }],
      items: [
        { packId: PACK, kind: 'role', key: 'sample-clerk', itemId: 'r1' },
        { packId: PACK, kind: 'role', key: 'old-clerk', itemId: 'r2' },
      ],
      members: { r1: ['Kept User'], r2: ['Ann', 'Bob'] },
    });
    const err = await checkProfileSteps(deps, PACK, STEPS, 'all').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PackRemovalError);
    expect((err as PackRemovalError).holders).toEqual([{ role: 'old-clerk', users: ['Ann', 'Bob'] }]);
  });

  it('refuses a role slug that slugify would change', async () => {
    const steps: ContentPackStep[] = [{ kind: 'role', slug: 'sample--clerk', name: 'Sample Clerk', capabilities: ['forms.view'] }];
    await expect(checkProfileSteps(fakeDeps(), PACK, steps, 'all'))
      .rejects.toThrow('the role slug sample--clerk must be lowercase letters, digits and single hyphens');
  });

  it('refuses two layout steps with the same name', async () => {
    const second: ContentPackStep = { kind: 'layout', key: 'collection-site-2', name: 'Collection site', startPage: null, pages: ['/forms'], roles: [] };
    await expect(checkProfileSteps(fakeDeps(), PACK, [...STEPS, second], 'all'))
      .rejects.toThrow('step 5 uses the layout name Collection site, which an earlier step of this pack already uses');
  });

  it('needs roles.manage for an update that leaves out a role this pack owns', async () => {
    const deps = fakeDeps({
      roles: [{ id: 'r2', slug: 'old-clerk' }],
      items: [{ packId: PACK, kind: 'role', key: 'old-clerk', itemId: 'r2' }],
    });
    await expect(checkProfileSteps(deps, PACK, [STEPS[0]], ['marketplace.manage']))
      .rejects.toThrow('installing this pack needs the roles.manage capability');
  });

  it('passes when an owned role it leaves out has no members', async () => {
    const deps = fakeDeps({
      roles: [{ id: 'r2', slug: 'old-clerk' }],
      items: [{ packId: PACK, kind: 'role', key: 'old-clerk', itemId: 'r2' }],
    });
    await expect(checkProfileSteps(deps, PACK, STEPS, 'all')).resolves.toBeUndefined();
  });
});

/** An install held in memory. Every write changes it, so a second run sees the first. */
function memDeps(opts: { failFormInstallTimes?: number } = {}) {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const items: PackItem[] = [];
  const roles = new Map<string, { id: string; slug: string; name: string; description: string | null; capabilities: string[] }>();
  const layouts = new Map<string, { id: string; name: string; startPage: string | null; pages: string[]; roles: string[] }>();
  const forms = new Map<string, { id: string; questionnaire: unknown; version: string }>();
  const access = new Map<string, { open: string[]; submit: string[] }>();
  let formFails = opts.failFormInstallTimes ?? 0;
  const roleRecord = (r: { id: string; slug: string; name: string; description: string | null; capabilities: string[] }) =>
    ({ ...r, isSystem: false, locked: false, memberCount: 0 });
  const deps: ProfileDeps = {
    packItems: {
      list: vi.fn(async (packId: string) => items.filter((i) => i.packId === packId)),
      owners: vi.fn(async () => new Map()),
      put: vi.fn(async (item: PackItem) => {
        const at = items.findIndex((i) => i.packId === item.packId && i.kind === item.kind && i.key === item.key);
        if (at >= 0) items[at] = item; else items.push(item);
      }),
      remove: vi.fn(async (packId: string, kind: PackItem['kind'], key: string) => {
        const at = items.findIndex((i) => i.packId === packId && i.kind === kind && i.key === key);
        if (at >= 0) items.splice(at, 1);
      }),
    },
    roles: {
      get: vi.fn(async (rid: string) => { const r = roles.get(rid); return r ? roleRecord(r) : null; }),
      getBySlug: vi.fn(async (slug: string) => { const r = [...roles.values()].find((x) => x.slug === slug); return r ? roleRecord(r) : null; }),
      create: vi.fn(async (input) => {
        const r = { id: id('r'), slug: input.slug!, name: input.name, description: input.description ?? null, capabilities: input.capabilities };
        roles.set(r.id, r);
        return roleRecord(r);
      }),
      update: vi.fn(async (rid: string, patch) => {
        const r = roles.get(rid)!;
        Object.assign(r, patch);
        return roleRecord(r);
      }),
      remove: vi.fn(async (rid: string) => { roles.delete(rid); }),
    },
    roleMembers: vi.fn(async () => []),
    layouts: {
      list: vi.fn(async () => ({ layouts: [...layouts.values()], roleOrder: [] })),
      save: vi.fn(async (lid: string | null, input) => {
        const l = { id: lid ?? id('l'), ...input };
        layouts.set(l.id, l);
        return l;
      }),
      remove: vi.fn(async (lid: string) => { const l = layouts.get(lid)!; layouts.delete(lid); return l; }),
    },
    forms: {
      install: vi.fn(async (fid: string | null, questionnaire: unknown, version: string) => {
        if (formFails > 0) { formFails--; throw new Error('the form store is down'); }
        const f = { id: fid ?? id('f'), questionnaire, version };
        forms.set(f.id, f);
        return f.id;
      }),
      check: vi.fn(),
      setAccess: vi.fn(async (fid: string, a: { open: string[]; submit: string[] }) => { access.set(fid, a); }),
    },
    installedVersion: vi.fn(async () => '0.1.0'),
    capabilityKeys: ALL_CAPS,
  };
  return { deps, items, roles, layouts, forms, access };
}

const runAll = async (deps: ProfileDeps, steps: ContentPackStep[], version = '1.0.0') => {
  const out = [];
  for (const s of steps) out.push(await runProfileStep(deps, PACK, version, s, 'admin'));
  return out;
};

describe('runProfileStep', () => {
  it('a needs step writes nothing and returns nothing to audit', async () => {
    const m = memDeps();
    await expect(runProfileStep(m.deps, PACK, '1.0.0', STEPS[0], 'admin')).resolves.toBeNull();
    expect(m.deps.packItems.put).not.toHaveBeenCalled();
  });

  it('a role step creates the role and records that this pack made it', async () => {
    const m = memDeps();
    const step: ContentPackStep = { ...STEPS[1], description: 'Takes samples' } as ContentPackStep;
    const out = await runProfileStep(m.deps, PACK, '1.0.0', step, 'admin');
    const [role] = [...m.roles.values()];
    expect(m.deps.roles.create).toHaveBeenCalledWith({ slug: 'sample-clerk', name: 'Sample Clerk', description: 'Takes samples', capabilities: ['forms.view', 'forms.submit', 'patients.view'] });
    expect(m.items).toEqual([{ packId: PACK, kind: 'role', key: 'sample-clerk', itemId: role.id }]);
    expect(out).toEqual({ action: 'role.create', entityType: 'role', entityId: role.id });
  });

  it('a role step with no description passes null', async () => {
    const m = memDeps();
    await runProfileStep(m.deps, PACK, '1.0.0', STEPS[1], 'admin');
    expect(m.deps.roles.create).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
  });

  it('the same role step run twice leaves one role, updated from the step', async () => {
    const m = memDeps();
    await runProfileStep(m.deps, PACK, '1.0.0', STEPS[1], 'admin');
    const changed: ContentPackStep = { kind: 'role', slug: 'sample-clerk', name: 'Clerk', description: 'New', capabilities: ['forms.view'] };
    const out = await runProfileStep(m.deps, PACK, '1.0.1', changed, 'admin');
    expect(m.roles.size).toBe(1);
    const [role] = [...m.roles.values()];
    expect(m.deps.roles.update).toHaveBeenCalledWith(role.id, { name: 'Clerk', description: 'New', capabilities: ['forms.view'] });
    expect(role).toMatchObject({ name: 'Clerk', description: 'New', capabilities: ['forms.view'] });
    expect(m.items).toHaveLength(1);
    expect(out).toEqual({ action: 'role.update', entityType: 'role', entityId: role.id });
  });

  it('creates the role again when the role the pack made is gone', async () => {
    const m = memDeps();
    m.items.push({ packId: PACK, kind: 'role', key: 'sample-clerk', itemId: 'r-gone' });
    const out = await runProfileStep(m.deps, PACK, '1.0.0', STEPS[1], 'admin');
    const [role] = [...m.roles.values()];
    expect(out?.action).toBe('role.create');
    expect(m.items).toEqual([{ packId: PACK, kind: 'role', key: 'sample-clerk', itemId: role.id }]);
  });

  it('a form step that fails after the role step wrote, then a second full run, leaves one role', async () => {
    const m = memDeps({ failFormInstallTimes: 1 });
    await expect(runAll(m.deps, STEPS)).rejects.toThrow('the form store is down');
    expect(m.roles.size).toBe(1);
    const outs = await runAll(m.deps, STEPS);
    expect(m.roles.size).toBe(1);
    expect(m.layouts.size).toBe(1);
    expect(m.forms.size).toBe(1);
    expect(outs.map((o) => o?.action)).toEqual([undefined, 'role.update', 'layout.update', 'form.install']);
    expect(m.items.map((i) => `${i.kind}:${i.key}`).sort()).toEqual(['form:lab-request', 'layout:collection-site', 'role:sample-clerk']);
  });

  it('a layout step saves with roles set to the pack slugs, and a second run updates the same layout', async () => {
    const m = memDeps();
    const first = await runAll(m.deps, STEPS.slice(1, 3));
    expect(m.deps.layouts.save).toHaveBeenCalledWith(null, { name: 'Collection site', startPage: '/forms', pages: ['/forms', '/patients', '/docs'], roles: ['sample-clerk'] }, 'admin');
    const [layout] = [...m.layouts.values()];
    expect(first[1]).toEqual({ action: 'layout.create', entityType: 'layout', entityId: layout.id });
    const again = await runProfileStep(m.deps, PACK, '1.0.0', STEPS[2], 'admin');
    expect(m.deps.layouts.save).toHaveBeenLastCalledWith(layout.id, expect.objectContaining({ roles: ['sample-clerk'] }), 'admin');
    expect(m.layouts.size).toBe(1);
    expect(again).toEqual({ action: 'layout.update', entityType: 'layout', entityId: layout.id });
  });

  it('creates the layout again when the layout the pack made is gone', async () => {
    const m = memDeps();
    m.items.push({ packId: PACK, kind: 'layout', key: 'collection-site', itemId: 'l-gone' });
    const out = await runProfileStep(m.deps, PACK, '1.0.0', STEPS[2], 'admin');
    expect(m.deps.layouts.save).toHaveBeenCalledWith(null, expect.anything(), 'admin');
    expect(out?.action).toBe('layout.create');
  });

  it('a form step installs the form at the bundle version and sets access to the given slugs', async () => {
    const m = memDeps();
    const step: ContentPackStep = { kind: 'form', key: 'lab-request', questionnaire: { resourceType: 'Questionnaire' }, open: ['sample-clerk', 'nurse'], submit: ['sample-clerk'] };
    const out = await runProfileStep(m.deps, PACK, '2.3.4', step, 'admin');
    const [form] = [...m.forms.values()];
    expect(m.deps.forms.install).toHaveBeenCalledWith(null, { resourceType: 'Questionnaire' }, '2.3.4', 'admin');
    expect(m.access.get(form.id)).toEqual({ open: ['sample-clerk', 'nurse'], submit: ['sample-clerk'] });
    expect(m.items).toEqual([{ packId: PACK, kind: 'form', key: 'lab-request', itemId: form.id }]);
    expect(out).toEqual({ action: 'form.install', entityType: 'form', entityId: form.id });
    await runProfileStep(m.deps, PACK, '2.3.5', step, 'admin');
    expect(m.deps.forms.install).toHaveBeenLastCalledWith(form.id, { resourceType: 'Questionnaire' }, '2.3.5', 'admin');
    expect(m.forms.size).toBe(1);
  });
});

describe('dropLeftOut', () => {
  it('deletes an owned role and layout the new steps leave out, reports them by id, and keeps a left-out form', async () => {
    const m = memDeps();
    await runAll(m.deps, STEPS);
    const [roleId] = [...m.roles.keys()];
    const [layoutId] = [...m.layouts.keys()];
    const [formId] = [...m.forms.keys()];
    const seen: string[] = [];
    const removed = await dropLeftOut(m.deps, PACK, [STEPS[0]], async (r) => { seen.push(`${r.kind}:${r.itemId}`); });
    expect(removed.roles).toEqual([expect.objectContaining({ kind: 'role', key: 'sample-clerk', itemId: roleId, name: 'Sample Clerk', before: expect.objectContaining({ id: roleId, slug: 'sample-clerk' }) })]);
    expect(removed.layouts).toEqual([expect.objectContaining({ kind: 'layout', key: 'collection-site', itemId: layoutId, name: 'Collection site', before: expect.objectContaining({ id: layoutId }) })]);
    expect(removed.formsKept).toEqual(['lab-request']);
    expect(seen.sort()).toEqual([`layout:${layoutId}`, `role:${roleId}`].sort());
    expect(m.roles.size).toBe(0);
    expect(m.layouts.size).toBe(0);
    expect(m.forms.has(formId)).toBe(true);
    expect(m.items).toEqual([]);
  });

  it('keeps what the new steps still carry', async () => {
    const m = memDeps();
    await runAll(m.deps, STEPS);
    await expect(dropLeftOut(m.deps, PACK, STEPS)).resolves.toEqual({ roles: [], layouts: [], formsKept: [] });
    expect(m.items).toHaveLength(3);
    expect(m.deps.roles.remove).not.toHaveBeenCalled();
    expect(m.deps.layouts.remove).not.toHaveBeenCalled();
  });

  it('forgets a left-out role and layout that are already gone, without reporting them as removed', async () => {
    const m = memDeps();
    m.items.push({ packId: PACK, kind: 'layout', key: 'old', itemId: 'l-gone' }, { packId: PACK, kind: 'role', key: 'old-clerk', itemId: 'r-gone' });
    const onRemoved = vi.fn(async () => undefined);
    await expect(dropLeftOut(m.deps, PACK, [], onRemoved)).resolves.toEqual({ roles: [], layouts: [], formsKept: [] });
    expect(onRemoved).not.toHaveBeenCalled();
    expect(m.deps.layouts.remove).not.toHaveBeenCalled();
    expect(m.deps.roles.remove).not.toHaveBeenCalled();
    expect(m.items).toEqual([]);
  });

  it('reports each removal before a later removal throws', async () => {
    const m = memDeps();
    m.roles.set('ra', { id: 'ra', slug: 'a-clerk', name: 'A', description: null, capabilities: [] });
    m.roles.set('rb', { id: 'rb', slug: 'b-clerk', name: 'B', description: null, capabilities: [] });
    m.items.push({ packId: PACK, kind: 'role', key: 'a-clerk', itemId: 'ra' }, { packId: PACK, kind: 'role', key: 'b-clerk', itemId: 'rb' });
    vi.mocked(m.deps.roles.remove).mockImplementation(async (id: string) => {
      if (id === 'rb') throw new Error('cannot delete the last role granting roles.manage');
      m.roles.delete(id);
    });
    const seen: string[] = [];
    await expect(dropLeftOut(m.deps, PACK, [], async (r) => { seen.push(r.itemId); }))
      .rejects.toThrow('cannot delete the last role granting roles.manage');
    expect(seen).toEqual(['ra']);
  });
});

describe('runProfileStep: layout name', () => {
  it('saves the trimmed name the check phase compared', async () => {
    const m = memDeps();
    await runProfileStep(m.deps, PACK, '1.0.0', STEPS[1], 'admin');
    await runProfileStep(m.deps, PACK, '1.0.0', { ...STEPS[2], name: '  Collection site  ' } as ContentPackStep, 'admin');
    expect(m.deps.layouts.save).toHaveBeenCalledWith(null, expect.objectContaining({ name: 'Collection site' }), 'admin');
  });
});
