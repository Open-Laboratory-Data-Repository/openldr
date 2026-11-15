import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { COPY_STATUS_KEYS, SET_STATES } from './CopyPanel';
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

  // Spec 4.6. The Copy tab has two dots menus, so a screen reader must hear two names.
  it('names the Start menu and the copy card menu apart in every language', () => {
    for (const locale of ['en', 'fr', 'pt'] as const) {
      expect(bundles[locale]['copy.actions']).toBeTruthy();
      expect(bundles[locale]['copy.actions']).not.toBe(bundles[locale]['copy.menu']);
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

  // M10. The Copy tab builds these keys from a status or a state, so a missing one would show as
  // the bare key. The lists come from the page itself, and the compiler keeps them whole.
  it('has a label in every language for every copy status and set state the Copy tab can show', () => {
    const keys = [...COPY_STATUS_KEYS, ...SET_STATES.map((s) => `copy.set.${s}`)];
    // Eight statuses, and "completed with skipped requests".
    expect(COPY_STATUS_KEYS).toHaveLength(9);
    expect(SET_STATES).toHaveLength(7);
    for (const locale of ['en', 'fr', 'pt'] as const) {
      expect(keys.filter((k) => !(k in bundles[locale]))).toEqual([]);
    }
  });

  it('says a copy is being deleted while it is, and names what the delete step removes', () => {
    for (const locale of ['en', 'fr', 'pt'] as const) {
      expect(bundles[locale]['copy.deleteBody']).toContain('{rows}');
    }
    expect(bundles.en['copy.lockedDeleting']).toMatch(/is being deleted/);
    expect(bundles.en['copy.lockedDeleting']).not.toMatch(/the deleted copy/);
    expect(bundles.fr['copy.lockedDeleting']).toMatch(/en cours de suppression/);
    expect(bundles.pt['copy.lockedDeleting']).toMatch(/está a ser eliminada/);
    expect(bundles.en['copy.deleteBody']).toMatch(/Reading these rows again/);
    expect(bundles.en['copy.deleteBody']).not.toMatch(/Reading them/);
    // It is OpenLDR that tries again, not the source.
    expect(bundles.fr['copy.status.waiting']).toMatch(/OpenLDR réessaiera/);
    expect(bundles.fr['copy.status.waiting']).not.toMatch(/Elle réessaiera/);
  });
});
