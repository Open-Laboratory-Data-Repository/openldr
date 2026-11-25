import { describe, it, expect, vi, beforeEach } from 'vitest';

const createAppContext = vi.fn();
vi.mock('@openldr/bootstrap', () => ({ createAppContext: (...a: unknown[]) => createAppContext(...a) }));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runPluginCall } from './plugin-call';

// A2c: a typo in --input is reported before CE starts, so it opens no database for nothing.
describe('openldr plugin call with --input that is not JSON', () => {
  beforeEach(() => { createAppContext.mockReset(); });

  it('exits 1 with the message and never starts CE', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await runPluginCall('lab', 'lab_list_items', { input: '{not json', json: false });
    expect(code).toBe(1);
    expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('--input is not JSON');
    expect(createAppContext).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('with --json gives the error as JSON on stdout', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await runPluginCall('lab', 'lab_list_items', { input: '{not json', json: true });
    expect(code).toBe(1);
    expect(JSON.parse(String(out.mock.calls[0]![0]))).toEqual({ error: '--input is not JSON; nothing was sent', answer: null });
    expect(createAppContext).not.toHaveBeenCalled();
    out.mockRestore();
  });
});
