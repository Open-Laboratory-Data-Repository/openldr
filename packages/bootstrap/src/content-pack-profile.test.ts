import { describe, it, expect, vi } from 'vitest';
import type { ContentPackStep } from '@openldr/marketplace';
import type { PackItem } from '@openldr/db';
import { checkProfileSteps, PackRemovalError, type ProfileDeps } from './content-pack-profile';

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

  it('passes when an owned role it leaves out has no members', async () => {
    const deps = fakeDeps({
      roles: [{ id: 'r2', slug: 'old-clerk' }],
      items: [{ packId: PACK, kind: 'role', key: 'old-clerk', itemId: 'r2' }],
    });
    await expect(checkProfileSteps(deps, PACK, STEPS, 'all')).resolves.toBeUndefined();
  });
});
