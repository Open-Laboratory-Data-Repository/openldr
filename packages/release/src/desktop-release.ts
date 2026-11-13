// The decisions behind the desktop packages in `pnpm release`: which files a release carries,
// which host may build them, which ones the pack folder or a published release lacks, and what to
// say when an upload failed. scripts/release.ts builds, packs, uploads and reads the release back.
// Everything here is pure and tested.

import { DESKTOP_SYSTEMS, archiveName } from './desktop-pack';

export const SHA256SUMS_NAME = 'SHA256SUMS';

/** The three archive names, one per system. */
export function desktopArchiveNames(version: string): string[] {
  return DESKTOP_SYSTEMS.map((s) => archiveName(version, s));
}

/** The four file names a release carries for the desktop app, SHA256SUMS first.
 *
 *  The install script picks the newest release that lists an archive for its system, then needs
 *  SHA256SUMS. So SHA256SUMS goes onto a release before any archive, and everything that lists
 *  the four keeps that order. */
export function desktopAssetNames(version: string): string[] {
  return [SHA256SUMS_NAME, ...desktopArchiveNames(version)];
}

/** Why the desktop packages cannot be built on this host, or null.
 *
 *  The pack copies symbolic links and file modes into the macOS and Linux archives and calls
 *  GNU tar, so only Linux is proven to make them. The release has run on Windows before; from
 *  this change it stops there, before anything is pushed. */
export function desktopPackRefusal(platform: NodeJS.Platform): string | null {
  if (platform === 'linux') return null;
  return 'The desktop packages are built on Linux. Other systems cannot make them: the macOS and Linux packages need symbolic links, file modes and GNU tar. Run the release on the Linux release machine.';
}

/** Which of the four files the pack folder lacks, from the names found in it. */
export function missingDesktopFiles(version: string, namesOnDisk: readonly string[]): string[] {
  const found = new Set(namesOnDisk);
  return desktopAssetNames(version).filter((name) => !found.has(name));
}

/** The commands that upload `names` by hand. gh may send the files of one call in any order, so
 *  SHA256SUMS gets its own command, first, when an archive goes too. */
function uploadCommands(version: string, names: readonly string[], outDir: string): string[] {
  const tag = `v${version}`;
  const command = (group: readonly string[]): string =>
    `  gh release upload ${tag} ${group.map((name) => `${outDir}/${tag}/${name}`).join(' ')} --clobber`;
  const archives = names.filter((name) => name !== SHA256SUMS_NAME);
  if (!names.includes(SHA256SUMS_NAME)) return [command(archives)];
  if (archives.length === 0) return [command([SHA256SUMS_NAME])];
  return [command([SHA256SUMS_NAME]), command(archives)];
}

/** The lines both upload messages end with: why the tag stays, and how to finish. */
function finishByHand(version: string, names: readonly string[], outDir: string): string[] {
  return [
    'The release and its tag are public and are not rolled back: the images are already public,',
    'so deleting the tag would remove the record and leave them. A re-run refuses, because the',
    'tag exists. Upload the files already in the pack folder by hand, from the repo root, and',
    'do not pack again first: a new pack makes new bytes that would not match a SHA256SUMS',
    'already on the release.',
    ...uploadCommands(version, names, outDir),
  ];
}

/** What to print when an upload failed after the release was created.
 *
 *  `outDir` is the folder that holds `v<version>/`, as the pack writes it, relative to the repo
 *  root: the message tells the operator to run the command from there. The file names never hold
 *  a space (`sha256SumsText` refuses one), so the command needs no quotes. */
export function uploadFailureMessage(version: string, missing: readonly string[], outDir: string): string {
  return [
    `⛔ the release v${version} is public, but these desktop files are not on it:`,
    ...missing.map((name) => `  ${name}`),
    ...finishByHand(version, missing, outDir),
  ].join('\n');
}

/** What to print when the release could not be read back after the upload.
 *
 *  Nobody knows which files arrived, so this does not claim any is missing. It gives the commands
 *  for all four; `--clobber` makes sending one that did arrive safe. */
export function uploadUnconfirmedMessage(version: string, outDir: string): string {
  return [
    `⛔ the release v${version} is public, but it could not be read back, so its desktop files could not be confirmed.`,
    ...finishByHand(version, desktopAssetNames(version), outDir),
  ].join('\n');
}

/** The assets a published release lacks, from the names `gh release view` reports. */
export function missingDesktopAssets(version: string, publishedNames: readonly string[]): string[] {
  const published = new Set(publishedNames);
  return desktopAssetNames(version).filter((name) => !published.has(name));
}
