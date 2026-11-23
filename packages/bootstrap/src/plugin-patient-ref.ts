import { createCipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';

// A lasting patient link for a plugin (lab plugin plan 1, task 1b). The patient index's `ref` is
// sealed under a key made at boot, so it stops working on restart, and a masked row hides `id`.
// A plugin that stores a link to a patient gets `pluginRef` instead:
//
// - the same string for the same patient and plugin, on every call and after a restart;
// - opaque: it is the patient id encrypted, so it shows nothing without CE's key;
// - one plugin's ref does not open for another plugin.
//
// How: a random 32-byte key kept once in app_settings. Per plugin, HKDF-SHA256 (info
// "openldr:plugin-patient-ref:" + plugin id) gives a MAC key and an encryption key. The ref is
// base64url of iv + AES-256-CTR(id), where iv is the first 16 bytes of HMAC-SHA256(MAC key, id).
// That is the SIV construction (RFC 5297 shape, with HMAC in place of CMAC): the same id always
// gives the same ref, and decoding checks the iv against the HMAC of the decrypted id, so a ref
// that was altered, or made for another plugin, decodes to nothing.

/** The app_settings row holding the key, base64. Not a center-owned key, so sync never sends it. */
export const PLUGIN_PATIENT_REF_KEY = 'plugins.patient_ref_key';
const PREFIX = 'p1.';
const INFO = 'openldr:plugin-patient-ref:';

export interface PluginPatientRefs {
  encode(patientId: string): string;
  /** The patient id, or null when the ref is not one this plugin was given. */
  decode(ref: string): string | null;
}

export function pluginPatientRefs(master: Buffer, pluginId: string): PluginPatientRefs {
  if (master.length !== 32) throw new Error('the plugin patient ref key must be 32 bytes');
  const keys = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), INFO + pluginId, 64));
  const macKey = keys.subarray(0, 32);
  const encKey = keys.subarray(32, 64);
  const ivFor = (plain: Buffer) => createHmac('sha256', macKey).update(plain).digest().subarray(0, 16);
  const ctr = (iv: Buffer, data: Buffer) => {
    const c = createCipheriv('aes-256-ctr', encKey, iv);
    return Buffer.concat([c.update(data), c.final()]);
  };
  return {
    encode(patientId) {
      const plain = Buffer.from(patientId, 'utf8');
      const iv = ivFor(plain);
      return PREFIX + Buffer.concat([iv, ctr(iv, plain)]).toString('base64url');
    },
    decode(ref) {
      if (typeof ref !== 'string' || !ref.startsWith(PREFIX)) return null;
      const body = ref.slice(PREFIX.length);
      if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
      const raw = Buffer.from(body, 'base64url');
      if (raw.length <= 16) return null;
      const iv = raw.subarray(0, 16);
      const plain = ctr(iv, raw.subarray(16));
      if (!timingSafeEqual(iv, ivFor(plain))) return null;
      return plain.toString('utf8');
    },
  };
}

/** The key from app_settings, made once on first use. Insert-if-absent then read, so two processes
 *  starting together agree on one key. Losing this row breaks every stored pluginRef. */
export async function loadPluginPatientRefKey(db: Kysely<InternalSchema>): Promise<Buffer> {
  await db.insertInto('app_settings')
    .values({ key: PLUGIN_PATIENT_REF_KEY, value: randomBytes(32).toString('base64'), updated_by: 'system', updated_at: sql`now()` as never })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
  const row = await db.selectFrom('app_settings').select('value').where('key', '=', PLUGIN_PATIENT_REF_KEY).executeTakeFirstOrThrow();
  const key = Buffer.from(row.value, 'base64');
  if (key.length !== 32) throw new Error(`app setting ${PLUGIN_PATIENT_REF_KEY} is not a 32-byte base64 key`);
  return key;
}
