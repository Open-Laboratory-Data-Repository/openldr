// Versioned docs content. Markdown lives in ./<version>/<slug>.md; this module discovers
// the authored versions, exposes the current one (from the app package version, injected
// as __APP_VERSION__), and falls back to the latest authored version when this release
// has no folder of its own — so a release ahead of its docs still shows the newest set.

const files = import.meta.glob('./*/*.md', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

// BY_VERSION[version][slug] = markdown
const BY_VERSION: Record<string, Record<string, string>> = {};
for (const [path, content] of Object.entries(files)) {
  const match = path.match(/^\.\/([^/]+)\/([^/]+)\.md$/);
  if (!match) continue;
  const [, version, slug] = match;
  (BY_VERSION[version] ??= {})[slug] = content;
}

/** Compare two dotted version strings; returns >0 when `a` is newer than `b`. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

/** Authored doc versions, newest first. */
export const DOC_VERSIONS: string[] = Object.keys(BY_VERSION).sort((a, b) =>
  compareVersions(b, a),
);

/** Version shown by default: this release if authored, else the newest authored version. */
export const DEFAULT_DOC_VERSION: string =
  DOC_VERSIONS.find((version) => version === APP_VERSION) ?? DOC_VERSIONS[0] ?? APP_VERSION;

/** Page titles (stable across versions). */
export const TITLES: Record<string, string> = {
  'getting-started': 'Getting started',
  'load-data': 'Load & push data',
  'connector-diagnose': 'SQL Server connections and diagnosis',
  'v1-import': 'Import from OpenLDR v1',
  requirements: 'Requirements',
  install: 'Install',
  upgrading: 'Planned upgrades',
  'windows-server': 'Windows Server',
  environment: 'Environment variables',
  'auth-providers': 'Authentication providers',
  development: 'Development',
  cli: 'Command-line interface (CLI)',
};

/** Sidebar structure; `children` render indented under their parent. */
export const NAV: Array<{ slug: string; children?: string[] }> = [
  { slug: 'getting-started' },
  { slug: 'requirements' },
  { slug: 'install', children: ['windows-server', 'upgrading'] },
  { slug: 'environment' },
  { slug: 'auth-providers' },
  { slug: 'load-data' },
  { slug: 'v1-import' },
  { slug: 'connector-diagnose' },
  { slug: 'cli' },
  { slug: 'development' },
];

// The website's own pages only. The studio user guides (dashboards, reports, forms and the rest)
// live in the in-app docs, apps/studio/src/docs, and are not shown here.

export type DocLocale = 'en' | 'fr' | 'pt';
export const DOC_LOCALES: Array<{ id: DocLocale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'pt', label: 'Português' },
];

/** A page's picture or clip. Only site paths (`/docs-images/...`) and full URLs resolve. */
export function resolveMedia(src: string): string | null {
  return /^https?:\/\//.test(src) || src.startsWith('/') ? src : null;
}

/** Markdown body for a slug at a version, falling back to the newest authored version. */
export function docBody(slug: string, version: string): string | null {
  const bucket = BY_VERSION[version] ?? BY_VERSION[DOC_VERSIONS[0]] ?? {};
  return bucket[slug] ?? null;
}
