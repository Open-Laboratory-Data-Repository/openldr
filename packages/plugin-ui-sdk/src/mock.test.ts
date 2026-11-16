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
    expect(started).toMatchObject({ id: 'mock-check', copyId: 'cp1', referenceCopyId: null, status: 'queued' });
    expect(started).not.toHaveProperty('driver');
    expect(await api.imports.check.list()).toEqual([]);
    expect(await api.imports.check.status('mock-check')).toBeNull();
    expect(await api.imports.check.stop('mock-check')).toMatchObject({ id: 'mock-check', status: 'stopping' });
    expect(await api.imports.check.held({ copyId: 'cp1', offset: 0, limit: 10 })).toEqual({ rows: [], total: 0 });
    expect(await api.imports.check.heldItem({ copyId: 'cp1', key: 'REQ1' })).toBeNull();
  });
  it('reports.list returns the seeded fixture', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:reports'], reports: [{ id: 'r1' }] });
    expect(await api.reports.list()).toEqual([{ id: 'r1' }]);
  });
});
