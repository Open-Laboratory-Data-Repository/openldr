import { describe, it, expect } from 'vitest';
import { releaseProbeParent } from './probe-dir';

describe('releaseProbeParent', () => {
  // Measured 2026-11-22: the 0.1.12 check install ran under /tmp, and Docker Desktop refused the
  // mount ("not shared from the host"). The same install passed from a folder under the home
  // directory, which Docker Desktop shares by default.
  it('puts the check install under the home directory, not the system temp folder', () => {
    expect(releaseProbeParent('/home/lab')).toBe('/home/lab/.cache/openldr-release');
  });
});
