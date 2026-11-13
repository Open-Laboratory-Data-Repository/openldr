import { describe, it, expect } from 'vitest';
import {
  SHA256SUMS_NAME,
  desktopArchiveNames,
  desktopAssetNames,
  desktopPackRefusal,
  missingDesktopAssets,
  missingDesktopFiles,
  uploadFailureMessage,
  uploadUnconfirmedMessage,
} from './desktop-release';

const LINUX = 'openldr-desktop-0.1.11-linux-x64.tar.gz';
const MAC = 'openldr-desktop-0.1.11-darwin-arm64.tar.gz';
const WINDOWS = 'openldr-desktop-0.1.11-win32-x64.zip';
const DIR = 'dist/desktop/v0.1.11';

describe('desktopAssetNames', () => {
  // The release uploads these four and then checks the same four are on the release. One list
  // for both means the check cannot drift from what was uploaded. SHA256SUMS comes first: the
  // install script picks a release that lists an archive and then needs SHA256SUMS, so it must
  // never see an archive without it.
  it('gives SHA256SUMS, then the three archives', () => {
    expect(desktopAssetNames('0.1.11')).toEqual(['SHA256SUMS', LINUX, MAC, WINDOWS]);
    expect(SHA256SUMS_NAME).toBe('SHA256SUMS');
  });

  // The release uploads the archives in a second call, after SHA256SUMS is on the release.
  it('gives the three archives on their own', () => {
    expect(desktopArchiveNames('0.1.11')).toEqual([LINUX, MAC, WINDOWS]);
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

describe('missingDesktopFiles', () => {
  // After the pack and before the images are pushed, the release checks the folder holds all
  // four. A file missing here would only be found after the release is public.
  it('gives nothing when the folder holds all four', () => {
    expect(missingDesktopFiles('0.1.11', [WINDOWS, 'SHA256SUMS', LINUX, MAC])).toEqual([]);
  });

  it('names each file the folder lacks', () => {
    expect(missingDesktopFiles('0.1.11', [LINUX, `${MAC}.partial`])).toEqual(['SHA256SUMS', MAC, WINDOWS]);
  });

  // Archives left over from an earlier version in the same folder do not count.
  it('does not count a file for another version', () => {
    expect(missingDesktopFiles('0.1.11', ['SHA256SUMS', LINUX, MAC, 'openldr-desktop-0.1.10-win32-x64.zip'])).toEqual([WINDOWS]);
  });
});

describe('uploadFailureMessage', () => {
  const text = uploadFailureMessage('0.1.11', [MAC], 'dist/desktop');

  // The operator has to know exactly which files the release lacks.
  it('names every missing file and no other', () => {
    const lines = text.split('\n');
    expect(lines).toContain(`  ${MAC}`);
    expect(lines).not.toContain(`  ${LINUX}`);
    expect(lines).not.toContain('  SHA256SUMS');
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
    expect(text).toContain(`gh release upload v0.1.11 ${DIR}/${MAC} --clobber`);
  });

  // gh may send the files of one call in any order. When SHA256SUMS is missing beside an
  // archive, it gets its own command, printed first, so a listed archive always has it.
  it('gives SHA256SUMS its own command first when an archive is missing too', () => {
    const both = uploadFailureMessage('0.1.11', ['SHA256SUMS', MAC, WINDOWS], 'dist/desktop');
    const sums = `gh release upload v0.1.11 ${DIR}/SHA256SUMS --clobber`;
    const archives = `gh release upload v0.1.11 ${DIR}/${MAC} ${DIR}/${WINDOWS} --clobber`;
    expect(both).toContain(sums);
    expect(both).toContain(archives);
    expect(both.indexOf(sums)).toBeLessThan(both.indexOf(archives));
  });

  it('gives one command when only SHA256SUMS is missing', () => {
    const only = uploadFailureMessage('0.1.11', ['SHA256SUMS'], 'dist/desktop');
    expect(only).toContain(`gh release upload v0.1.11 ${DIR}/SHA256SUMS --clobber`);
    expect(only.match(/gh release upload/g)).toHaveLength(1);
  });

  // The files on the release came from this pack. A new pack makes new bytes, which would not
  // match a SHA256SUMS already on the release.
  it('says to upload the files already packed, not to pack again', () => {
    expect(text).toContain('do not pack again');
  });
});

describe('uploadUnconfirmedMessage', () => {
  const text = uploadUnconfirmedMessage('0.1.11', 'dist/desktop');

  // The read-back failed, so nobody knows which files arrived. Saying they "are not on it"
  // would be a guess.
  it('says the release could not be read and the files could not be confirmed', () => {
    expect(text).toContain('could not be read');
    expect(text).toContain('could not be confirmed');
    expect(text).not.toContain('are not on it');
  });

  // The same by-hand way to finish: all four, SHA256SUMS first. --clobber makes it safe to send
  // a file that did arrive.
  it('gives the commands for all four, SHA256SUMS first', () => {
    const sums = `gh release upload v0.1.11 ${DIR}/SHA256SUMS --clobber`;
    const archives = `gh release upload v0.1.11 ${DIR}/${LINUX} ${DIR}/${MAC} ${DIR}/${WINDOWS} --clobber`;
    expect(text).toContain(sums);
    expect(text).toContain(archives);
    expect(text.indexOf(sums)).toBeLessThan(text.indexOf(archives));
  });

  it('says the release and its tag are public and are not rolled back', () => {
    expect(text).toContain('v0.1.11');
    expect(text).toContain('not rolled back');
  });
});

describe('missingDesktopAssets', () => {
  // The release's own files are on it too. Only the four desktop names matter here.
  it('gives nothing when all four are published', () => {
    expect(missingDesktopAssets('0.1.11', ['latest.json', WINDOWS, 'SHA256SUMS', LINUX, 'docker-compose.yml', MAC])).toEqual([]);
  });

  it('gives the names that are not published', () => {
    expect(missingDesktopAssets('0.1.11', ['latest.json', LINUX, 'docker-compose.yml'])).toEqual(['SHA256SUMS', MAC, WINDOWS]);
  });

  // An archive from another version on the release does not count for this one.
  it('does not count an archive for another version', () => {
    expect(missingDesktopAssets('0.1.11', [LINUX, MAC, 'openldr-desktop-0.1.10-win32-x64.zip', 'SHA256SUMS'])).toEqual([WINDOWS]);
  });

  // Nothing read back: every file counts as missing.
  it('gives all four when nothing is published', () => {
    expect(missingDesktopAssets('0.1.11', [])).toEqual(['SHA256SUMS', LINUX, MAC, WINDOWS]);
  });
});
