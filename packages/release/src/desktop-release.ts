// The decisions behind the desktop packages in `pnpm release`: which files a release carries,
// which host may build them, which ones a published release lacks, and what to say when an
// upload failed. scripts/release.ts builds, packs, uploads and reads the release back. Everything
// here is pure and tested.

import { DESKTOP_SYSTEMS, archiveName } from './desktop-pack';

export const SHA256SUMS_NAME = 'SHA256SUMS';

/** The four file names a release carries for the desktop app. */
export function desktopAssetNames(version: string): string[] {
  return [...DESKTOP_SYSTEMS.map((s) => archiveName(version, s)), SHA256SUMS_NAME];
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

/** What to print when an upload failed after the release was created.
 *
 *  `outDir` is the folder that holds `v<version>/`, as the pack writes it, relative to the repo
 *  root: the message tells the operator to run the command from there. The file names never hold
 *  a space (`sha256SumsText` refuses one), so the command needs no quotes. */
export function uploadFailureMessage(version: string, missing: readonly string[], outDir: string): string {
  const tag = `v${version}`;
  const paths = missing.map((name) => `${outDir}/${tag}/${name}`);
  return [
    `⛔ the release ${tag} is public, but these desktop files are not on it:`,
    ...missing.map((name) => `  ${name}`),
    `The release and its tag are public and are not rolled back: the images are already public,`,
    'so deleting the tag would remove the record and leave them. Upload the files by hand instead,',
    'from the repo root:',
    `  gh release upload ${tag} ${paths.join(' ')} --clobber`,
  ].join('\n');
}

/** The assets a published release lacks, from the names `gh release view` reports. */
export function missingDesktopAssets(version: string, publishedNames: readonly string[]): string[] {
  const published = new Set(publishedNames);
  return desktopAssetNames(version).filter((name) => !published.has(name));
}
