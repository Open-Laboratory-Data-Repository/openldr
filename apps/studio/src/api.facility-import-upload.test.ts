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
});
