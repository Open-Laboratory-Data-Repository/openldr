import { describe, expect, it, vi } from 'vitest';
import { startMode } from './mode';

const no = (): boolean => false;

describe('startMode', () => {
  it('uses the saved mode and never asks the launcher', async () => {
    for (const saved of ['connect', 'local'] as const) {
      const dataDir = vi.fn(async () => '/d');
      expect(await startMode({ saved, envServer: undefined, dataDir, exists: () => true })).toBe(saved);
      expect(dataDir).not.toHaveBeenCalled();
    }
  });

  it('connects when the test variable names a server, and never asks the launcher', async () => {
    const dataDir = vi.fn(async () => '/d');
    expect(await startMode({ saved: undefined, envServer: 'https://labpc:3443', dataDir, exists: () => true })).toBe('connect');
    expect(dataDir).not.toHaveBeenCalled();
  });

  it('treats an empty test variable as not set', async () => {
    expect(await startMode({ saved: undefined, envServer: '', dataDir: async () => undefined, exists: no })).toBe('ask');
    expect(await startMode({ saved: undefined, envServer: '   ', dataDir: async () => undefined, exists: no })).toBe('ask');
  });

  it('lets a saved mode win over the test variable', async () => {
    expect(await startMode({ saved: 'local', envServer: 'https://labpc:3443', dataDir: async () => '/d', exists: no })).toBe('local');
  });

  it('stays local without asking the person when the data folder holds an install', async () => {
    const seen: string[] = [];
    const exists = (path: string): boolean => {
      seen.push(path);
      return path.replace(/\\/g, '/') === '/d/standalone.json';
    };
    expect(await startMode({ saved: undefined, envServer: undefined, dataDir: async () => '/d', exists })).toBe('local');
    expect(seen.map((p) => p.replace(/\\/g, '/'))).toEqual(['/d/standalone.json']);
  });

  it('asks on a PC with no install and no saved mode', async () => {
    expect(await startMode({ saved: undefined, envServer: undefined, dataDir: async () => '/d', exists: no })).toBe('ask');
  });

  it('asks when the data folder is unknown', async () => {
    const exists = vi.fn(no);
    expect(await startMode({ saved: undefined, envServer: undefined, dataDir: async () => undefined, exists })).toBe('ask');
    expect(exists).not.toHaveBeenCalled();
  });

  it('asks when the launcher cannot be asked for its data folder', async () => {
    expect(await startMode({ saved: undefined, envServer: undefined, dataDir: async () => { throw new Error('status failed'); }, exists: () => true })).toBe('ask');
  });
});
