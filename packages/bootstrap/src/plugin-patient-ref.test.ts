import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { loadPluginPatientRefKey, pluginPatientRefs, PLUGIN_PATIENT_REF_KEY } from './plugin-patient-ref';
import { wipeTables } from './danger';

describe('pluginPatientRefs', () => {
  const key = randomBytes(32);

  it('gives the same ref for the same patient and plugin, and decodes it back', () => {
    const a = pluginPatientRefs(key, 'lab');
    const ref = a.encode('Patient/hl7-12345');
    expect(pluginPatientRefs(key, 'lab').encode('Patient/hl7-12345')).toBe(ref);
    expect(a.decode(ref)).toBe('Patient/hl7-12345');
    expect(ref).not.toContain('12345');
    expect(a.encode('Patient/hl7-12346')).not.toBe(ref);
  });

  it('does not open for another plugin or another key', () => {
    const ref = pluginPatientRefs(key, 'lab').encode('p-1');
    expect(pluginPatientRefs(key, 'lab2').decode(ref)).toBeNull();
    expect(pluginPatientRefs(randomBytes(32), 'lab').decode(ref)).toBeNull();
  });

  it('refuses an altered or malformed ref', () => {
    const refs = pluginPatientRefs(key, 'lab');
    const ref = refs.encode('p-1');
    const body = Buffer.from(ref.slice(3), 'base64url');
    for (let i = 0; i < body.length; i++) {
      const b = Buffer.from(body);
      b[i] ^= 1;
      expect(refs.decode('p1.' + b.toString('base64url'))).toBeNull();
    }
    for (const bad of ['', 'p1.', 'p1.AAAA', 'p1.+/==', 'x1.' + ref.slice(3)]) expect(refs.decode(bad)).toBeNull();
  });

  it('refuses a second spelling of a ref, made by changing spare bits in its last character', () => {
    const refs = pluginPatientRefs(key, 'lab');
    // Find an id whose ref ends in a character with spare bits (body length not a multiple of 3).
    let id = 'p-1';
    while (Buffer.from(refs.encode(id).slice(3), 'base64url').length % 3 === 0) id += 'x';
    const ref = refs.encode(id);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(ref.at(-1)!);
    const twin = ref.slice(0, -1) + alphabet[last ^ 1];
    expect(Buffer.from(twin.slice(3), 'base64url').equals(Buffer.from(ref.slice(3), 'base64url'))).toBe(true);
    expect(refs.decode(ref)).toBe(id);
    expect(refs.decode(twin)).toBeNull();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => pluginPatientRefs(Buffer.alloc(16), 'lab')).toThrow(/32 bytes/);
  });
});

describe('loadPluginPatientRefKey', () => {
  it('makes the key once and gives the same key after', async () => {
    const db = await makeMigratedDb();
    const first = await loadPluginPatientRefKey(db);
    expect(first).toHaveLength(32);
    expect((await loadPluginPatientRefKey(db)).equals(first)).toBe(true);
    const rows = await db.selectFrom('app_settings').selectAll().where('key', '=', PLUGIN_PATIENT_REF_KEY).execute();
    expect(rows).toHaveLength(1);
  });
});

describe('factory reset and the plugin patient ref key', () => {
  it('the key survives a wipe of app_settings, and other settings do not', async () => {
    const db = await makeMigratedDb();
    const before = await loadPluginPatientRefKey(db);
    await db.insertInto('app_settings').values({ key: 'dashboard.raw_sql', value: 'true', updated_by: 'admin' }).execute();
    // pg-mem cannot list tables from pg_tables or truncate several at once, so this wipes the one
    // table that holds the key, through the same path wipeInternalDatabase takes.
    await wipeTables(db, ['app_settings']);
    const left = await db.selectFrom('app_settings').select('key').execute();
    expect(left.map((r) => r.key)).toEqual([PLUGIN_PATIENT_REF_KEY]);
    expect((await loadPluginPatientRefKey(db)).equals(before)).toBe(true);
  });
});
