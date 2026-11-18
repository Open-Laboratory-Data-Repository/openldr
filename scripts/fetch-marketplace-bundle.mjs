// Downloads one published bundle from the marketplace into a folder, for the seeds and tests that
// need a plugin this repository no longer builds (whonet-sqlite, since 2026-11-18).
//
// Usage: node scripts/fetch-marketplace-bundle.mjs <id> <out dir> [--registry <url>]
// Then install it as a lab would: pnpm openldr market install <out dir> --approve
//
// The registry defaults to CE's Default registry. `market install` checks the signature; this
// script only checks that the payload matches the manifest's hash, so a broken download stops here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr_ce-marketplace/main';

const args = process.argv.slice(2);
const at = args.indexOf('--registry');
const registry = (at >= 0 ? args.splice(at, 2)[1] : DEFAULT_REGISTRY).replace(/\/+$/, '');
const [id, outDir] = args;
if (!id || !outDir) {
  process.stderr.write('usage: node scripts/fetch-marketplace-bundle.mjs <id> <out dir> [--registry <url>]\n');
  process.exit(2);
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

try {
  const index = JSON.parse(new TextDecoder().decode(await get(`${registry}/index.json`)));
  const entry = (index.packages ?? []).find((p) => p.id === id);
  if (!entry) throw new Error(`${id} is not in ${registry}/index.json`);
  const base = `${registry}/${entry.path}`;
  const manifestBytes = await get(`${base}/manifest.json`);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const files = { 'manifest.json': manifestBytes, 'publisher.pub': await get(`${base}/publisher.pub`) };
  if (manifest.payload?.kind === 'plugin') {
    const wasm = await get(`${base}/plugin.wasm`);
    const sha = createHash('sha256').update(wasm).digest('hex');
    if (sha !== manifest.payload.wasmSha256) throw new Error(`plugin.wasm sha256 ${sha} does not match the manifest`);
    files['plugin.wasm'] = wasm;
    const ui = manifest.payload.ui?.entry;
    if (ui) files[ui] = await get(`${base}/${ui}`);
  } else {
    throw new Error(`${id} is a ${manifest.payload?.kind ?? 'unknown'} bundle; this script fetches plugins only`);
  }
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(outDir, name), bytes);
  process.stdout.write(`fetched ${id}@${manifest.version} from ${registry} into ${outDir}\n`);
} catch (err) {
  process.stderr.write(`fetch failed: ${err.message}\n`);
  process.exit(1);
}
