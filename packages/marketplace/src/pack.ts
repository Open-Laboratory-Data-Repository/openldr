import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArtifactManifest, type ArtifactManifest } from './artifact-manifest';
import { signManifest, keyFingerprint } from './signing';
import { readBundle, verifyBundle } from './bundle-fs';

export interface PackInput {
  manifest: Record<string, unknown>; // unsigned artifact manifest (publisher.keyFingerprint + payload sha are overwritten)
  payload: Uint8Array;
  outDir: string;
  privateKeyDer: Uint8Array;
  publicKeyDer: Uint8Array;
  /** UI bytes (ui.html) for a plugin whose manifest declares payload.ui.entry. Required when the
   *  manifest declares a webview ui entry; ignored otherwise. */
  ui?: Uint8Array;
}
export interface PackResult { bundleDir: string; fingerprint: string; manifest: ArtifactManifest }

const PAYLOAD_FILE: Record<string, string> = {
  plugin: 'plugin.wasm',
  'form-template': 'questionnaire.json',
  'report-template': 'report.json',
  'content-pack': 'pack.json',
};
const SHA_FIELD: Record<string, string> = {
  plugin: 'wasmSha256',
  'form-template': 'questionnaireSha256',
  'report-template': 'templateSha256',
  'content-pack': 'packSha256',
};

export async function packBundle(input: PackInput): Promise<PackResult> {
  const fingerprint = keyFingerprint(input.publicKeyDer);
  const payloadSha = createHash('sha256').update(input.payload).digest('hex');

  // Build the unsigned manifest with sha + publisher fingerprint filled in; drop any stale signature.
  const draft = { ...input.manifest } as Record<string, unknown>;
  delete draft.signature;
  const publisher = { ...(draft.publisher as Record<string, unknown> | undefined) };
  publisher.keyFingerprint = fingerprint;
  draft.publisher = publisher;
  const payload = { ...(draft.payload as Record<string, unknown>) };
  const kind = String(payload.kind);
  const shaField = SHA_FIELD[kind];
  if (!shaField) throw new Error(`packBundle: unsupported payload kind ${kind}`);
  payload[shaField] = payloadSha;
  draft.payload = payload;

  const parsed = parseArtifactManifest(draft); // validates before signing
  // The schema strips keys it does not know. Signing what is left gives a valid signature over a
  // manifest that lost settings, which a packer older than the plugin once did silently. Refuse
  // instead, naming what would be lost, before anything is written.
  const lost = droppedPaths(draft, parsed as unknown);
  if (lost.length > 0) {
    throw new Error(`packBundle: this packer does not know ${lost.join(', ')}; update OpenLDR CE before packing, or the bundle would lose them`);
  }
  const signature = signManifest(parsed as unknown as Record<string, unknown>, payloadSha, input.privateKeyDer);
  const signedManifest = { ...(parsed as unknown as Record<string, unknown>), signature };

  // A webview ui contribution declares a single ui.html (basename); write its bytes alongside the
  // payload so readBundle finds it. We require uiEntry === basename(uiEntry) BEFORE writing, so a
  // traversal entry (e.g. '../escaped.html') throws and nothing is written — the join can't escape
  // outDir. If the manifest declares no ui entry, input.ui is ignored.
  const uiEntry = (parsed.payload as { ui?: { entry?: string } }).ui?.entry;
  if (uiEntry && !input.ui) {
    throw new Error('packBundle: manifest declares payload.ui.entry but no ui bytes were provided');
  }
  if (uiEntry && (uiEntry !== basename(uiEntry) || uiEntry === '')) {
    throw new Error(`packBundle: invalid ui entry '${uiEntry}' — must be a plain filename inside the bundle`);
  }

  await mkdir(input.outDir, { recursive: true });
  await writeFile(join(input.outDir, 'manifest.json'), JSON.stringify(signedManifest, null, 2));
  await writeFile(join(input.outDir, PAYLOAD_FILE[kind]), input.payload);
  if (uiEntry && input.ui) await writeFile(join(input.outDir, uiEntry), input.ui);
  await writeFile(join(input.outDir, 'publisher.pub'), Buffer.from(input.publicKeyDer).toString('hex'));

  // Self-check: the bundle we just wrote must verify.
  const check = verifyBundle(await readBundle(input.outDir));
  if (!check.valid) throw new Error('packBundle: produced an invalid bundle (internal error)');

  return { bundleDir: input.outDir, fingerprint, manifest: parsed };
}

/** Paths present in `given` that the parsed manifest does not carry. Defaults the schema adds are
 *  fine; only lost keys count. Arrays are compared item by item. */
function droppedPaths(given: unknown, kept: unknown, at = ''): string[] {
  if (given === null || typeof given !== 'object') return [];
  if (kept === null || typeof kept !== 'object') return at ? [at] : [];
  const out: string[] = [];
  for (const key of Object.keys(given as Record<string, unknown>)) {
    const path = Array.isArray(given) ? `${at}[${key}]` : at ? `${at}.${key}` : key;
    // Own keys only: `in` would also find inherited names such as toString (review I1).
    if (!Object.prototype.hasOwnProperty.call(kept, key)) { out.push(path); continue; }
    out.push(...droppedPaths((given as Record<string, unknown>)[key], (kept as Record<string, unknown>)[key], path));
  }
  return out;
}
