import { describe, it, expect } from 'vitest';
import { resolveI18n } from '@openldr/report-designer/pure';
import { SEED_DESIGNS } from './report-seeds';
import { applySeedTranslations, SEED_DESIGN_TEXT } from './design-translations';

/** Every authored string a design prints, in the order a reader meets them. */
function printedText(design: (typeof SEED_DESIGNS)[number]): string[] {
  const out: string[] = [];
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (['text', 'datetime', 'keyvalue'].includes(el.kind) && el.text) out.push(el.text);
      if (el.kind === 'keyvalue' && !el.dataSource) for (const r of el.rows ?? []) out.push(r[0] ?? '');
      for (const c of el.boundColumns ?? []) out.push(c.label);
    }
  }
  return out.filter(Boolean);
}

describe('seeded designs ship French and Portuguese', () => {
  it('every built-in carries both languages', () => {
    for (const d of SEED_DESIGNS) {
      expect(Object.keys(d.i18n ?? {}).sort(), d.id).toEqual(['fr', 'pt']);
    }
  });

  // The point of the whole slice: a French run of a built-in prints French, without an operator
  // typing anything. Asserted on the SHARED chrome, which is what all nine aggregate reports show.
  it('a French run of the AMR report prints the scope panel in French', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-resistance')!;
    const fr = printedText(resolveI18n(d, 'fr'));
    expect(fr).toContain('Taux de résistance aux antimicrobiens');
    expect(fr).toContain('Période de référence');
    expect(fr).toContain('Établissement');
    expect(fr).toContain('Généré le');
    expect(fr).toContain('Antibiotique');
    expect(fr).not.toContain('Reporting period');
  });

  it('and the same report in Portuguese', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-resistance')!;
    const pt = printedText(resolveI18n(d, 'pt'));
    expect(pt).toContain('Taxa de resistência antimicrobiana');
    expect(pt).toContain('Período de referência');
    expect(pt).toContain('Gerado em');
  });

  // ⛔ R/I/S is the coded susceptibility vocabulary, identical in every language on every AST
  // report. Inventing local codes would break every surveillance system that reads them.
  it('never translates the susceptibility codes', () => {
    for (const code of ['R', 'I', 'S', '%R']) expect(SEED_DESIGN_TEXT[code]).toBeUndefined();
    const glass = SEED_DESIGNS.find((x) => x.id === 'rt-amr-glass-ris')!;
    const fr = printedText(resolveI18n(glass, 'fr'));
    for (const code of ['R', 'I', 'S']) expect(fr).toContain(code);
  });

  it('leaves an untranslatable design exactly as it was', () => {
    const plain = { ...SEED_DESIGNS[0], i18n: undefined, pages: [{ id: 'p', elements: [] }] };
    expect(applySeedTranslations(plain)).toBe(plain);
  });

  // An authored map is a deliberate decision; a generated one must never overwrite it.
  it('leaves a design that already carries a map alone', () => {
    const authored = { ...SEED_DESIGNS[0], i18n: { fr: { x: 'y' } } };
    expect(applySeedTranslations(authored).i18n).toEqual({ fr: { x: 'y' } });
  });

  // Deterministic: a re-run must produce the identical map, or the boot seeder reports drift and
  // rewrites every built-in on every boot (the T1 defect).
  it('is deterministic, so the seeder does not rewrite the built-ins on every boot', () => {
    for (const d of SEED_DESIGNS) {
      const again = applySeedTranslations({ ...d, i18n: undefined });
      expect(JSON.stringify(again.i18n), d.id).toBe(JSON.stringify(d.i18n));
    }
  });
});
