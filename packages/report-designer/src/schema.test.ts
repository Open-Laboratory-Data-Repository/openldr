import { describe, it, expect } from 'vitest';
import { ReportDesignSchema, BoundColumnSchema, CELL_STATUSES } from './schema';

describe('ReportDesignSchema', () => {
  it('round-trips a full design and strips unknown keys', () => {
    const d = {
      id: 'd1', name: 'Test', paper: 'A4', orientation: 'portrait',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      parameters: [{ key: 'p', label: 'P', value: 'v' }],
      pages: [{ id: 'p1', elements: [
        { id: 'e1', kind: 'text', name: 'T', rect: { x: 1, y: 2, w: 3, h: 4 }, text: 'hi', style: { bold: true, fontSize: 14 } },
        { id: 'e2', kind: 'rect', name: 'R', rect: { x: 0, y: 0, w: 9, h: 9 }, style: { fill: '#f00', strokeWidth: 2 }, junk: 1 },
      ] }],
    };
    const out = ReportDesignSchema.parse(d);
    expect(out.pages[0].elements[0].style).toEqual({ bold: true, fontSize: 14 });
    expect((out.pages[0].elements[1] as Record<string, unknown>).junk).toBeUndefined();
  });

  it('applies defaults for paper/orientation/pages/parameters', () => {
    const out = ReportDesignSchema.parse({ id: 'd', name: 'N' });
    expect(out).toMatchObject({ paper: 'A4', orientation: 'portrait', pages: [], parameters: [] });
  });

  it('rejects a design with no name', () => {
    expect(ReportDesignSchema.safeParse({ id: 'd', name: '' }).success).toBe(false);
  });

  it('round-trips the optional pageNumbers flag (default undefined)', () => {
    expect(ReportDesignSchema.parse({ id: 'd', name: 'N', pageNumbers: true }).pageNumbers).toBe(true);
    expect(ReportDesignSchema.parse({ id: 'd', name: 'N' }).pageNumbers).toBeUndefined();
  });
});

describe('ReportDesignSchema — data binding', () => {
  it('accepts a table dataSource + boundColumns', () => {
    const out = ReportDesignSchema.parse({
      id: 'd', name: 'N',
      pages: [{ id: 'p', elements: [{
        id: 'e', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 100, h: 50 },
        dataSource: { kind: 'custom-query', queryId: 'cq_1' },
        boundColumns: [{ key: 'organism', label: 'Organism' }, { key: 'pct_r', label: '%R' }],
      }] }],
    });
    const el = out.pages[0].elements[0];
    expect(el.dataSource).toEqual({ kind: 'custom-query', queryId: 'cq_1' });
    expect(el.boundColumns).toEqual([{ key: 'organism', label: 'Organism' }, { key: 'pct_r', label: '%R' }]);
  });

  it('accepts a string param and a daterange param', () => {
    const out = ReportDesignSchema.parse({
      id: 'd', name: 'N',
      parameters: [
        { key: 'facility', label: 'Facility', type: 'text', value: 'HQ' },
        { key: 'range', label: 'Range', type: 'daterange', value: { from: '2026-01-01', to: '2026-06-30' } },
      ],
    });
    expect(out.parameters[0].value).toBe('HQ');
    expect(out.parameters[1].value).toEqual({ from: '2026-01-01', to: '2026-06-30' });
  });

  it('still accepts a bare {key,label,value} param (back-compat)', () => {
    const out = ReportDesignSchema.parse({ id: 'd', name: 'N', parameters: [{ key: 'k', label: 'L', value: 'v' }] });
    expect(out.parameters[0]).toMatchObject({ key: 'k', label: 'L', value: 'v' });
  });

  it('preserves a param `required` flag through parse', () => {
    const parsed = ReportDesignSchema.parse({
      id: 'd', name: 'n',
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange', required: true }],
      pages: [],
    });
    expect(parsed.parameters[0].required).toBe(true);
  });
});

describe('BoundColumnSchema', () => {
  it('accepts a bare key/label pair (the shape every existing design uses)', () => {
    expect(BoundColumnSchema.parse({ key: 'a', label: 'A' }))
      .toEqual({ key: 'a', label: 'A' });
  });

  it('accepts statusKey, emphasis and kind', () => {
    expect(BoundColumnSchema.parse({
      key: 'result', label: 'Result', statusKey: 'result_status', emphasis: 'fill', kind: 'value',
    })).toEqual({
      key: 'result', label: 'Result', statusKey: 'result_status', emphasis: 'fill', kind: 'value',
    });
  });

  it('rejects an emphasis outside fill|text', () => {
    expect(() => BoundColumnSchema.parse({ key: 'a', label: 'A', emphasis: 'glow' })).toThrow();
  });

  it('exposes exactly the five presentational statuses', () => {
    expect(CELL_STATUSES).toEqual(['normal', 'abnormal', 'critical', 'indeterminate', 'none']);
  });
});

describe('ReportDesignSchema — sortBy', () => {
  it('keeps an element sortBy through a parse', () => {
    // ⛔ Unknown keys are STRIPPED (see the round-trip test above). An element-level sort that is
    // not declared here survives in the seed literal and vanishes the moment the design is stored
    // or re-read — the report would still render, just in whatever order the engine returned.
    const out = ReportDesignSchema.parse({
      id: 'd', name: 'N',
      pages: [{ id: 'p1', elements: [
        { id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, sortBy: 'ord' },
      ] }],
    });
    expect(out.pages[0].elements[0].sortBy).toBe('ord');
  });
});

describe('TemplateParamSchema — format and placeholder', () => {
  const parseParam = (p: Record<string, unknown>) =>
    ReportDesignSchema.parse({ id: 'd', name: 'N', parameters: [{ key: 'tz', label: 'TZ', ...p }] }).parameters[0];

  it('keeps a declared format and placeholder through a parse', () => {
    const out = parseParam({ format: 'timezone-no-signed-offset', placeholder: 'Africa/Nairobi' });
    expect(out.format).toBe('timezone-no-signed-offset');
    expect(out.placeholder).toBe('Africa/Nairobi');
  });

  it('leaves a parameter that declares neither exactly as it was', () => {
    // Every parameter authored before these fields existed. It must parse, and must not acquire
    // keys it never had.
    expect(parseParam({ value: 'v' })).toEqual({ key: 'tz', label: 'TZ', value: 'v' });
  });

  it('⛔ an UNRECOGNISED format does not make a stored design unopenable', () => {
    // Measured, not hypothetical: a dev install's `report_designs` row held `iana-timezone` — the
    // earlier name of a format, renamed once the rule behind it changed. `fromRow` (./store.ts)
    // parses every stored design on READ, so a strict enum would throw there and the design could
    // never be opened again. That is the failure `image-src.ts` documents, and this is the reason
    // `format` carries `.catch(undefined)`.
    //
    // It FAILS OPEN — the unknown format is dropped, so the value simply is not checked, which is
    // exactly the behaviour before any of this existed. The next seed writes the current name.
    const out = parseParam({ format: 'iana-timezone', placeholder: 'Africa/Nairobi' });
    expect(out.format).toBeUndefined();
    expect(out.placeholder).toBe('Africa/Nairobi');
  });
});
