import { DEFAULT_DOC_VERSION, DOC_VERSIONS, NAV, docPage, pageTitle } from './content';

const SLUGS = NAV.flatMap((item) => [item.slug, ...(item.children ?? [])]);
const headings = (markdown: string) => markdown.split('\n').filter((line) => /^#{1,3} /.test(line)).length;

describe('website docs content', () => {
  it('opens the newest version and keeps 0.1.0', () => {
    expect(DEFAULT_DOC_VERSION).toBe('0.1.8');
    expect(DOC_VERSIONS).toContain('0.1.0');
  });

  it('has every current page in English, French and Portuguese, with the same headings', () => {
    for (const slug of SLUGS) {
      const en = docPage(slug, DEFAULT_DOC_VERSION, 'en');
      expect(en?.localeUsed, slug).toBe('en');
      for (const locale of ['fr', 'pt'] as const) {
        const page = docPage(slug, DEFAULT_DOC_VERSION, locale);
        expect(page?.localeUsed, `${slug} ${locale}`).toBe(locale);
        expect(headings(page!.body), `${slug} ${locale}`).toBe(headings(en!.body));
      }
    }
  });

  it('takes each page title from the file in the reader\'s language', () => {
    expect(pageTitle('upgrading', '0.1.8', 'en')).toBe('Planned upgrades');
    expect(pageTitle('upgrading', '0.1.8', 'fr')).toBe('Mises à niveau planifiées');
    expect(pageTitle('upgrading', '0.1.8', 'pt')).toBe('Atualizações planeadas');
  });

  it('falls back to English when an older version has no translation', () => {
    expect(docPage('install', '0.1.0', 'fr')?.localeUsed).toBe('en');
    expect(pageTitle('install', '0.1.0', 'fr')).toBe('Install');
  });

  it('has no page outside the sidebar', () => {
    expect(docPage('dashboard', DEFAULT_DOC_VERSION, 'en')).toBeNull();
  });
});
