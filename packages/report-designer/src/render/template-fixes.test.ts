import { describe, it, expect } from 'vitest';
import { renderReportDesignPdf } from './index';
import type { DesignElement, ReportDesign } from '../schema';

const NOW = new Date('2026-09-01T10:00:00Z');
const normalize = (buf: Buffer): string => buf.toString('latin1')
  .replace(/\(D:\d+Z?\)/g, '(D:X)')
  .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [X]');

const design = (elements: DesignElement[]): ReportDesign => ({
  id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', status: 'draft',
  parameters: [], pages: [{ id: 'p1', elements }],
});

describe('T1: an unset logo prints nothing', () => {
  const keep: DesignElement = { id: 'k', kind: 'text', name: 'k', rect: { x: 0, y: 100, w: 200, h: 20 }, text: 'kept' };

  it('an image whose token resolves to empty is absent from the page', async () => {
    const logo: DesignElement = { id: 'lg', kind: 'image', name: 'logo', rect: { x: 0, y: 20, w: 54, h: 54 }, src: '{{lab.logo}}' };
    const withLogoSlot = await renderReportDesignPdf(design([logo, keep]), new Map(), { now: NOW }); // no identity
    const without = await renderReportDesignPdf(design([keep]), new Map(), { now: NOW });
    expect(normalize(withLogoSlot)).toBe(normalize(without));
  });

  it('a src that resolves but cannot draw still gets the dashed defect box', async () => {
    const broken: DesignElement = { id: 'lg', kind: 'image', name: 'logo', rect: { x: 0, y: 20, w: 54, h: 54 }, src: 'data:image/png;base64,not-an-image' };
    const withBroken = await renderReportDesignPdf(design([broken, keep]), new Map(), { now: NOW });
    const without = await renderReportDesignPdf(design([keep]), new Map(), { now: NOW });
    expect(normalize(withBroken)).not.toBe(normalize(without));
  });
});

import zlib from 'node:zlib';
function decodedContent(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  let out = '';
  while ((m = streams.exec(raw))) {
    try { out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { /* not flate */ }
  }
  return out;
}

describe('T2: authored border widths convert px to pt like fontSize', () => {
  it('a line authored at strokeWidth 2 px draws at 1.5 pt', async () => {
    const line: DesignElement = { id: 'ln', kind: 'line', name: 'ln', rect: { x: 0, y: 50, w: 200, h: 0 }, style: { strokeWidth: 2, strokeColor: '#000000' } };
    const content = decodedContent(await renderReportDesignPdf(design([line]), new Map(), { now: NOW }));
    expect(content).toContain('1.5 w');
    expect(content).not.toContain('\n2 w');
  });

  it('a rect authored at strokeWidth 1 px draws at 0.75 pt', async () => {
    const rect: DesignElement = { id: 'rc', kind: 'rect', name: 'rc', rect: { x: 0, y: 50, w: 100, h: 40 }, style: { strokeWidth: 1, strokeColor: '#000000' } };
    const content = decodedContent(await renderReportDesignPdf(design([rect]), new Map(), { now: NOW }));
    expect(content).toContain('0.75 w');
  });
});
