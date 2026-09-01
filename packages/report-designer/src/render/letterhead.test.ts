import { describe, it, expect } from 'vitest';
import { renderReportDesignPdf } from './index';
import { LETTERHEAD_H } from './letterhead';
import type { DesignElement, ReportDesign } from '../schema';

const NOW = new Date('2026-09-01T10:00:00Z');
const normalize = (buf: Buffer): string => buf.toString('latin1')
  .replace(/\(D:\d+Z?\)/g, '(D:X)')
  .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [X]');

const design = (elements: DesignElement[]): ReportDesign => ({
  id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', status: 'published',
  parameters: [], pages: [{ id: 'p1', elements }],
});

/** The block every seed carried, verbatim from simple-design.ts before F4, at origin (48, 28). */
const copiedBlock = (w: number): DesignElement[] => [
  { id: 'x-logo', kind: 'image', name: 'Lab logo', rect: { x: 48, y: 28, w: 54, h: 54 }, src: '{{lab.logo}}' },
  { id: 'x-labname', kind: 'text', name: 'Lab name', rect: { x: 112, y: 30, w: 430, h: 18 }, text: '{{lab.name}}', style: { fontSize: 13, bold: true, color: '#0f172a' } },
  { id: 'x-labaddr', kind: 'text', name: 'Lab address', rect: { x: 112, y: 48, w: 430, h: 22 }, text: '{{lab.address}}', style: { fontSize: 7.5, color: '#64748b' } },
  { id: 'x-labcontact', kind: 'text', name: 'Lab contact', rect: { x: 112, y: 71, w: 430, h: 13 }, text: '{{lab.contact}}', style: { fontSize: 7.5, color: '#64748b' } },
  { id: 'x-rule1', kind: 'line', name: 'rule1', rect: { x: 48, y: 92, w, h: 0 }, style: { strokeColor: '#cbd5e1', strokeWidth: 0.75 } },
];

const IDENTITY = { name: 'Central Public Health Laboratory', address: 'PO Box 9083, Dar es Salaam', contact: 'info@example.org' };

describe('F4: one letterhead element replaces the copied block', () => {
  it('renders byte-identical to the five copied elements, with and without identity', async () => {
    const lh: DesignElement = { id: 'x-letterhead', kind: 'letterhead', name: 'Letterhead', rect: { x: 48, y: 28, w: 698, h: LETTERHEAD_H } };
    for (const identity of [IDENTITY, undefined]) {
      const one = await renderReportDesignPdf(design([lh]), new Map(), { now: NOW, identity });
      const five = await renderReportDesignPdf(design(copiedBlock(698)), new Map(), { now: NOW, identity });
      expect(normalize(one)).toBe(normalize(five));
    }
  });

  it('the band width follows the element rect', async () => {
    const wide: DesignElement = { id: 'lh', kind: 'letterhead', name: 'L', rect: { x: 48, y: 28, w: 960, h: LETTERHEAD_H } };
    const narrow: DesignElement = { id: 'lh', kind: 'letterhead', name: 'L', rect: { x: 48, y: 28, w: 400, h: LETTERHEAD_H } };
    const a = await renderReportDesignPdf(design([wide]), new Map(), { now: NOW });
    const b = await renderReportDesignPdf(design([narrow]), new Map(), { now: NOW });
    expect(normalize(a)).not.toBe(normalize(b));
  });
});
