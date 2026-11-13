import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { readAppVersion } from './version';

describe('readAppVersion', () => {
  afterEach(() => { delete process.env.APP_VERSION; });

  it('prefers the APP_VERSION env override', () => {
    process.env.APP_VERSION = '9.9.9-test';
    expect(readAppVersion()).toBe('9.9.9-test');
  });

  // The client sends runningVersion() made by the same rule (constraints R5).
  it('equals the version in the root package.json when APP_VERSION is unset', () => {
    delete process.env.APP_VERSION;
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(readAppVersion()).toBe(root.version);
  });

  it('falls back to the repo package.json version (semver-ish string)', () => {
    delete process.env.APP_VERSION;
    expect(readAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
