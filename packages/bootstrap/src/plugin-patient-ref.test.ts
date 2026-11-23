import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { loadPluginPatientRefKey, pluginPatientRefs, PLUGIN_PATIENT_REF_KEY } from './plugin-patient-ref';

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
