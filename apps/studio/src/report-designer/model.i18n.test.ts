import { describe, it, expect } from 'vitest';
import { setI18nText } from './model';
import type { ReportTemplate } from './types';

const base: ReportTemplate = {
  id: 'd1', name: 'D', status: 'draft', paper: 'A4', orientation: 'portrait', parameters: [],
  pages: [{ id: 'p1', elements: [{ id: 'e1', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'Hello' }] }],
};

describe('setI18nText', () => {
  it('writes the override under the language and the element id', () => {
    const next = setI18nText(base, 'fr', 'e1', 'Bonjour');
    expect(next.i18n).toEqual({ fr: { e1: 'Bonjour' } });
    expect(base.i18n).toBeUndefined();   // the input is untouched
  });

  it('keeps other languages and other keys when one is set', () => {
    const one = setI18nText(base, 'fr', 'e1', 'Bonjour');
    const two = setI18nText(one, 'pt', 'e1', 'Olá');
    expect(two.i18n).toEqual({ fr: { e1: 'Bonjour' }, pt: { e1: 'Olá' } });
  });

  // ⛔ The fallback contract: an emptied field must DELETE the entry, never store ''. An empty
  // string would render as a blank heading rather than the authored text.
  it('deletes the entry, the language and the whole map as they empty out', () => {
    const one = setI18nText(base, 'fr', 'e1', 'Bonjour');
    const two = setI18nText(one, 'fr', 'e2', 'Salut');
    expect(setI18nText(two, 'fr', 'e2', '').i18n).toEqual({ fr: { e1: 'Bonjour' } });
    expect(setI18nText(one, 'fr', 'e1', '').i18n).toBeUndefined();
    expect('i18n' in setI18nText(one, 'fr', 'e1', '')).toBe(false);
  });

  it('clearing an absent entry leaves the design without an i18n key', () => {
    expect('i18n' in setI18nText(base, 'fr', 'e1', '')).toBe(false);
  });
});
