import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCompatible } from '@openldr/marketplace';
import { CE_VERSION, readCeVersion } from './plugin-registry';

// The release bumps the root package.json. That is the version a pack's ceVersion range is checked against.
const rootVersion = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as { version: string }).version;

describe('readCeVersion', () => {
  it('reads the root package.json version when APP_VERSION is unset', () => {
    expect(readCeVersion({})).toBe(rootVersion);
  });

  it('prefers APP_VERSION, which the release sets in the image', () => {
    expect(readCeVersion({ APP_VERSION: '9.9.9' })).toBe('9.9.9');
  });

  it('ignores an empty APP_VERSION, which a plain docker build leaves behind', () => {
    expect(readCeVersion({ APP_VERSION: '' })).toBe(rootVersion);
  });
});

describe('CE_VERSION', () => {
  it('is the root package.json version, not a hardcoded one', () => {
    expect(CE_VERSION).toBe(rootVersion);
  });

  it('satisfies a pack minimum of >=0.1.9 and refuses >=99.0.0', () => {
    expect(isCompatible('>=0.1.9', CE_VERSION)).toBe(true);
    expect(isCompatible('>=99.0.0', CE_VERSION)).toBe(false);
  });
});
