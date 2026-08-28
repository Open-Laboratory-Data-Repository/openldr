import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchReportOptions, fetchReportPdf, csvUrl } from './api';

afterEach(() => vi.restoreAllMocks());

describe('report api helpers', () => {
  it('csvUrl builds a query string', () => {
    expect(csvUrl('amr-resistance', { from: '2026-01-01' })).toBe('/api/reports/amr-resistance.csv?from=2026-01-01');
  });

  it('fetchReportOptions returns the option map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ facility: ['F1'] }), { status: 200 })));
    await expect(fetchReportOptions('amr-resistance')).resolves.toEqual({ facility: ['F1'] });
  });

  it('fetchReportPdf returns a Blob', async () => {
    // Two globals from different realms meet here. Under the jsdom environment `Blob` is
    // jsdom's, but `Response` is node's (jsdom ships no fetch). Node's Response does not
    // recognise a jsdom Blob as a body, so `new Response(new Blob(['%PDF']))` stringifies it
    // to the literal text "[object Blob]" and the PDF bytes never reach the helper.
    // Hand it bytes, which node's Response takes as-is.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })));
    const blob = await fetchReportPdf('amr-resistance', { from: '2026-01-01' });
    // Not toBeInstanceOf(Blob): res.blob() can only return node's Blob, which is never an
    // instance of the jsdom Blob this file's `Blob` resolves to. In a browser both are the
    // same class and the question never arises, so the class identity is an artefact of the
    // test environment. Assert the shape and the bytes, which hold in either realm.
    expect(typeof blob.arrayBuffer).toBe('function');
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(4);
    expect(await blob.text()).toBe('%PDF');
  });
});
