import { describe, it, expect, vi } from 'vitest';
import { revalidateImportRun } from './facility-revalidate';

const runStore = (run: unknown, requeue = vi.fn().mockResolvedValue(true)) => ({
  get: vi.fn().mockResolvedValue(run),
  requeueForValidation: requeue,
} as never);

const parked = { id: 'fir_1', status: 'awaiting_confirmation', blobKey: 'b1' };

describe('revalidateImportRun', () => {
  it('requeues a run that is parked for a decision, with the options it was given', async () => {
    const requeue = vi.fn().mockResolvedValue(true);
    const out = await revalidateImportRun(runStore(parked, requeue), {
      runId: 'fir_1', options: { columnMap: { columns: {} } },
    });
    expect(out).toEqual({ ok: true });
    expect(requeue).toHaveBeenCalledWith('fir_1', 'awaiting_confirmation', { columnMap: { columns: {} } });
  });

  it('reports a run that does not exist', async () => {
    const out = await revalidateImportRun(runStore(null), { runId: 'nope', options: {} });
    expect(out).toMatchObject({ ok: false, code: 'not-found' });
  });

  // ⛔ ASKED SEPARATELY FROM THE STATUS GUARD, and the fixture has to be PARKED to reach it: a
  // `previewed` run is refused on status first, which is right. This is the belt-and-braces case
  // the confirm route also guards separately — a run that is parked and still carries no file.
  // Nothing mints that today (a validate needs a blob to read), which is exactly why it is worth a
  // guard rather than an assumption.
  it('refuses a parked run with no stored file, and says where that file can be checked instead', async () => {
    const out = await revalidateImportRun(
      runStore({ id: 'fir_2', status: 'awaiting_confirmation', blobKey: null }), { runId: 'fir_2', options: {} },
    );
    expect(out).toMatchObject({ ok: false, code: 'no-stored-file' });
    expect((out as { message: string }).message).toMatch(/POST \/api\/facilities\/import/);
  });

  // ⛔ Cancel DELETES the blob, so a cancelled run must be refused on STATUS before anything tries
  // to read a key that points at nothing. Every non-parked state is refused for the same reason:
  // only `awaiting_confirmation` has a file, a finished validate, and no work in flight.
  it.each(['applied', 'failed', 'cancelled', 'applying', 'validating', 'queued', 'confirmed', 'previewed'])(
    'refuses a run in status %s, naming the status',
    async (status) => {
      const out = await revalidateImportRun(
        runStore({ id: 'fir_3', status, blobKey: 'b' }), { runId: 'fir_3', options: {} },
      );
      expect(out).toMatchObject({ ok: false, code: 'not-revalidatable' });
      expect((out as { message: string }).message).toContain(status);
    },
  );

  it('reports a race when the guarded update loses', async () => {
    const out = await revalidateImportRun(
      runStore(parked, vi.fn().mockResolvedValue(false)), { runId: 'fir_1', options: {} },
    );
    expect(out).toMatchObject({ ok: false, code: 'raced' });
  });

  // ⛔ Identity fields are DROPPED, not rejected. A CLI user sending a whole options file that
  // happens to carry `nationalSystem` should get their column map applied, not a refusal.
  it('drops identity fields from the options it writes', async () => {
    const requeue = vi.fn().mockResolvedValue(true);
    await revalidateImportRun(runStore(parked, requeue), {
      runId: 'fir_1',
      options: {
        nationalSystem: 'urn:tz:hfr', sourceFormat: 'jsonl', completeRelease: true,
        releaseVersion: 'v9', blobKey: 'evil', fileHash: 'x', byteSize: 1,
        columnMap: { columns: {} }, allowUnknownColumns: true,
      },
    });
    expect(requeue).toHaveBeenCalledWith('fir_1', 'awaiting_confirmation', {
      columnMap: { columns: {} }, allowUnknownColumns: true,
    });
  });
});
