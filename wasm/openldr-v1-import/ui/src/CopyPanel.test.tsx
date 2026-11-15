import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { createMockOpenldr, type PluginCopyRun } from '@openldr/plugin-ui-sdk';
import { App } from './App';
import { resetLocale } from './i18n';

// Layer proven here: the Copy tab's own logic against the SDK mock, in jsdom. Not proven: the
// real broker, the iframe sandbox, CSS layout at phone width, or a database. The browser check
// on a live CE covers those.

type Copy = ReturnType<typeof createMockOpenldr>['imports']['copy'];

const PLUGIN = 'openldr-v1-import';
const ms = { id: 'ms', name: 'V1 SQL Server', type: 'microsoft-sql' };
const GIB = 1024 * 1024 * 1024;

function copy(over: Partial<PluginCopyRun> = {}): PluginCopyRun {
  return {
    id: 'cp1', kind: 'copy', rev: 3, pluginId: PLUGIN, pluginVersion: '0.1.0', connectorId: 'ms', status: 'running',
    options: { tz: '+02:00' }, pageSize: 500,
    sets: { requests: { keys: 1240500, rows: 6902113, bytes: Math.round(3.4 * GIB), skipped: 0, done: false } },
    setOrder: ['requests'], setSql: { requests: 'h1' }, waiting: null,
    startedAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:05:00.000Z', finishedAt: null, lastError: null, startedBy: 'admin',
    ...over,
  };
}

function setup(over: Partial<Copy> = {}) {
  const o = createMockOpenldr({ pluginId: PLUGIN });
  Object.assign(o.imports, { allowed: async () => [ms] });
  Object.assign(o.imports.copy, over);
  (window as unknown as { openldr: unknown }).openldr = o;
  return o;
}

// The Import tab stays in the page, hidden, with its own connector and option fields. Every
// lookup here is inside the Copy tab.
const pane = () => within(screen.getByTestId('copy-panel'));
const byId = (id: string) => pane().getByTestId(id);
const click = (id: string) => fireEvent.click(byId(id));
const type = (id: string, value: string) => fireEvent.input(byId(id), { target: { value } });
const disabled = (id: string) => (byId(id) as HTMLButtonElement).disabled;

/** Render the page and open the Copy tab. */
async function openCopy() {
  render(<App pollMs={5} />);
  fireEvent.click(await screen.findByTestId('tab-copy'));
  await screen.findByTestId('copy-panel');
}

beforeEach(() => {
  resetLocale();
  document.body.removeAttribute('data-openldr-ready');
});

describe('copy tab', () => {
  it('shows the Copy tab and starts a copy with the chosen connector and options', async () => {
    const started = copy({ status: 'queued', options: { tz: '+03:00', database: 'OpenLDRData', panels: 'HIVVL' } });
    const start = vi.fn(async () => ({ run: started }));
    setup({ start, status: async () => started });
    await openCopy();
    expect(screen.getByTestId('tab-copy').getAttribute('aria-selected')).toBe('true');
    expect(byId('copy-start').textContent).toMatch(/Start copy/);
    expect(disabled('copy-start')).toBe(true);
    fireEvent.click(await pane().findByTestId('connector-ms'));
    type('opt-tz', '+03:00');
    type('opt-database', 'OpenLDRData');
    type('opt-panels', ' HIVVL ');
    expect(disabled('copy-start')).toBe(false);
    click('copy-start');
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Queued/));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ connectorId: 'ms', options: { tz: '+03:00', database: 'OpenLDRData', panels: 'HIVVL' } });
  });

  it('lists each set with its requests, rows, size and state', async () => {
    const live = copy({
      sets: {
        requests: { keys: 1240500, rows: 6902113, bytes: Math.round(3.4 * GIB), skipped: 0, done: false },
        results: { keys: 0, rows: 0, bytes: 512, skipped: 0, done: false },
        older: { keys: 7, rows: 9, bytes: 1536, skipped: 0, done: true },
      },
      // The page shows sets in this order, not in the order of the object's keys.
      setOrder: ['older', 'requests', 'results'],
    });
    setup({ list: async () => [live], status: async () => live });
    await openCopy();
    const rows = within(byId('copy-sets')).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.getAttribute('data-set'))).toEqual(['older', 'requests', 'results']);
    const req = byId('copy-set-requests');
    expect(req.textContent).toContain('1,240,500');
    expect(req.textContent).toContain('6,902,113');
    expect(req.textContent).toContain('3.4 GiB');
    expect(req.textContent).toMatch(/Copying/);
    expect(byId('copy-set-older').textContent).toContain('1.5 KiB');
    expect(byId('copy-set-older').textContent).toMatch(/Done/);
    expect(byId('copy-set-results').textContent).toContain('512 B');
    expect(byId('copy-set-results').textContent).toMatch(/Not started/);
    // The count of requests read is the sum over the sets.
    expect(byId('copy-summary').textContent).toContain('1,240,507');
  });

  it('shows the waiting line with the try count and the last error', async () => {
    const waiting = copy({
      status: 'waiting',
      waiting: { since: '2026-11-11T10:04:00.000Z', attempt: 4, error: 'Connection lost - read ECONNRESET' },
    });
    setup({ list: async () => [waiting], status: async () => waiting });
    await openCopy();
    const status = byId('copy-status').textContent ?? '';
    expect(status).toMatch(/Waiting for the source/);
    expect(status).toMatch(/try again by itself/);
    const line = byId('copy-waiting').textContent ?? '';
    expect(line).toContain('4');
    expect(line).toContain(new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-11-11T10:04:00.000Z')));
    expect(byId('copy-last-error').textContent).toContain('Connection lost - read ECONNRESET');
    // The page is not given the wait length, so it shows no countdown.
    expect(screen.queryByText(/Next try/)).toBeNull();
    // A waiting copy is alive: it is not shown as an error, and its set is waiting.
    expect(byId('copy-set-requests').textContent).toMatch(/Waiting/);
  });

  it('Stop calls stop; Delete is disabled while the copy is active', async () => {
    const live = copy();
    let current = live;
    const stop = vi.fn(async () => (current = { ...live, status: 'stopping' }));
    const remove = vi.fn();
    setup({ list: async () => [live], status: async () => current, stop, remove });
    await openCopy();
    click('copy-menu');
    expect(disabled('copy-delete')).toBe(true);
    expect(disabled('copy-stop')).toBe(false);
    click('copy-stop');
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Stopping/));
    expect(stop).toHaveBeenCalledWith('cp1');
    click('copy-menu');
    // Stopping is still active: nothing can be stopped again or deleted yet.
    expect(disabled('copy-stop')).toBe(true);
    expect(disabled('copy-delete')).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it('Delete asks for the plugin id and calls remove only when it matches', async () => {
    const done = copy({ status: 'completed', sets: { requests: { keys: 10, rows: 40, bytes: 2048, skipped: 0, done: true } } });
    let current: PluginCopyRun | null = done;
    const remove = vi.fn(async () => (current = { ...done, status: 'deleting' }));
    setup({ list: async () => [done], status: async () => current, remove });
    await openCopy();
    click('copy-menu');
    expect(disabled('copy-stop')).toBe(true);
    click('copy-delete');
    const dialog = byId('copy-delete-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.textContent).toContain(PLUGIN);
    expect(dialog.textContent).toContain('40');
    expect(disabled('copy-delete-confirm')).toBe(true);
    type('copy-delete-input', 'openldr-v1');
    expect(disabled('copy-delete-confirm')).toBe(true);
    click('copy-delete-confirm');
    expect(remove).not.toHaveBeenCalled();
    type('copy-delete-input', PLUGIN);
    expect(disabled('copy-delete-confirm')).toBe(false);
    click('copy-delete-confirm');
    await waitFor(() => expect(remove).toHaveBeenCalledWith('cp1'));
    expect(pane().queryByTestId('copy-delete-dialog')).toBeNull();
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Deleting/));
    // The server finishes the delete and the record goes. The page then says so.
    current = null;
    expect((await pane().findByTestId('copy-deleted')).textContent).toMatch(/deleted/);
    expect(pane().queryByTestId('copy-sets')).toBeNull();
  });

  it('Cancel closes the delete step without calling remove', async () => {
    const done = copy({ status: 'stopped' });
    const remove = vi.fn();
    setup({ list: async () => [done], status: async () => done, remove });
    await openCopy();
    click('copy-menu');
    click('copy-delete');
    type('copy-delete-input', PLUGIN);
    click('copy-delete-cancel');
    expect(pane().queryByTestId('copy-delete-dialog')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('shows the stored options read-only while a copy is active', async () => {
    const live = copy({ options: { tz: '+01:00', database: 'LabDB', from: '2024-01-01' } });
    let current = live;
    const stop = vi.fn(async () => (current = { ...live, status: 'stopped' }));
    setup({ list: async () => [live], status: async () => current, stop });
    await openCopy();
    const tz = byId('opt-tz') as HTMLInputElement;
    expect(tz.value).toBe('+01:00');
    expect(tz.readOnly).toBe(true);
    expect((byId('opt-database') as HTMLInputElement).value).toBe('LabDB');
    expect((byId('opt-from') as HTMLInputElement).value).toBe('2024-01-01');
    expect((byId('opt-database') as HTMLInputElement).readOnly).toBe(true);
    expect(disabled('copy-start')).toBe(true);
    click('copy-menu');
    click('copy-stop');
    // Once stopped, the form opens again with the options the copy had, and Start copy sends it.
    await waitFor(() => expect((byId('opt-tz') as HTMLInputElement).readOnly).toBe(false));
    expect((byId('opt-tz') as HTMLInputElement).value).toBe('+01:00');
    expect(disabled('copy-start')).toBe(false);
  });

  it('asks before reading a changed set again, and sends reread only on yes', async () => {
    const stopped = copy({ status: 'stopped' });
    let current = stopped;
    const start = vi.fn()
      .mockResolvedValueOnce({ changedSets: ['requests'] })
      .mockResolvedValueOnce({ changedSets: ['requests'] })
      .mockImplementationOnce(async () => ({ run: (current = copy({ status: 'queued', options: { tz: '+02:00', from: '2025-01-01' } })) }));
    setup({ list: async () => [stopped], status: async () => current, start });
    await openCopy();
    type('opt-from', '2025-01-01');
    click('copy-start');
    const dialog = await pane().findByTestId('copy-reread-dialog');
    expect(dialog.textContent).toContain('These will be read again from the start: requests');
    // No: nothing is sent again, and the copy is left as it was.
    click('copy-reread-no');
    expect(pane().queryByTestId('copy-reread-dialog')).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenLastCalledWith({ connectorId: 'ms', options: { tz: '+02:00', from: '2025-01-01' } });
    expect(byId('copy-status').textContent).toMatch(/Stopped/);
    // Ask again, and say yes this time.
    click('copy-start');
    await pane().findByTestId('copy-reread-dialog');
    click('copy-reread-yes');
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Queued/));
    expect(start).toHaveBeenCalledTimes(3);
    expect(start.mock.calls[1]![0]).not.toHaveProperty('reread');
    expect(start).toHaveBeenLastCalledWith({ connectorId: 'ms', options: { tz: '+02:00', from: '2025-01-01' }, reread: true });
  });

  it('warns when keys were skipped', async () => {
    const done = copy({
      status: 'completed',
      sets: {
        requests: { keys: 900, rows: 4000, bytes: 4096, skipped: 1234, done: true },
        other: { keys: 5, rows: 5, bytes: 10, skipped: 2, done: true },
      },
      setOrder: ['requests', 'other'],
    });
    setup({ list: async () => [done], status: async () => done });
    await openCopy();
    const warning = byId('copy-skipped');
    expect(warning.textContent).toContain('1,236');
    expect(warning.getAttribute('role')).toBe('alert');
    // Finished with requests left out is never shown as a clean finish.
    expect(byId('copy-status').textContent).not.toMatch(/^Finished\.?$/);
  });

  it('shows no warning when nothing was skipped', async () => {
    const done = copy({ status: 'completed', sets: { requests: { keys: 900, rows: 4000, bytes: 4096, skipped: 0, done: true } } });
    setup({ list: async () => [done], status: async () => done });
    await openCopy();
    expect(pane().queryByTestId('copy-skipped')).toBeNull();
  });

  it('shows why a copy could not start', async () => {
    setup({ start: async () => { throw new Error('copy cp1 is being deleted'); } });
    await openCopy();
    fireEvent.click(await pane().findByTestId('connector-ms'));
    type('opt-tz', '+02:00');
    click('copy-start');
    expect((await pane().findByTestId('copy-start-error')).textContent).toContain('copy cp1 is being deleted');
  });
});
