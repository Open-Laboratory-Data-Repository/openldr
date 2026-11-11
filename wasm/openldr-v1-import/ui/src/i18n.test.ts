import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { bundles, resetLocale, t } from './i18n';

function setLocale(locale: string) {
  resetLocale();
  (window as unknown as { openldr: unknown }).openldr = createMockOpenldr({ pluginId: 'openldr-v1-import', locale });
}

describe('v1 import page strings', () => {
  afterEach(() => resetLocale());

  it('has the same keys in fr and pt as in en, and no empty string', () => {
    const enKeys = Object.keys(bundles.en).sort();
    for (const locale of ['fr', 'pt'] as const) {
      expect(Object.keys(bundles[locale]).sort()).toEqual(enKeys);
    }
    for (const locale of ['en', 'fr', 'pt'] as const) {
      expect(Object.entries(bundles[locale]).filter(([, v]) => v.trim() === '')).toEqual([]);
    }
  });

  it('uses no em dash in any language', () => {
    for (const locale of ['en', 'fr', 'pt'] as const) {
      expect(Object.values(bundles[locale]).filter((v) => v.includes('\u2014'))).toEqual([]);
    }
  });

  it('follows the host language, with a region tag, and falls back to English', () => {
    setLocale('fr-FR');
    expect(t('nav.next')).toBe('Suivant');
    setLocale('pt');
    expect(t('nav.next')).toBe('Seguinte');
    setLocale('zz');
    expect(t('nav.next')).toBe('Next');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('fills in {name} placeholders', () => {
    setLocale('en');
    expect(t('checks.tablesValue', { n: 3 })).toBe('3 of 4');
  });
});
