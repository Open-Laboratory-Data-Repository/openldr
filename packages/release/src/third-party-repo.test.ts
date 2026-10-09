import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseThirdPartyList, imageRefs, badImageRefs } from './third-party';
import { POLICY_FILES } from './third-party-files';

const REPO = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const list = parseThirdPartyList(readFileSync(join(REPO, 'deploy/third-party-images.json'), 'utf8'));

describe('third-party image policy', () => {
  it('every listed image has a digest', () => {
    expect(list.images.filter((i) => !/^sha256:[0-9a-f]{64}$/.test(i.digest)).map((i) => i.name)).toEqual([]);
  });

  for (const rel of POLICY_FILES) {
    it(`${rel} pulls only our images, pinned copies, or listed exceptions`, () => {
      const kind = rel.endsWith('Dockerfile') ? 'dockerfile' : 'compose';
      const refs = imageRefs(readFileSync(join(REPO, rel), 'utf8'), kind);
      expect(refs.length).toBeGreaterThan(0);
      expect(badImageRefs(refs, list)).toEqual([]);
    });
  }
});
