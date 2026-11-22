import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormEntryRepeatError, listFormEntries, submitFormResponse, voidFormEntry } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('form entries api client', () => {
  it('turns a repeated requisition number into FormEntryRepeatError', async () => {
    const entry = { id: 'e-1', entryKey: 'CS-1', enteredAt: '2026-11-22T13:50:00.000Z', enteredByName: 'aisha' };
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'entry-repeat', message: 'CS-1 was already entered.', entry })));
    const err = await submitFormResponse('form-1', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FormEntryRepeatError);
    expect((err as FormEntryRepeatError).message).toBe('CS-1 was already entered.');
    expect((err as FormEntryRepeatError).entry).toEqual(entry);
  });

  it('keeps the other 409, the ingest workflow being off, as a plain error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { ok: false, error: "capture pipeline unavailable: the 'wf-ingest' workflow is missing or disabled" })));
    const err = await submitFormResponse('form-1', {}).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(FormEntryRepeatError);
    expect((err as Error).message).toContain('capture pipeline unavailable');
  });

  it('sends only the filters that are set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { entries: [], total: 0 })));
    await listFormEntries('form-1', { limit: 25, offset: 50, search: 'CS', status: 'entered-in-error' });
    expect(fetch).toHaveBeenCalledWith('/api/forms/form-1/entries?limit=25&offset=50&status=entered-in-error&search=CS');
  });

  it('carries the status on a refused void', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'already-void' })));
    const err = await voidFormEntry('e-1', 'typo').catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(409);
    expect(fetch).toHaveBeenCalledWith('/api/forms/entries/e-1/void', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'typo' }) }));
  });
});
