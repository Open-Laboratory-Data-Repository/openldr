import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTestCatalogOptions, listTestCatalog, setCatalogTestActive, setCatalogTestEnabled, updateCatalogTest,
} from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('test catalog api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [], total: 0, ownedHere: true })));
  });

  it('sends only the filters that are set', async () => {
    await listTestCatalog({ q: 'viral', category: 'MOL', loinc: undefined, enabled: 'on', limit: 25, offset: 50 });
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog?q=viral&category=MOL&enabled=on&limit=25&offset=50');
  });

  it('asks for the plain list when no filter is set', async () => {
    await listTestCatalog();
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog');
  });

  it('reads the picker choices', async () => {
    await getTestCatalogOptions();
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/options');
  });

  it('encodes the code and sends one boolean for a row change', async () => {
    await setCatalogTestEnabled('HIV VL', true);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/HIV%20VL/enabled', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    await setCatalogTestActive('HIVVL', false);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/HIVVL/active', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: false }),
    });
  });

  it('carries the server refusal words into the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Test HIVVL is not in the catalog.', kind: 'not-found' }, 404)));
    await expect(updateCatalogTest('HIVVL', { display: 'x' })).rejects.toThrow('save test failed: Test HIVVL is not in the catalog.');
  });
});
