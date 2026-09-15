import { describe, it, expect, beforeEach } from 'vitest';
import { uploadFacilityImport } from './api';
import type { FacilityColumnMap } from './api';

/** Mirrors `api.terminology-upload.test.ts`'s `FakeXHR` — the same XHR-based upload shape
 *  `uploadFacilityImport` uses, so the same fake stands in for the browser's `XMLHttpRequest`. */
class FakeXHR {
  static instances: FakeXHR[] = [];
  upload = { onprogress: null as null | ((e: any) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  status = 0; responseText = ''; method = ''; url = ''; headers: Record<string, string> = {}; body: any;
  constructor() { FakeXHR.instances.push(this); }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(b: any) { this.body = b; this.status = 201; this.responseText = JSON.stringify({ runId: 'fir_9' }); this.onload?.(); }
}

describe('uploadFacilityImport', () => {
  beforeEach(() => { FakeXHR.instances = []; (globalThis as any).XMLHttpRequest = FakeXHR as never; });

  it('sends the operator column map as a JSON-encoded columnMap query parameter', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'register.csv');
    const columnMap: FacilityColumnMap = {
      columns: { national_code: 'FacilityCode', name: 'FacilityName' },
      constants: {},
      extras: [],
    };
    const res = await uploadFacilityImport({
      file,
      nationalSystem: 'zm-mfl',
      format: 'csv',
      columnMap,
    });
    expect(res.runId).toBe('fir_9');
    const xhr = FakeXHR.instances[0];
    const url = new URL(xhr.url, 'http://localhost');
    const sent = url.searchParams.get('columnMap');
    expect(sent).not.toBeNull();
    expect(JSON.parse(sent as string)).toEqual(columnMap);
  });

  it('omits columnMap from the query string when the caller sends none', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'register.csv');
    await uploadFacilityImport({ file, nationalSystem: 'zm-mfl', format: 'csv' });
    const xhr = FakeXHR.instances[0];
    const url = new URL(xhr.url, 'http://localhost');
    expect(url.searchParams.has('columnMap')).toBe(false);
  });

  // Fix for the reachability regression: Source now stores the file ahead of Mapping. This flag
  // is what makes that possible. See `ImportFacilitiesSheet.tsx`'s Source footer button.
  it('sends validate=false only when the caller passes it explicitly', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'register.csv');
    await uploadFacilityImport({ file, nationalSystem: 'zm-mfl', format: 'csv', validate: false });
    const xhr = FakeXHR.instances[0];
    const url = new URL(xhr.url, 'http://localhost');
    expect(url.searchParams.get('validate')).toBe('false');
  });

  // A browser cannot unzip a workbook, so the server hands its header row back in this response.
  // Dropping those fields here would leave Mapping with no columns for every workbook.
  it('sends a workbook as format=xlsx and passes its header row back to the caller', async () => {
    const reply = {
      runId: 'fir_x', headers: ['MFL Code'], sheetName: 'Register', sheetCount: 2,
      columns: [{ header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] }],
    };
    class WorkbookXHR extends FakeXHR {
      send(b: any) { this.body = b; this.status = 202; this.responseText = JSON.stringify(reply); this.onload?.(); }
    }
    (globalThis as any).XMLHttpRequest = WorkbookXHR as never;
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'register.xlsx');

    const res = await uploadFacilityImport({ file, nationalSystem: 'zm-mfl', format: 'xlsx', validate: false });

    expect(res).toEqual(reply);
    const xhr = FakeXHR.instances[0];
    expect(new URL(xhr.url, 'http://localhost').searchParams.get('format')).toBe('xlsx');
    expect(xhr.headers['content-type']).toBe('application/octet-stream');
    expect(xhr.body).toBe(file);
  });

  it('omits validate from the query string for an ordinary upload-and-validate call', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'register.csv');
    // Neither omitting the field nor passing `true` explicitly should ever put `validate` on the
    // wire: the server's own default is already upload-and-validate (see `facilities-routes.ts`'s
    // `storeOnly`), and a caller that wants it can simply say nothing.
    await uploadFacilityImport({ file, nationalSystem: 'zm-mfl', format: 'csv', validate: true });
    const xhr = FakeXHR.instances[0];
    const url = new URL(xhr.url, 'http://localhost');
    expect(url.searchParams.has('validate')).toBe(false);
  });
});
