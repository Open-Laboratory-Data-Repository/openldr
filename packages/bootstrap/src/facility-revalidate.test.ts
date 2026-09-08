import { describe, it, expect, vi } from 'vitest';
import { revalidateImportRun } from './facility-revalidate';

const runStore = (run: unknown, requeue = vi.fn().mockResolvedValue(true)) => ({
  get: vi.fn().mockResolvedValue(run),
  requeueForValidation: requeue,
} as never);

const parked = { id: 'fir_1', status: 'awaiting_confirmation', blobKey: 'b1' };
const stored = { id: 'fir_4', status: 'stored', blobKey: 'b4' };

describe('revalidateImportRun', () => {
  it('requeues a run that is parked for a decision, with the options it was given', async () => {
    const requeue = vi.fn().mockResolvedValue(true);
    const out = await revalidateImportRun(runStore(parked, requeue), {
      runId: 'fir_1', options: { columnMap: { columns: {} } },
    });
    expect(out).toEqual({ ok: true });
    expect(requeue).toHaveBeenCalledWith('fir_1', 'awaiting_confirmation', { columnMap: { columns: {} } });
  });

  // ⛔ Task 6's open concern: Source stores a file but validates nothing, so the FIRST validate a
  // register ever gets has to run from `stored`, with the column map Mapping just built. Without
  // this, the only way to check a `stored` run at all was to send the whole file again.
  it('requeues a stored run for its first validate, with the column map it was given', async () => {
    const requeue = vi.fn().mockResolvedValue(true);
    const out = await revalidateImportRun(runStore(stored, requeue), {
      runId: 'fir_4', options: { columnMap: { columns: { name: 'facility_name' } } },
    });
    expect(out).toEqual({ ok: true });
    // The CAS target is `stored`, the status this run was actually read at, not the
    // `awaiting_confirmation` literal the old single-status guard always used.
    expect(requeue).toHaveBeenCalledWith('fir_4', 'stored', { columnMap: { columns: { name: 'facility_name' } } });
  });

  // ⛔ The operator's ruling: widening the guard for `stored` must not also widen what an
  // `awaiting_confirmation` run can do. `confirmed` is the state where the operator's approval
  // actually lives (see `REVALIDATABLE_STATUSES`'s own comment), so a parse-changing option sent
  // against a confirmed run must still be refused on status, before the option is ever read, with
  // the same code and message shape a status refusal always had.
  it('refuses a confirmed run a column map, naming the status, exactly like before', async () => {
    const out = await revalidateImportRun(
      runStore({ id: 'fir_5', status: 'confirmed', blobKey: 'b5' }),
      { runId: 'fir_5', options: { columnMap: { columns: { name: 'facility_name' } }, allowUnknownColumns: true } },
    );
    expect(out).toMatchObject({ ok: false, code: 'not-revalidatable' });
    expect((out as { message: string }).message).toContain('confirmed');
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
  // to read a key that points at nothing. Every state here is refused for the same reason: only
  // `stored` and `awaiting_confirmation` have a file with no work in flight and no approval to
  // disturb. `stored` is deliberately absent from this list now that it is revalidatable.
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
