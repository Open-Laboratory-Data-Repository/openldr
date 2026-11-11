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
  'marketplace-permissions': 'Marketplace permission checks',
  'plugin-sites': 'Plugin cards and side panels',
  'load-data': 'Load & push data',
  facilities: 'Facilities',
  'test-catalog': 'Test catalog',
  patients: 'Patients',
  forms: 'Form submissions',
  'workflow-navigation': 'Workflow canvas navigation',
  'workflow-webhooks': 'Workflow webhooks',
  'query-naming': 'Query names',
  'query-export-import': 'Export and import queries',
  'query-groups': 'Query groups',
  dashboard: 'Dashboards',
  reports: 'Reports',
  query: 'Custom queries',
  workflows: 'Workflows',
  'dashboard-refresh': 'Dashboard refresh',

  'dashboard-limits': 'Dashboard query limits',
  'query-pagination': 'Query result paging',

  'connector-query-deadlines': 'Connector query deadlines',
  'connector-diagnose': 'SQL Server connections and diagnosis',
  'v1-import': 'Import from OpenLDR v1',
  'setup-checks': 'Setup checks',
  'user-preferences': 'User preferences',
  layouts: 'Layouts',
  'report-schedules': 'Report schedules',
  laboratory: 'Laboratory setup',
  'data-exposure': 'Data exposure',
  activity: 'Activity and payload history',
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
  { slug: 'load-data' },
  { slug: 'facilities' },
  { slug: 'test-catalog' },
  { slug: 'patients' },
  { slug: 'forms' },
  { slug: 'workflow-navigation' },
  { slug: 'workflow-webhooks' },
  { slug: 'query-naming' },
  { slug: 'query-export-import' },
  { slug: 'query-groups' },
  { slug: 'dashboard' },
  { slug: 'reports' },
  { slug: 'query' },
  { slug: 'workflows' },
  { slug: 'dashboard-refresh' },

  { slug: 'dashboard-limits' },
  { slug: 'query-pagination' },

  { slug: 'connector-query-deadlines' },
  { slug: 'connector-diagnose' },
  { slug: 'v1-import' },
  { slug: 'setup-checks' },
  { slug: 'user-preferences' },
  { slug: 'layouts' },
  { slug: 'plugin-sites' },
  { slug: 'report-schedules' },
  { slug: 'laboratory' },
  { slug: 'data-exposure' },
  { slug: 'activity' },
  { slug: 'requirements' },
  { slug: 'install', children: ['windows-server', 'upgrading'] },
  { slug: 'environment' },
  { slug: 'auth-providers' },
  { slug: 'development' },
  { slug: 'cli' },
];

// --- Long guides shared with the in-app docs -------------------------------------------------
//
// A studio section's long guide is written once, per language, in the in-app docs
// (apps/studio/src/docs/<version>/<locale>/<slug>.md). The web page for that section renders
// the same file, so the two can never drift. Its screenshots and clips come from the same
// folder too, so the website and the app show identical pictures.

export type GuideLocale = 'en' | 'fr' | 'pt';
export const GUIDE_LOCALES: Array<{ id: GuideLocale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'pt', label: 'Português' },
];

/** Web slug → in-app guide slug, for the pages that show a shared long guide. */
export const SHARED_GUIDES: Record<string, string> = {
  dashboard: 'dashboard',
  reports: 'reports',
  query: 'query',
  workflows: 'workflows',
  activity: 'activity',
  patients: 'patients',
  laboratory: 'laboratory',
  'data-exposure': 'data-exposure',
  'test-catalog': 'test-catalog',
  facilities: 'facilities',
  forms: 'forms',
  'connector-diagnose': 'connector-diagnose',
  'v1-import': 'v1-import',
  'setup-checks': 'setup-checks',
  'user-preferences': 'user-preferences',
};

const guideFiles = import.meta.glob('../../../studio/src/docs/*/*/*.md', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

// GUIDES[version][locale][slug] = markdown
const GUIDES: Record<string, Record<string, Record<string, string>>> = {};
for (const [path, content] of Object.entries(guideFiles)) {
  const match = path.match(/\/docs\/([^/]+)\/([^/]+)\/([^/]+)\.md$/);
  if (!match) continue;
  const [, version, locale, slug] = match;
  ((GUIDES[version] ??= {})[locale] ??= {})[slug] = content;
}

/**
 * The shared long guide for a web slug, in the reader's language. Falls back to English when a
 * translation is missing, and to the newest older guide version when this version has none.
 */
export function guideBody(
  slug: string,
  version: string,
  locale: GuideLocale,
): { body: string; localeUsed: GuideLocale } | null {
  const guideSlug = SHARED_GUIDES[slug];
  if (!guideSlug) return null;
  const versions = Object.keys(GUIDES).sort((a, b) => compareVersions(b, a));
  const match = GUIDES[version] ? version : versions.find((v) => compareVersions(v, version) <= 0) ?? versions[0];
  const bucket = (match && GUIDES[match]) || {};
  const localized = bucket[locale]?.[guideSlug];
  if (localized != null) return { body: localized, localeUsed: locale };
  const english = bucket.en?.[guideSlug];
  return english != null ? { body: english, localeUsed: 'en' } : null;
}

const mediaUrls = import.meta.glob('../../../studio/src/docs/0.1.0/screenshots/*.{png,mp4}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const MEDIA: Record<string, string> = Object.fromEntries(
  Object.entries(mediaUrls).map(([path, url]) => [path.split('/').pop() ?? path, url]),
);

/** A guide's bare media name (`dashboard-tour.png`) → its bundled url. Absolute paths pass through. */
export function resolveMedia(src: string): string | null {
  if (/^https?:\/\//.test(src) || src.startsWith('/')) return src;
  return MEDIA[src] ?? null;
}

/** Markdown body for a slug at a version, falling back to the newest authored version. */
export function docBody(slug: string, version: string): string | null {
  const bucket = BY_VERSION[version] ?? BY_VERSION[DOC_VERSIONS[0]] ?? {};
  return bucket[slug] ?? null;
}
