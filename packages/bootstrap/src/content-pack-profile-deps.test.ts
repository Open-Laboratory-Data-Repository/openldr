import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFormAccessStore, createMarketplaceInstallStore, createRoleStore } from '@openldr/db';
import { createFormStore } from '@openldr/forms';
import { createPluginStore } from '@openldr/plugins';
import { installedBundleVersion, packFormDeps, roleMemberNames } from './content-pack-profile-deps';

// Layer under test: the real stores over pg-mem. Not real Postgres.

const Q = { resourceType: 'Questionnaire', status: 'active', title: 'Lab request', item: [{ linkId: 'a', text: 'A', type: 'string' }] };

// Bound to an order the way the seeded Lab order is: the form-level resource type is ServiceRequest.
const ORDER_Q = {
  ...Q,
  extension: [{ url: 'urn:corlix:questionnaire:fhir-resource-type', valueString: 'ServiceRequest' }],
  item: [{ linkId: 'req', text: 'Requisition number', type: 'string',
    extension: [{ url: 'urn:corlix:questionnaire:fhir-path', valueString: 'ServiceRequest.identifier.value' }] }],
};

// No resource type, but one field is a coded result, so the Observation extractor applies.
const RESULT_Q = {
  ...Q,
  title: 'Result',
  item: [{ linkId: 'r', text: 'Result', type: 'decimal', code: [{ system: 'urn:test:measurements', code: 'm1' }],
    extension: [{ url: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationExtract', valueBoolean: true }] }],
};

describe('roleMemberNames', () => {
  it('names each holder by display name, else username, else subject, ordered by name then subject', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('roles').values([
      { id: 'r1', slug: 'clerk', name: 'Clerk', description: null, is_system: false },
      { id: 'r2', slug: 'other', name: 'Other', description: null, is_system: false },
    ] as never).execute();
    await db.insertInto('users').values([
      { id: 'u1', subject: 'sub-1', username: 'zed', display_name: 'Ann', email: null, roles: JSON.stringify([]) },
      { id: 'u2', subject: 'sub-2', username: 'bob', display_name: null, email: null, roles: JSON.stringify([]) },
      { id: 'u3', subject: 'sub-3', username: 'ann2', display_name: 'Ann', email: null, roles: JSON.stringify([]) },
      // A local user with no subject signs in by id.
      { id: 'u4', subject: null, username: 'cy', display_name: 'Cy', email: null, roles: JSON.stringify([]) },
    ] as never).execute();
    await db.insertInto('user_roles').values([
      { user_id: 'sub-3', role_id: 'r1' }, { user_id: 'sub-1', role_id: 'r1' }, { user_id: 'sub-2', role_id: 'r1' },
      { user_id: 'u4', role_id: 'r1' }, { user_id: 'sub-orphan', role_id: 'r1' }, { user_id: 'sub-1', role_id: 'r2' },
    ] as never).execute();
    await expect(roleMemberNames(db as never, 'r1')).resolves.toEqual(['Ann', 'Ann', 'bob', 'Cy', 'sub-orphan']);
    await expect(roleMemberNames(db as never, 'r-none')).resolves.toEqual([]);
  });
});

async function formSetup() {
  const db = await makeMigratedDb();
  const forms = createFormStore(db as never);
  const roles = createRoleStore(db as never);
  const access = createFormAccessStore(db as never);
  await db.insertInto('roles').values([{ id: 'r1', slug: 'clerk', name: 'Clerk', description: null, is_system: false }] as never).execute();
  return { db, forms, access, deps: packFormDeps({ forms, access, roles }) };
}

describe('packFormDeps', () => {
  it('check throws on a Questionnaire that would not load, and passes a good one', async () => {
    const { deps } = await formSetup();
    expect(() => deps.check(ORDER_Q)).not.toThrow();
    expect(() => deps.check(RESULT_Q)).not.toThrow();
    expect(() => deps.check(null)).toThrow();
  });

  it('check refuses a form no extractor covers, since the submit route could never save it', async () => {
    const { deps } = await formSetup();
    expect(() => deps.check(Q)).toThrow(
      'the form "Lab request" could never be saved: it is not bound to an order (ServiceRequest) and no field is marked as a result',
    );
    // A result flag with no code is not enough, the same as on the submit route.
    const noCode = { ...RESULT_Q, item: [{ ...RESULT_Q.item[0], code: [] }] };
    expect(() => deps.check(noCode)).toThrow('the form "Result" could never be saved');
  });

  it('install creates and publishes a form, then updates the same form on a second run', async () => {
    const { deps, forms } = await formSetup();
    const id = await deps.install(null, Q, '1.0.0', 'admin');
    const made = await forms.get(id);
    expect(made).toMatchObject({ name: 'Lab request', status: 'published', versionLabel: '1.0.0' });
    const again = await deps.install(id, { ...Q, title: 'Lab request v2' }, '1.1.0', 'admin');
    expect(again).toBe(id);
    expect(await forms.get(id)).toMatchObject({ name: 'Lab request v2', status: 'published', versionLabel: '1.1.0' });
    expect(await forms.list()).toHaveLength(1);
  });

  it('install makes a new form when the given form no longer exists, and never touches another', async () => {
    const { deps, forms } = await formSetup();
    const other = await forms.create({ name: 'Admin form', schema: { name: 'Admin form', fields: [], sections: [] } } as never);
    const id = await deps.install('form-gone', Q, '1.0.0', null);
    expect(id).not.toBe('form-gone');
    expect(id).not.toBe(other.id);
    expect(await forms.get(id)).toMatchObject({ name: 'Lab request' });
    expect(await forms.get(other.id)).toMatchObject({ name: 'Admin form', status: 'draft' });
  });

  it('setAccess stores role ids from slugs, and name reads the form name or null', async () => {
    const { deps, access } = await formSetup();
    const id = await deps.install(null, Q, '1.0.0', null);
    await deps.setAccess(id, { open: ['clerk'], submit: ['clerk'] });
    expect((await access.forForms([id])).get(id)).toEqual({ open: ['r1'], submit: ['r1'] });
    await expect(deps.name(id)).resolves.toBe('Lab request');
    await expect(deps.name('form-gone')).resolves.toBeNull();
  });
});

describe('installedBundleVersion', () => {
  it('reads the enabled plugin, then an installed content pack, else null', async () => {
    const db = await makeMigratedDb();
    const plugins = createPluginStore(db as never);
    const installs = createMarketplaceInstallStore(db as never);
    await plugins.install({ id: 'sample-tracking', version: '0.2.0', sha256: 'a', manifest: {}, approvedBy: null });
    await installs.upsert({ artifactId: 'base-pack', version: '1.0.0', kind: 'content-pack', payloadSha256: 'b', status: 'installed' } as never);
    await installs.upsert({ artifactId: 'broken-pack', version: '1.0.0', kind: 'content-pack', payloadSha256: 'c', status: 'failed' } as never);
    const v = (id: string) => installedBundleVersion({ plugins, installs }, id);
    await expect(v('sample-tracking')).resolves.toBe('0.2.0');
    await expect(v('base-pack')).resolves.toBe('1.0.0');
    await expect(v('broken-pack')).resolves.toBeNull();
    await expect(v('nothing')).resolves.toBeNull();
    await plugins.setEnabled('sample-tracking', false);
    await expect(v('sample-tracking')).resolves.toBeNull();
  });
});
