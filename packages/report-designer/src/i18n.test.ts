import { describe, it, expect } from 'vitest';
import { resolveI18n, i18nKeyForColumn, i18nKeyForPair } from './i18n';
import type { ReportDesign } from './schema';

const design = (i18n?: ReportDesign['i18n']): ReportDesign => ({
  id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', status: 'published', parameters: [],
  i18n,
  pages: [{ id: 'p1', elements: [
    { id: 'title', kind: 'text', name: 'Title', rect: { x: 0, y: 0, w: 100, h: 20 }, text: 'Monthly Summary' },
    { id: 'panel', kind: 'keyvalue', name: 'Panel', rect: { x: 0, y: 30, w: 100, h: 40 }, text: 'ORGANISM ISOLATED' },
    { id: 'code', kind: 'barcode', name: 'Code', rect: { x: 0, y: 80, w: 100, h: 30 }, text: 'TZ0013538' },
    { id: 'tbl', kind: 'table', name: 'T', rect: { x: 0, y: 120, w: 200, h: 60 },
      dataSource: { kind: 'custom-query', queryId: 'q' },
      boundColumns: [{ key: 'lab', label: 'Laboratory' }, { key: 'n', label: 'Count' }] },
    // The seeded scope panel's shape: STATIC pairs, one prose value and two token values
    // (see simple-design.ts:124 for why a scope panel cannot be bound instead).
    { id: 'scope', kind: 'keyvalue', name: 'Scope', rect: { x: 0, y: 200, w: 300, h: 60 },
      rows: [['Reporting period', '{{param.from}} – {{param.to}}'], ['Metric', 'Tested and %R per antibiotic'], ['Generated', '{{date}}']] },
  ] }],
});

describe('resolveI18n', () => {
  it('returns the design untouched when there is no map or no language', () => {
    const d = design();
    expect(resolveI18n(d, 'fr')).toBe(d);
    const withMap = design({ fr: { title: 'Résumé mensuel' } });
    expect(resolveI18n(withMap, undefined)).toBe(withMap);
    // A language with no entries is also a no-op.
    expect(resolveI18n(withMap, 'pt')).toBe(withMap);
  });

  it('overrides element text for the chosen language', () => {
    const out = resolveI18n(design({ fr: { title: 'Résumé mensuel', panel: 'ORGANISME ISOLÉ' } }), 'fr');
    expect(out.pages[0].elements[0].text).toBe('Résumé mensuel');
    expect(out.pages[0].elements[1].text).toBe('ORGANISME ISOLÉ');
  });

  it('falls back to the authored text for anything untranslated', () => {
    const out = resolveI18n(design({ fr: { title: 'Résumé mensuel' } }), 'fr');
    // panel has no French entry, so it keeps its authored text rather than printing blank.
    expect(out.pages[0].elements[1].text).toBe('ORGANISM ISOLATED');
  });

  it('NEVER translates a barcode or QR value, even when a key exists', () => {
    // A scanned code is an identifier, not prose: translating it would produce a code that scans
    // to the wrong thing, which is worse than an untranslated label.
    const out = resolveI18n(design({ fr: { code: 'MAUVAIS' } }), 'fr');
    expect(out.pages[0].elements[2].text).toBe('TZ0013538');
  });

  it('translates bound column labels through their own key', () => {
    const key = i18nKeyForColumn('tbl', 'lab');
    const out = resolveI18n(design({ fr: { [key]: 'Laboratoire' } }), 'fr');
    const cols = out.pages[0].elements[3].boundColumns!;
    expect(cols[0].label).toBe('Laboratoire');
    expect(cols[1].label).toBe('Count'); // untranslated column keeps its authored label
  });

  it('leaves the original design object untouched', () => {
    const d = design({ fr: { title: 'Résumé mensuel' } });
    resolveI18n(d, 'fr');
    expect(d.pages[0].elements[0].text).toBe('Monthly Summary');
  });
});

describe('a rendered PDF in another language', () => {
  const NOW = new Date('2026-09-01T10:00:00Z');
  const norm = (b: Buffer) => b.toString('latin1')
    .replace(/\(D:\d+Z?\)/g, '(D:X)').replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [X]');

  it('prints the override, and is byte-identical to the authored design when no language is asked for', async () => {
    const { renderReportDesignPdf } = await import('./render/index');
    const d = design({ fr: { title: 'Resume mensuel' } });
    const french = await renderReportDesignPdf(d, new Map(), { now: NOW, lang: 'fr' });
    const authored = await renderReportDesignPdf(d, new Map(), { now: NOW });
    const noMap = await renderReportDesignPdf(design(), new Map(), { now: NOW });
    expect(norm(french)).not.toBe(norm(authored));
    // Asking for no language prints exactly what a design with no map prints.
    expect(norm(authored)).toBe(norm(noMap));
  });

  it('an unknown language prints the authored text rather than failing', async () => {
    const { renderReportDesignPdf } = await import('./render/index');
    const d = design({ fr: { title: 'Resume mensuel' } });
    const sw = await renderReportDesignPdf(d, new Map(), { now: NOW, lang: 'sw' });
    const authored = await renderReportDesignPdf(d, new Map(), { now: NOW });
    expect(norm(sw)).toBe(norm(authored));
  });
});

describe('resolveI18n, static keyvalue pairs', () => {
  const scopeOf = (d: ReportDesign) => d.pages[0].elements.find((e) => e.id === 'scope')!;

  it('translates a static pair’s label and its prose value', () => {
    const out = resolveI18n(design({ fr: {
      [i18nKeyForPair('scope', 1, 'label')]: 'Indicateur',
      [i18nKeyForPair('scope', 1, 'value')]: 'Testés et %R par antibiotique',
    } }), 'fr');
    expect(scopeOf(out).rows![1]).toEqual(['Indicateur', 'Testés et %R par antibiotique']);
  });

  it('falls back per half, so a label-only entry keeps the authored value', () => {
    const out = resolveI18n(design({ fr: { [i18nKeyForPair('scope', 0, 'label')]: 'Période' } }), 'fr');
    expect(scopeOf(out).rows![0]).toEqual(['Période', '{{param.from}} – {{param.to}}']);
    // Untouched rows keep their identity, so nothing downstream re-renders for nothing.
    expect(scopeOf(out).rows![2]).toEqual(['Generated', '{{date}}']);
  });

  // Tokens are NOT special-cased: interpolation runs after resolution, so a translated value may
  // keep them and reorder the words around them. That is the whole point for a date range.
  it('keeps tokens working inside a translated value', () => {
    const out = resolveI18n(design({ fr: {
      [i18nKeyForPair('scope', 0, 'value')]: 'du {{param.from}} au {{param.to}}',
    } }), 'fr');
    expect(scopeOf(out).rows![0][1]).toBe('du {{param.from}} au {{param.to}}');
  });

  // ⛔ `rows` on a table is SAMPLE data the query replaces. Translating it would put authored text
  // where query data belongs.
  it('never touches a non-keyvalue element’s sample rows', () => {
    const d = design({ fr: { [i18nKeyForPair('sample', 0, 'label')]: 'Non' } });
    d.pages[0].elements.push({ id: 'sample', kind: 'table', name: 'S', rect: { x: 0, y: 300, w: 100, h: 40 },
      columns: ['A'], rows: [['one'], ['two']] });
    expect(resolveI18n(d, 'fr').pages[0].elements.find((e) => e.id === 'sample')!.rows).toEqual([['one'], ['two']]);
  });

  it('leaves the original rows array untouched', () => {
    const d = design({ fr: { [i18nKeyForPair('scope', 0, 'label')]: 'Période' } });
    resolveI18n(d, 'fr');
    expect(scopeOf(d).rows![0][0]).toBe('Reporting period');
  });
});

describe('the run language reaches the DATE tokens', () => {
  const NOW = new Date('2026-09-01T10:00:00Z');
  const dated: ReportDesign = {
    id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', status: 'published',
    parameters: [{ key: 'dateRange', label: 'Range', type: 'daterange', value: { from: '2026-01-01', to: '2026-06-30' } }],
    pages: [{ id: 'p1', elements: [
      { id: 'when', kind: 'text', name: 'When', rect: { x: 0, y: 0, w: 300, h: 20 }, text: '{{param.from}} · {{param.to}} · {{date}}' },
    ] }],
  };

  it('prints French month names in a date range and in {{date}}', async () => {
    const { renderReportDesignPdf } = await import('./render/index');
    const { pdfTextOf } = await import('./render/test-text');
    const fr = pdfTextOf(await renderReportDesignPdf(dated, new Map(), { now: NOW, lang: 'fr' }));
    expect(fr).toContain('1 janv. 2026');
    expect(fr).toContain('30 juin 2026');
  });

  it('with no language asked for, the bytes are exactly what they were', async () => {
    const { renderReportDesignPdf } = await import('./render/index');
    // Same normalisation as above: pdfkit stamps a real-clock CreationDate and a random /ID into
    // every render, so raw bytes never match even for identical drawing.
    const norm = (b: Buffer) => b.toString('latin1')
      .replace(/\(D:\d+Z?\)/g, '(D:X)').replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [X]');
    const a = await renderReportDesignPdf(dated, new Map(), { now: NOW });
    const b = await renderReportDesignPdf(dated, new Map(), { now: NOW, lang: 'en' });
    expect(norm(a)).toBe(norm(b));
  });
});
