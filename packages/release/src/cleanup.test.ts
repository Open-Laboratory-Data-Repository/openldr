import { describe, it, expect } from 'vitest';
import { cleanupPlan, teardownCommand } from './cleanup';

describe('cleanupPlan', () => {
  // A released version needs nothing from the verification stack, and a live stack on 80/443
  // makes the NEXT release's verification install collide with it.
  it('tears the stack down and removes the directory after a release', () => {
    expect(cleanupPlan({ dryRun: false, outcome: 'released' })).toEqual({
      teardownStack: true,
      removeDir: true,
    });
  });

  // `run()` is a no-op under --dry-run but mkdtempSync still creates the directory, so every dry
  // run used to leave an empty `openldr-release-*` behind. No stack was ever started.
  it('removes only the empty directory after a dry run', () => {
    expect(cleanupPlan({ dryRun: true, outcome: 'released' })).toEqual({
      teardownStack: false,
      removeDir: true,
    });
  });

  // RELEASE.md: the stack's logs are the evidence when verification fails. Keep everything.
  it('keeps the stack and its directory when the release failed', () => {
    expect(cleanupPlan({ dryRun: false, outcome: 'failed' })).toEqual({
      teardownStack: false,
      removeDir: false,
    });
  });

  // The release is public, but the desktop upload or the latest.json check after it failed. The
  // stack holds 80 and 443 and nobody needs it, so it goes. The folder holds latest.json, the only
  // copy, and the printed recovery command uploads it from there, so the folder stays.
  it('tears the stack down and keeps the directory when a check after the release failed', () => {
    expect(cleanupPlan({ dryRun: false, outcome: 'released-check-failed' })).toEqual({
      teardownStack: true,
      removeDir: false,
    });
  });

  // A dry run runs no check after the release, so it cannot reach this outcome. If it ever does,
  // there is no stack to remove, and the folder is still kept rather than guessed about.
  it('keeps the directory of a dry run whose check failed, with no stack to remove', () => {
    expect(cleanupPlan({ dryRun: true, outcome: 'released-check-failed' })).toEqual({
      teardownStack: false,
      removeDir: false,
    });
  });

  it('keeps the directory of a failed dry run too, since it may say why', () => {
    expect(cleanupPlan({ dryRun: true, outcome: 'failed' })).toEqual({
      teardownStack: false,
      removeDir: false,
    });
  });
});

describe('teardownCommand', () => {
  // Printed on failure so the operator can clean up once they are done reading the logs. It has
  // to be copy-pasteable, so the directory is quoted and the volumes go with it.
  it('names the directory and removes volumes', () => {
    expect(teardownCommand('/tmp/openldr-release-abc')).toBe(
      'cd "/tmp/openldr-release-abc" && docker compose down -v',
    );
  });

  it('quotes a Windows path that contains spaces', () => {
    expect(teardownCommand('C:\\Users\\Jo Doe\\Temp\\openldr-release-x')).toBe(
      'cd "C:\\Users\\Jo Doe\\Temp\\openldr-release-x" && docker compose down -v',
    );
  });
});
