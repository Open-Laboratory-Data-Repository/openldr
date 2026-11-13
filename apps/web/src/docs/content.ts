// The website's own docs: what OpenLDR is, install, setup and troubleshooting. The studio user
// guides live in the in-app docs, apps/studio/src/docs, and are not shown here.
//
// Markdown lives in ./<version>/<locale>/<slug>.md, one file per language. Each file's first
// `# ` heading is its title, so the sidebar follows the reader's language. A page with no file
// in the reader's language shows the English one. When this release has no docs folder of its
// own, the newest authored version is shown.

export type DocLocale = 'en' | 'fr' | 'pt';
export const DOC_LOCALES: Array<{ id: DocLocale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'pt', label: 'Português' },
];

const files = import.meta.glob('./*/*/*.md', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

// BY_VERSION[version][locale][slug] = markdown
const BY_VERSION: Record<string, Record<string, Record<string, string>>> = {};
for (const [path, content] of Object.entries(files)) {
  const match = path.match(/^\.\/([^/]+)\/([^/]+)\/([^/]+)\.md$/);
  if (!match) continue;
  const [, version, locale, slug] = match;
  ((BY_VERSION[version] ??= {})[locale] ??= {})[slug] = content;
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

/** Sidebar structure; `children` render indented under their parent. */
export const NAV: Array<{ slug: string; children?: string[] }> = [
  { slug: 'getting-started' },
  { slug: 'requirements' },
  { slug: 'install', children: ['windows-server', 'standalone', 'desktop-app', 'upgrading'] },
  { slug: 'environment' },
  { slug: 'auth-providers' },
  { slug: 'load-data' },
  { slug: 'v1-import' },
  { slug: 'connector-diagnose' },
  { slug: 'cli', children: ['cli-access'] },
  { slug: 'development' },
];

const SLUGS = new Set(NAV.flatMap((item) => [item.slug, ...(item.children ?? [])]));

/** True when the website has this page. */
export function isDocSlug(slug: string): boolean {
  return SLUGS.has(slug);
}

/**
 * A page's markdown in the reader's language, or in English when it has no translation.
 * Null when the page is not on the website or this version does not have it.
 */
export function docPage(
  slug: string,
  version: string,
  locale: DocLocale,
): { body: string; localeUsed: DocLocale } | null {
  if (!SLUGS.has(slug)) return null;
  const bucket = BY_VERSION[version] ?? BY_VERSION[DOC_VERSIONS[0]] ?? {};
  const localized = bucket[locale]?.[slug];
  if (localized != null) return { body: localized, localeUsed: locale };
  const english = bucket.en?.[slug];
  return english != null ? { body: english, localeUsed: 'en' } : null;
}

/** The page's own `# Title` in the reader's language, else in English, else its slug. */
export function pageTitle(slug: string, version: string, locale: DocLocale): string {
  const body = docPage(slug, version, locale)?.body ?? docPage(slug, DOC_VERSIONS[0] ?? version, locale)?.body;
  const match = body ? /^\s*#\s+(.+)$/m.exec(body) : null;
  return match ? match[1].trim() : slug;
}

/** A page's picture or clip. Only site paths (`/docs-images/...`) and full URLs resolve. */
export function resolveMedia(src: string): string | null {
  return /^https?:\/\//.test(src) || src.startsWith('/') ? src : null;
}
