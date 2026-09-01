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
