import { describe, it, expect } from 'vitest';
import {
  SHA256SUMS_NAME,
  desktopAssetNames,
  desktopPackRefusal,
  missingDesktopAssets,
  uploadFailureMessage,
} from './desktop-release';

const LINUX = 'openldr-desktop-0.1.11-linux-x64.tar.gz';
const MAC = 'openldr-desktop-0.1.11-darwin-arm64.tar.gz';
const WINDOWS = 'openldr-desktop-0.1.11-win32-x64.zip';

describe('desktopAssetNames', () => {
  // The release uploads these four and then checks the same four are on the release. One list
  // for both means the check cannot drift from what was uploaded.
  it('gives the three archives and SHA256SUMS', () => {
    expect(desktopAssetNames('0.1.11')).toEqual([LINUX, MAC, WINDOWS, 'SHA256SUMS']);
    expect(SHA256SUMS_NAME).toBe('SHA256SUMS');
  });
});

describe('desktopPackRefusal', () => {
  const REFUSAL =
    'The desktop packages are built on Linux. Other systems cannot make them: the macOS and Linux packages need symbolic links, file modes and GNU tar. Run the release on the Linux release machine.';

  // The release has run on Windows before. From this change its pack step must stop there,
  // before any image is pushed, and say where to run it instead.
  it('refuses Windows', () => {
    expect(desktopPackRefusal('win32')).toBe(REFUSAL);
  });

  // macOS has symbolic links and file modes, but not GNU tar, and nothing proves a pack there.
  it('refuses macOS', () => {
    expect(desktopPackRefusal('darwin')).toBe(REFUSAL);
  });

  it('lets Linux pack', () => {
    expect(desktopPackRefusal('linux')).toBeNull();
  });
});

describe('uploadFailureMessage', () => {
  const text = uploadFailureMessage('0.1.11', [MAC, 'SHA256SUMS'], 'dist/desktop');

  // The operator has to know exactly which files the release lacks.
  it('names every missing file', () => {
    expect(text).toContain(MAC);
    expect(text).toContain('SHA256SUMS');
    expect(text).not.toContain(LINUX);
  });

  // The release is public by now. Rolling the tag back would leave the images public and remove
  // the record, so the message says the tag stays.
  it('says the release and its tag are public and are not rolled back', () => {
    expect(text).toContain('v0.1.11');
    expect(text).toContain('public');
    expect(text).toContain('not rolled back');
  });

  // Copied straight into a shell, so it holds the full path of each missing file and --clobber,
  // which replaces a file that half arrived.
  it('gives the gh release upload command to finish by hand', () => {
    expect(text).toContain(
      `gh release upload v0.1.11 dist/desktop/v0.1.11/${MAC} dist/desktop/v0.1.11/SHA256SUMS --clobber`,
    );
  });
});

describe('missingDesktopAssets', () => {
  // The release's own files are on it too. Only the four desktop names matter here.
  it('gives nothing when all four are published', () => {
    expect(missingDesktopAssets('0.1.11', ['latest.json', WINDOWS, 'SHA256SUMS', LINUX, 'docker-compose.yml', MAC])).toEqual([]);
  });

  it('gives the names that are not published', () => {
    expect(missingDesktopAssets('0.1.11', ['latest.json', LINUX, 'docker-compose.yml'])).toEqual([MAC, WINDOWS, 'SHA256SUMS']);
  });

  // An archive from another version on the release does not count for this one.
  it('does not count an archive for another version', () => {
    expect(missingDesktopAssets('0.1.11', [LINUX, MAC, 'openldr-desktop-0.1.10-win32-x64.zip', 'SHA256SUMS'])).toEqual([WINDOWS]);
  });

  // Nothing read back, for example when the read failed: every file counts as missing.
  it('gives all four when nothing is published', () => {
    expect(missingDesktopAssets('0.1.11', [])).toEqual([LINUX, MAC, WINDOWS, 'SHA256SUMS']);
  });
});
