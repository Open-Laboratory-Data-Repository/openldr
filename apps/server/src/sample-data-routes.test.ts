import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { AppContext, SampleDataCounts } from '@openldr/bootstrap';
import { registerSampleDataRoutes } from './sample-data-routes';

// Layer under test: the route's gate, the lab-data refusal, the busy flag and the audit row, with
// the check and the load faked. The check itself is tested in
// packages/bootstrap/src/sample-data.test.ts. No real seed runs here.

const counts: SampleDataCounts = { formsSeeded: 4, workflowsSeeded: 2, connectorsSeeded: 1, dashboardsSeeded: 1, settingsSeeded: 5 };
const URL = '/api/settings/sample-data';

function build(opts: {
  capabilities?: string[];
  audited?: unknown[];
  holdsLabData?: () => Promise<boolean>;
  load?: () => Promise<SampleDataCounts>;
} = {}) {
  const audited = opts.audited ?? [];
  const ctx = { audit: { record: async (e: unknown) => { audited.push(e); } }, logger: { error() {}, warn() {} } } as unknown as AppContext;
  const app = Fastify();
  const capabilities = opts.capabilities ?? ['settings.danger_zone'];
  app.addHook('onRequest', async (req) => { req.user = { id: 'u1', username: 'admin', displayName: null, roles: [], capabilities } as never; });
  registerSampleDataRoutes(app, ctx, {
    holdsLabData: opts.holdsLabData ?? (async () => false),
    load: opts.load ?? (async () => counts),
  });
  return app;
}

describe('sample data routes', () => {
  it('answer 403 to a user with only settings.view, and never load', async () => {
    const load = vi.fn(async () => counts);
    const app = build({ capabilities: ['settings.view'], load });
    expect((await app.inject({ method: 'GET', url: URL })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: URL })).statusCode).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it('GET says whether loading is allowed', async () => {
    const empty = await build({ holdsLabData: async () => false }).inject({ method: 'GET', url: URL });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ allowed: true });
    expect(empty.headers['cache-control']).toBe('no-store');
    const full = await build({ holdsLabData: async () => true }).inject({ method: 'GET', url: URL });
    expect(full.json()).toEqual({ allowed: false });
  });

  it('POST refuses an install that holds lab data, with no load and no audit row', async () => {
    const audited: unknown[] = [];
    const load = vi.fn(async () => counts);
    const res = await build({ holdsLabData: async () => true, load, audited }).inject({ method: 'POST', url: URL });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: expect.any(String), code: 'has_lab_data' });
    expect(load).not.toHaveBeenCalled();
    expect(audited).toEqual([]);
  });

  it('POST loads once on an empty install, answers the counts and writes one audit row', async () => {
    const audited: unknown[] = [];
    const load = vi.fn(async () => counts);
    const res = await build({ load, audited }).inject({ method: 'POST', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ...counts });
    expect(load).toHaveBeenCalledOnce();
    expect(audited).toEqual([expect.objectContaining({
      actorType: 'user', actorId: 'u1', action: 'settings.sample_data.load',
      entityType: 'system', entityId: 'sample-data', metadata: counts,
    })]);
  });

  it('a second POST while the first load runs answers 409 sample_data_busy', async () => {
    let finish!: (c: SampleDataCounts) => void;
    let started!: () => void;
    const loadStarted = new Promise<void>((resolve) => { started = resolve; });
    const load = vi.fn(() => { started(); return new Promise<SampleDataCounts>((resolve) => { finish = resolve; }); });
    const holdsLabData = vi.fn(async () => false);
    const app = build({ load, holdsLabData });
    const first = app.inject({ method: 'POST', url: URL });
    await loadStarted;
    const second = await app.inject({ method: 'POST', url: URL });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: expect.any(String), code: 'sample_data_busy' });
    expect(load).toHaveBeenCalledOnce();
    finish(counts);
    expect((await first).statusCode).toBe(200);
    // The flag is clear: a new POST reaches the check again.
    const checksBefore = holdsLabData.mock.calls.length;
    holdsLabData.mockResolvedValueOnce(true);
    const third = await app.inject({ method: 'POST', url: URL });
    expect(holdsLabData.mock.calls.length).toBe(checksBefore + 1);
    expect(third.json()).toMatchObject({ code: 'has_lab_data' });
  });

  it('a load that throws clears the busy flag', async () => {
    const load = vi.fn<() => Promise<SampleDataCounts>>()
      .mockRejectedValueOnce(new Error('seed failed at 10.0.0.5'))
      .mockResolvedValueOnce(counts);
    const audited: unknown[] = [];
    const app = build({ load, audited });
    const failed = await app.inject({ method: 'POST', url: URL });
    expect(failed.statusCode).toBe(500);
    expect(JSON.stringify(failed.json())).not.toContain('10.0.0.5');
    expect(audited).toEqual([]);
    const next = await app.inject({ method: 'POST', url: URL });
    expect(next.statusCode).toBe(200);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
