// Copy one third-party image into our GHCR and record its digest.
//   pnpm images:mirror garage        copy one
//   pnpm images:mirror --all         copy every entry in deploy/third-party-images.json
// The copy happens registry-side (docker buildx imagetools create). It copies linux/amd64 and
// linux/arm64 only, because our own images are amd64-only. A full copy of a large index
// (postgres has 16 manifest entries) timed out.
// Run it on purpose to take an upstream update. Then rerun the release tests: the repo test
// fails until every compose file and Dockerfile carries the new digest, which this script
// rewrites for you.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseThirdPartyList, replaceDigest } from '../packages/release/src/third-party';
import { POLICY_FILES } from '../packages/release/src/third-party-files';

const repo = join(fileURLToPath(import.meta.url), '..', '..');
const listPath = join(repo, 'deploy/third-party-images.json');
const OWNER = 'Open-Laboratory-Data-Repository';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: pnpm images:mirror <name>|--all');
  process.exit(1);
}
const listText = readFileSync(listPath, 'utf8');
const list = parseThirdPartyList(listText);
const targets = arg === '--all' ? list.images : list.images.filter((i) => i.name === arg);
if (targets.length === 0) {
  console.error(`no entry named ${arg} in deploy/third-party-images.json`);
  process.exit(1);
}

for (const img of targets) {
  const createArgs = [
    'buildx', 'imagetools', 'create',
    '--platform', 'linux/amd64', '--platform', 'linux/arm64',
    '--tag', img.copy, img.upstream,
  ];
  console.log(`+ docker ${createArgs.join(' ')}`);
  execFileSync('docker', createArgs, { stdio: 'inherit' });
  const digest = execFileSync(
    'docker', ['buildx', 'imagetools', 'inspect', img.copy, '--format', '{{json .Manifest.Digest}}'],
    { encoding: 'utf8' },
  ).trim().replace(/"/g, '');
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`unexpected digest for ${img.copy}: ${digest}`);
  if (img.digest && img.digest !== digest) {
    for (const rel of POLICY_FILES) {
      const p = join(repo, rel);
      const before = readFileSync(p, 'utf8');
      const after = replaceDigest(before, img.copy, img.digest, digest);
      if (after !== before) { writeFileSync(p, after); console.log(`  updated ${rel}`); }
    }
  }
  img.digest = digest;
  writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n'); // keep finished digests if a later copy fails
  console.log(`  ${img.name} -> ${digest}`);
  console.log(`  make it public if new: https://github.com/orgs/${OWNER}/packages/container/${img.name}/settings`);
}
