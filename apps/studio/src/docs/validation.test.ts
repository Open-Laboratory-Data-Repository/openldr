import { describe, expect, it } from 'vitest';
import type { DocGuide, DocSection } from './registry';
import { DOC_GUIDES, list, resolve } from './registry';
import { SCREENSHOTS } from './screenshots';
import { allHeadingIds } from './toc';
import screenshotManifest from './0.1.0/screenshot-manifest.json';
import {
  markdownImages,
  markdownLinks,
  validateDocs,
  type ScreenshotManifest,
} from './validation';

const authoredScreenshotManifest = screenshotManifest as ScreenshotManifest;

function guide(overrides: Partial<DocGuide> & Pick<DocGuide, 'slug' | 'screenshotNames'>): DocGuide {
  const base: DocGuide = {
    slug: overrides.slug,
    title: overrides.slug,
    group: 'daily-work',
    summary: `Summary for ${overrides.slug}`,
    audience: ['all-users'],
    requiredRoles: [],
    estimatedMinutes: 5,
    difficulty: 'beginner',
    relatedSlugs: [],
    screenshotNames: overrides.screenshotNames,
    status: 'published',
  };
  return { ...base, ...overrides };
}

function section(
  overrides: Partial<DocSection> & Pick<DocSection, 'slug' | 'content' | 'screenshotNames'>,
): DocSection {
  return {
    ...guide(overrides),
    content: overrides.content,
    localeUsed: 'en',
  };
}

function manifest(names: string[]): ScreenshotManifest {
  return {
    version: 1,
    viewport: { width: 1440, height: 900 },
    shots: names.map((name) => ({
      name,
      guide: name.startsWith('reports') ? 'reports' : 'dashboard',
      route: name.startsWith('reports') ? '/reports' : '/',
      purpose: `Show ${name}`,
      fixture: 'base',
      theme: 'dark',
      ready: { kind: 'selector', value: 'main' },
      steps: [],
    })),
  };
}

const validGuides = [
  guide({
    slug: 'dashboard',
    screenshotNames: ['dashboard-overview.png'],
    relatedSlugs: ['reports'],
  }),
  guide({ slug: 'reports', screenshotNames: ['reports-run-result.png'] }),
];

const validSections = [
  section({
    slug: 'dashboard',
    screenshotNames: ['dashboard-overview.png'],
    relatedSlugs: ['reports'],
    content:
      '# Dashboard\n\nSee [Reports](/docs/reports).\n\n![Dashboard overview](dashboard-overview.png)',
  }),
  section({
    slug: 'reports',
    screenshotNames: ['reports-run-result.png'],
    content: '# Reports\n\n![Report result](reports-run-result.png)',
  }),
];

describe('markdown reference parsing', () => {
  it('extracts docs links and ignores external and hash links', () => {
    expect(
      markdownLinks(
        '[Reports](/docs/reports) [Dashboard](dashboard) [External](https://example.org) [Anchor](#steps)',
      ),
    ).toEqual(['/docs/reports', 'dashboard']);
  });

  it('extracts image alt text and source', () => {
    expect(markdownImages('![Dashboard overview](dashboard-overview.png) ![](missing-alt.png)'))
      .toEqual([
        { alt: 'Dashboard overview', src: 'dashboard-overview.png' },
        { alt: '', src: 'missing-alt.png' },
      ]);
  });
});

describe('docs integrity validation', () => {
  it('accepts the authored English docs corpus and bundled screenshots', () => {
    expect(
      validateDocs(
        list('en'),
        DOC_GUIDES,
        authoredScreenshotManifest,
        Object.keys(SCREENSHOTS),
      ),
    ).toEqual([]);
  });

  it('accepts a complete synthetic docs corpus', () => {
    expect(
      validateDocs(
        validSections,
        validGuides,
        manifest(['dashboard-overview.png', 'reports-run-result.png']),
        ['dashboard-overview.png', 'reports-run-result.png'],
      ),
    ).toEqual([]);
  });

  it('reports broken internal docs links', () => {
    const errors = validateDocs(
      [
        section({
          slug: 'dashboard',
          screenshotNames: [],
          content: '# Dashboard\n\n[Missing](/docs/missing)',
        }),
      ],
      [guide({ slug: 'dashboard', screenshotNames: [] })],
      manifest([]),
      [],
    );
    expect(errors.map((error) => error.code)).toContain('broken-link');
  });

  it('reports unknown related slugs', () => {
    const errors = validateDocs(
      [section({ slug: 'dashboard', screenshotNames: [], relatedSlugs: ['missing'], content: '# Dashboard' })],
      [guide({ slug: 'dashboard', screenshotNames: [], relatedSlugs: ['missing'] })],
      manifest([]),
      [],
    );
    expect(errors.map((error) => error.code)).toContain('unknown-related-slug');
  });

  it('reports missing image alt text', () => {
    const errors = validateDocs(
      [section({ slug: 'dashboard', screenshotNames: ['dashboard-overview.png'], content: '# Dashboard\n\n![](dashboard-overview.png)' })],
      [guide({ slug: 'dashboard', screenshotNames: ['dashboard-overview.png'] })],
      manifest(['dashboard-overview.png']),
      ['dashboard-overview.png'],
    );
    expect(errors.map((error) => error.code)).toContain('missing-image-alt');
  });

  it('reports markdown images not declared by the guide', () => {
    const errors = validateDocs(
      [section({ slug: 'dashboard', screenshotNames: [], content: '# Dashboard\n\n![Alt](dashboard-overview.png)' })],
      [guide({ slug: 'dashboard', screenshotNames: [] })],
      manifest([]),
      ['dashboard-overview.png'],
    );
    expect(errors.map((error) => error.code)).toContain('undeclared-image');
  });

  it('reports guide screenshots absent from the manifest', () => {
    const errors = validateDocs(
      [section({ slug: 'dashboard', screenshotNames: ['dashboard-overview.png'], content: '# Dashboard' })],
      [guide({ slug: 'dashboard', screenshotNames: ['dashboard-overview.png'] })],
      manifest([]),
      [],
    );
    expect(errors.map((error) => error.code)).toContain('missing-manifest-shot');
  });

  it('reports manifest outputs unreferenced by guides', () => {
    const errors = validateDocs(
      [section({ slug: 'dashboard', screenshotNames: [], content: '# Dashboard' })],
      [guide({ slug: 'dashboard', screenshotNames: [] })],
      manifest(['orphan.png']),
      ['orphan.png'],
    );
    expect(errors.map((error) => error.code)).toContain('unreferenced-manifest-shot');
  });

  it('reports duplicate manifest output names', () => {
    const errors = validateDocs(
      validSections,
      validGuides,
      manifest(['dashboard-overview.png', 'dashboard-overview.png']),
      ['dashboard-overview.png'],
    );
    expect(errors.map((error) => error.code)).toContain('duplicate-manifest-shot');
  });

  it('reports any active DHIS2 reference', () => {
    const errors = validateDocs(
      [section({ slug: 'dashboard', screenshotNames: [], content: '# Dashboard\n\n[Old](/docs/dhis2)' })],
      [guide({ slug: 'dashboard', screenshotNames: [] })],
      {
        ...manifest(['dashboard-dhis2.png']),
        shots: [
          {
            ...manifest(['dashboard-dhis2.png']).shots[0],
            route: '/settings/dhis2',
            purpose: 'Show DHIS2',
          },
        ],
      },
      ['dashboard-dhis2.png'],
    );
    expect(errors.map((error) => error.code)).toContain('dhis2-reference');
  });
});

describe('authored guide structure', () => {
  const requiredHeadings = [
    '## Outcome',
    '## Before you begin',
    '## Steps',
    '## Expected result',
    '## Troubleshooting',
    '## Advanced web usage',
    '## Related guides',
  ];

  // A guide that became a long guide (it has capturedNames) is checked by the long-guide test
  // below instead, so it drops out of the short template as it is rewritten.
  function expectStepGuideStructure(slugs: string[]) {
    const long = new Set(DOC_GUIDES.filter((g) => (g.capturedNames ?? []).length > 0).map((g) => g.slug));
    for (const slug of slugs.filter((candidate) => !long.has(candidate))) {
      const resolved = resolve('en', slug);
      expect(resolved, `${slug} should resolve`).not.toBeNull();
      for (const heading of requiredHeadings) {
        expect(resolved!.content, `${slug} should contain ${heading}`).toContain(heading);
      }
    }
  }

  it('keeps the entry, dashboard, and reports guides procedural', () => {
    expectStepGuideStructure(['start-here', 'dashboard', 'reports']);
  });

  // A same-page link to a heading that does not exist scrolls nowhere, with no error.
  it('points every same-page # link at a heading on that page, in every language', () => {
    const broken: string[] = [];
    for (const locale of ['en', 'fr', 'pt'] as const) {
      for (const section of list(locale)) {
        if (section.localeUsed !== locale) continue;
        const ids = new Set(allHeadingIds(section.content));
        for (const [, id] of section.content.matchAll(/\]\(#([^)]+)\)/g)) {
          if (!ids.has(id)) broken.push(`${locale}/${section.slug}#${id}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  // Two capture tools write into one folder. A shared name means one silently overwrites the other.
  it('never gives a guide-script capture the same name as a manifest screenshot', () => {
    const manifestNames = new Set(authoredScreenshotManifest.shots.map((shot) => shot.name));
    const clashes = DOC_GUIDES.flatMap((g) => g.capturedNames ?? []).filter((name) => manifestNames.has(name));
    expect(clashes).toEqual([]);
  });

  // Long guides (those with captured screenshots and clips) teach through worked examples
  // instead of the short Outcome / Steps / Expected result template.
  it('gives every long guide examples, troubleshooting and related guides', () => {
    const long = DOC_GUIDES.filter((g) => (g.capturedNames ?? []).length > 0);
    expect(long.map((g) => g.slug)).toEqual(expect.arrayContaining(['start-here', 'dashboard', 'reports', 'query', 'workflows', 'activity', 'patients', 'users', 'roles', 'audit', 'laboratory', 'data-exposure', 'connectors', 'test-catalog', 'facilities', 'forms', 'terminology', 'report-designer', 'report-pipeline']));
    for (const g of long) {
      const content = resolve('en', g.slug)!.content;
      expect(content, `${g.slug} needs a worked example`).toMatch(/^## Example \d+: /m);
      expect(content, `${g.slug} needs troubleshooting`).toContain('## Troubleshooting');
      expect(content, `${g.slug} needs related guides`).toContain('## Related guides');
    }
  });

  it('keeps workflows forms terminology guides procedural', () => {
    expectStepGuideStructure(['workflows', 'forms', 'terminology', 'report-designer', 'report-pipeline']);
  });

  it('keeps users audit connectors marketplace guides procedural', () => {
    expectStepGuideStructure(['users', 'audit', 'connectors', 'marketplace']);
  });

  it('keeps settings as a short routing guide', () => {
    const resolved = resolve('en', 'settings');
    expect(resolved, 'settings should resolve').not.toBeNull();
    expect(resolved!.content).toContain('# Settings');
    expect(resolved!.content).toContain('/docs/connectors');
    expect(resolved!.content).toContain('/docs/marketplace');
    expect(resolved!.content).not.toMatch(/!\[[^\]]*]\(/);
  });

  it('points advanced docs to the web docs (no longer a coming-soon placeholder)', () => {
    const resolved = resolve('en', 'advanced-docs');
    expect(resolved, 'advanced-docs should resolve').not.toBeNull();
    expect(resolved!.content).toContain('# Deployment & developer docs');
    expect(resolved!.content).toContain('OpenLDR website');
    expect(resolved!.content).toContain('CLI');
    expect(resolved!.content).toContain('github.com/Open-Laboratory-Data-Repository/openldr');
    expect(resolved!.content).toContain('/docs/start-here');
    expect(resolved!.content).toContain('/docs/settings');
    expect(resolved!.content).not.toMatch(/!\[[^\]]*]\(/);
  });
});
