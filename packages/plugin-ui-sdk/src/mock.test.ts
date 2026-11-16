import { describe, it, expect } from 'vitest';
import { createMockOpenldr } from './mock';

describe('createMockOpenldr', () => {
  it('round-trips storage in-memory and resolves ready', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:reports'] });
    await api.ready;
    await api.storage.put('c', 'k', { n: 1 });
    expect(await api.storage.get('c', 'k')).toEqual({ n: 1 });
    const list = await api.storage.list('c');
    expect(list).toEqual([{ collection: 'c', key: 'k', doc: { n: 1 } }]);
  });
  it('has every copy call, and start answers with a run', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:import'] });
    const started = await api.imports.copy.start({ connectorId: 'c1', options: {} });
    expect(started.run).toMatchObject({ id: 'mock-copy', status: 'queued' });
    expect(started.changedSets).toBeUndefined();
    expect(await api.imports.copy.list()).toEqual([]);
    expect(await api.imports.copy.status('mock-copy')).toBeNull();
    expect(await api.imports.copy.stop('mock-copy')).toMatchObject({ id: 'mock-copy', status: 'stopping' });
    expect(await api.imports.copy.remove('mock-copy')).toMatchObject({ id: 'mock-copy', status: 'deleting' });
  });
  it('has every check call, and start answers with a queued run', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:import'] });
    const started = await api.imports.check.start({ copyId: 'cp1', referenceCopyId: null, options: {} });
    expect(started).toMatchObject({ id: 'mock-check', copyId: 'cp1', referenceCopyId: null, status: 'queued', laboratories: [] });
    expect(started).not.toHaveProperty('driver');
    expect(await api.imports.check.list()).toEqual([]);
    expect(await api.imports.check.status('mock-check')).toBeNull();
    expect(await api.imports.check.stop('mock-check')).toMatchObject({ id: 'mock-check', status: 'stopping' });
    expect(await api.imports.check.held({ copyId: 'cp1', offset: 0, limit: 10 })).toEqual({ rows: [], total: 0 });
    expect(await api.imports.check.held({ copyId: 'cp1', laboratory: 'LAB-1', offset: 0, limit: 10 })).toEqual({ rows: [], total: 0 });
    expect(await api.imports.check.heldItem({ copyId: 'cp1', key: 'REQ1' })).toBeNull();
    expect(await api.imports.check.heldItems({ copyId: 'cp1', offset: 0, limit: 200 })).toEqual({ items: [], total: 0 });
  });
  it('files.download records each call so a test can read it', async () => {
    const api = createMockOpenldr({ pluginId: 'p1' });
    expect(api.downloads).toEqual([]);
    await expect(api.files.download({ filename: 'held.csv', mime: 'text/csv', text: 'a,b' })).resolves.toBeUndefined();
    await api.files.download({ filename: 'held.json', mime: 'application/json', text: '[]' });
    expect(api.downloads).toEqual([
      { filename: 'held.csv', mime: 'text/csv', text: 'a,b' },
      { filename: 'held.json', mime: 'application/json', text: '[]' },
    ]);
  });
  it('files.download refuses what the host refuses, and does not record it', async () => {
    const api = createMockOpenldr({ pluginId: 'p1' });
    await expect(api.files.download({ filename: '../held.csv', mime: 'text/csv', text: '' })).rejects.toThrow('download refused: bad file name');
    await expect(api.files.download({ filename: 'held.csv', mime: 'application/json', text: '' })).rejects.toThrow('download refused: the name does not fit the type');
    expect(api.downloads).toEqual([]);
  });
  it('themeTokens is empty by default and carries what the test passes', () => {
    expect(createMockOpenldr({ pluginId: 'p1' }).themeTokens).toEqual({});
    const api = createMockOpenldr({ pluginId: 'p1', themeTokens: { '--openldr-bg': '#000' } });
    expect(api.themeTokens).toEqual({ '--openldr-bg': '#000' });
  });
  it('reports.list returns the seeded fixture', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:reports'], reports: [{ id: 'r1' }] });
    expect(await api.reports.list()).toEqual([{ id: 'r1' }]);
  });
});
