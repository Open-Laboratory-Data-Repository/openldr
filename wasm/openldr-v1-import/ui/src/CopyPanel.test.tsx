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
// A menu item is marked aria-disabled, not disabled, so the keyboard can still reach it.
const itemOff = (id: string) => byId(id).getAttribute('aria-disabled') === 'true';
/** Start copy sits in the Copy tab's own dots menu (spec 4.6): open the menu, then choose the item. */
function chooseStart() {
  click('copy-actions');
  click('copy-start');
}

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
    expect(disabled('copy-actions')).toBe(true);
    fireEvent.click(await pane().findByTestId('connector-ms'));
    type('opt-tz', '+03:00');
    type('opt-database', 'OpenLDRData');
    type('opt-panels', ' HIVVL ');
    expect(disabled('copy-actions')).toBe(false);
    click('copy-actions');
    expect(byId('copy-start').textContent).toMatch(/Start copy/);
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
    // A waiting copy is alive: its error is drawn quietly, not as an error, and its set is waiting.
    expect(byId('copy-last-error').classList.contains('v1i-muted')).toBe(true);
    expect(byId('copy-last-error').classList.contains('v1i-error')).toBe(false);
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
    expect(itemOff('copy-delete')).toBe(true);
    expect(itemOff('copy-stop')).toBe(false);
    // A disabled item is ignored when pressed.
    click('copy-delete');
    expect(pane().queryByTestId('copy-delete-dialog')).toBeNull();
    click('copy-stop');
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Stopping/));
    expect(stop).toHaveBeenCalledWith('cp1');
    // Stopping: nothing can be stopped again or deleted yet, so the menu does not open (R37).
    expect(disabled('copy-menu')).toBe(true);
    expect(byId('copy-locked').textContent).toMatch(/once it has stopped/);
    expect(remove).not.toHaveBeenCalled();
  });

  it('Delete asks for the plugin id and calls remove only when it matches', async () => {
    const done = copy({ status: 'completed', sets: { requests: { keys: 10, rows: 40, bytes: 2048, skipped: 0, done: true } } });
    let current: PluginCopyRun | null = done;
    const remove = vi.fn(async () => (current = { ...done, status: 'deleting' }));
    setup({ list: async () => [done], status: async () => current, remove });
    await openCopy();
    click('copy-menu');
    expect(itemOff('copy-stop')).toBe(true);
    click('copy-delete');
    const dialog = byId('copy-delete-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.textContent).toContain(PLUGIN);
    expect(dialog.textContent).toContain('Rows: 40');
    // The step names the connector whose copy goes.
    expect(dialog.textContent).toContain('V1 SQL Server');
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
    expect(disabled('copy-actions')).toBe(true);
    click('copy-menu');
    click('copy-stop');
    // Once stopped, the form opens again with the options the copy had, and Start copy sends it.
    await waitFor(() => expect((byId('opt-tz') as HTMLInputElement).readOnly).toBe(false));
    expect((byId('opt-tz') as HTMLInputElement).value).toBe('+01:00');
    expect(disabled('copy-actions')).toBe(false);
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
    chooseStart();
    const dialog = await pane().findByTestId('copy-reread-dialog');
    expect(dialog.textContent).toContain('These will be read again from the start: requests');
    // No: nothing is sent again, and the copy is left as it was.
    click('copy-reread-no');
    expect(pane().queryByTestId('copy-reread-dialog')).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenLastCalledWith({ connectorId: 'ms', options: { tz: '+02:00', from: '2025-01-01' } });
    expect(byId('copy-status').textContent).toMatch(/Stopped/);
    // Ask again, and say yes this time.
    chooseStart();
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
    expect(warning.getAttribute('role')).toBe('status');
    // Finished with requests left out is never shown as a clean finish.
    expect(byId('copy-status').textContent).toMatch(/left out/);
  });

  it('reads right at a count of 1', async () => {
    const done = copy({ status: 'completed', sets: { requests: { keys: 1, rows: 1, bytes: 1, skipped: 1, done: true } } });
    setup({ list: async () => [done], status: async () => done });
    await openCopy();
    expect(byId('copy-summary').textContent).toBe('Requests copied: 1.');
    expect(byId('copy-skipped').textContent).toMatch(/^Requests left out: 1\./);
    click('copy-menu');
    click('copy-delete');
    expect(byId('copy-delete-dialog').textContent).toContain('Rows: 1.');
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
    chooseStart();
    expect((await pane().findByTestId('copy-start-error')).textContent).toContain('copy cp1 is being deleted');
  });
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('reading the copy', () => {
  it('stops reading once the copy reaches a final status', async () => {
    let current = copy();
    const status = vi.fn(async () => current);
    setup({ list: async () => [current], status });
    await openCopy();
    await waitFor(() => expect(status).toHaveBeenCalled());
    current = copy({ status: 'completed' });
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Finished/));
    const calls = status.mock.calls.length;
    await pause(40);
    expect(status.mock.calls.length).toBe(calls);
  });

  it('drops an answer that was asked for before Stop was pressed', async () => {
    const live = copy();
    let release: (r: unknown) => void = () => {};
    const slow = new Promise((resolve) => { release = resolve; });
    // Later reads never answer, so nothing else can correct the status during the test.
    const status = vi.fn().mockReturnValueOnce(slow).mockReturnValue(new Promise(() => {}));
    setup({ list: async () => [live], status, stop: async () => ({ ...live, status: 'stopping' }) });
    await openCopy();
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    click('copy-menu');
    click('copy-stop');
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Stopping/));
    release(live); // the old answer still says running
    await pause(30);
    expect(byId('copy-status').textContent).toMatch(/Stopping/);
  });

  it('does not read the copy while the Import tab is in front', async () => {
    const live = copy();
    const status = vi.fn(async () => live);
    setup({ list: async () => [live], status });
    await openCopy();
    await waitFor(() => expect(status).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('tab-import'));
    await pause(20);
    const calls = status.mock.calls.length;
    await pause(40);
    expect(status.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByTestId('tab-copy'));
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(calls));
  });

  it('shows the connectors even when the copy list cannot be read', async () => {
    setup({ list: async () => { throw new Error('copy store down'); } });
    await openCopy();
    expect(byId('copy-load-error').textContent).toContain('copy store down');
    expect(byId('connector-ms')).toBeTruthy();
    expect(pane().queryByTestId('source-none')).toBeNull();
  });
});

const other = { id: 'ms2', name: 'Second v1 server', type: 'microsoft-sql' };
const active = () => document.activeElement as HTMLElement | null;
const key = (k: string, shift = false) => fireEvent.keyDown(active() ?? document.body, { key: k, shiftKey: shift });

describe('R35: a yes to read again sends exactly what was asked', () => {
  it('locks the picker and the form while the start call is out and the step is open, and the yes resends the first values', async () => {
    const stopped = copy({ status: 'stopped' });
    let answer: (v: unknown) => void = () => {};
    const start = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockResolvedValueOnce({ run: copy({ status: 'queued', options: { tz: '+02:00', from: '2025-01-01' } }) });
    const o = setup({ list: async () => [stopped], status: async () => stopped, start });
    Object.assign(o.imports, { allowed: async () => [ms, other] });
    await openCopy();
    type('opt-from', '2025-01-01');
    chooseStart();
    // The call is out: the form and the picker do not take input.
    expect((byId('opt-from') as HTMLInputElement).readOnly).toBe(true);
    type('opt-from', '2030-12-31');
    click('connector-ms2');
    expect(byId('connector-ms').getAttribute('aria-checked')).toBe('true');
    answer({ changedSets: ['requests'] });
    await pane().findByTestId('copy-reread-dialog');
    // The step is open: the same holds.
    expect((byId('opt-from') as HTMLInputElement).readOnly).toBe(true);
    expect(disabled('connector-ms2')).toBe(true);
    type('opt-from', '2030-12-31');
    click('connector-ms2');
    expect(byId('connector-ms').getAttribute('aria-checked')).toBe('true');
    click('copy-reread-yes');
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start).toHaveBeenLastCalledWith({ connectorId: 'ms', options: { tz: '+02:00', from: '2025-01-01' }, reread: true });
  });
});

describe('two connectors', () => {
  // M4. Spec 9.2: to copy two databases, make two connectors. One live copy must not hide the other.
  it("while one copy is live, another connector can be picked to see or start its copy", async () => {
    const live = copy();
    const second = copy({ id: 'cp2', connectorId: 'ms2', status: 'stopped', options: { tz: '+01:00', database: 'Other' } });
    const start = vi.fn(async () => ({ run: { ...second, status: 'queued' as const } }));
    const o = setup({ list: async () => [live, second], status: async (id: string) => (id === 'cp2' ? second : live), start });
    Object.assign(o.imports, { allowed: async () => [ms, other] });
    await openCopy();
    // The live copy's form stays read-only, but the picker is open.
    expect(byId('connector-ms').getAttribute('aria-checked')).toBe('true');
    expect((byId('opt-tz') as HTMLInputElement).readOnly).toBe(true);
    expect(disabled('connector-ms2')).toBe(false);
    click('connector-ms2');
    expect(byId('connector-ms2').getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Stopped/));
    expect((byId('opt-database') as HTMLInputElement).value).toBe('Other');
    expect((byId('opt-tz') as HTMLInputElement).readOnly).toBe(false);
    expect(disabled('copy-actions')).toBe(false);
    chooseStart();
    await waitFor(() => expect(start).toHaveBeenCalledWith({ connectorId: 'ms2', options: { tz: '+01:00', database: 'Other' } }));
    // And back to the live one, still read-only.
    await waitFor(() => expect(disabled('connector-ms')).toBe(false));
    click('connector-ms');
    await waitFor(() => expect(byId('copy-status').textContent).toMatch(/Copying|Running/));
    expect((byId('opt-tz') as HTMLInputElement).readOnly).toBe(true);
  });
});

describe('the dots menu and the sets table', () => {
  it('closes the dots menu when neither item can be used any more', async () => {
    const live = copy();
    let current = live;
    setup({ list: async () => [live], status: async () => current });
    await openCopy();
    click('copy-menu');
    expect(pane().getByRole('menu')).toBeTruthy();
    // Another process asks the copy to stop: nothing in the menu can be used now.
    current = { ...live, status: 'stopping' };
    await waitFor(() => expect(pane().queryByRole('menu')).toBeNull());
    expect(byId('copy-menu').getAttribute('aria-expanded')).toBe('false');
    expect(disabled('copy-menu')).toBe(true);
  });

  it('puts State second, so it is on screen on a phone', async () => {
    setup({ list: async () => [copy()], status: async () => copy() });
    await openCopy();
    const heads = within(byId('copy-sets')).getAllByRole('columnheader').map((th) => th.textContent);
    expect(heads[0]).toBe('Set');
    expect(heads[1]).toBe('State');
    const cells = within(byId('copy-set-requests')).getAllByRole('cell').map((td) => td.textContent);
    expect(cells[0]).toBe('requests');
    expect(cells[1]).toMatch(/Copying/);
    expect(cells[2]).toBe('1,240,500');
  });
});

describe('R36: a confirm step is modal', () => {
  it('the read-again step takes focus, keeps Tab inside, closes on Escape and gives focus back to the Start menu button', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped, start: async () => ({ changedSets: ['requests'] }) });
    await openCopy();
    chooseStart();
    const dialog = await pane().findByTestId('copy-reread-dialog');
    await waitFor(() => expect(dialog.contains(active())).toBe(true));
    // Everything behind the step is out of reach, the Start menu with it.
    expect(byId('copy-main').hasAttribute('inert')).toBe(true);
    expect(byId('copy-main').contains(byId('copy-actions'))).toBe(true);
    const no = byId('copy-reread-no');
    const yes = byId('copy-reread-yes');
    yes.focus();
    key('Tab');
    expect(active()).toBe(no);
    key('Tab', true);
    expect(active()).toBe(yes);
    key('Escape');
    await waitFor(() => expect(pane().queryByTestId('copy-reread-dialog')).toBeNull());
    expect(byId('copy-main').hasAttribute('inert')).toBe(false);
    await waitFor(() => expect(active()).toBe(byId('copy-actions')));
  });

  it('the delete step takes focus, keeps Tab inside, locks the picker, and gives focus back to the dots button', async () => {
    const done = copy({ status: 'completed', sets: { requests: { keys: 10, rows: 40, bytes: 2048, skipped: 0, done: true } } });
    const remove = vi.fn();
    const o = setup({ list: async () => [done], status: async () => done, remove });
    Object.assign(o.imports, { allowed: async () => [ms, other] });
    await openCopy();
    click('copy-menu');
    click('copy-delete');
    const dialog = byId('copy-delete-dialog');
    await waitFor(() => expect(active()).toBe(byId('copy-delete-input')));
    expect(byId('copy-main').hasAttribute('inert')).toBe(true);
    // The confirm button is disabled, so the cancel button is the last stop. Tab wraps both ways.
    byId('copy-delete-cancel').focus();
    key('Tab');
    expect(active()).toBe(byId('copy-delete-input'));
    key('Tab', true);
    expect(active()).toBe(byId('copy-delete-cancel'));
    expect(dialog.contains(active())).toBe(true);
    // A picked connector behind the step cannot swap the copy being deleted.
    click('connector-ms2');
    expect(byId('connector-ms').getAttribute('aria-checked')).toBe('true');
    expect(byId('copy-delete-dialog').textContent).toContain('V1 SQL Server');
    key('Escape');
    await waitFor(() => expect(pane().queryByTestId('copy-delete-dialog')).toBeNull());
    await waitFor(() => expect(active()).toBe(byId('copy-menu')));
    expect(remove).not.toHaveBeenCalled();
  });
});

// The two dots menus are told apart by their names.
const START_MENU = 'Copy tab actions';
const CARD_MENU = 'Copy actions';
const menuNamed = (name: string) => pane().queryByRole('menu', { name });

describe('spec 4.6: Start copy sits in a dots menu', () => {
  it('has no plain Start button; the menu button sits in the picker row and is off until a connector is picked', async () => {
    setup();
    await openCopy();
    expect(pane().queryByTestId('copy-start')).toBeNull();
    const button = byId('copy-actions');
    expect(button.getAttribute('aria-label')).toBe(START_MENU);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // R3: no menu that opens with nothing usable in it.
    expect(disabled('copy-actions')).toBe(true);
    const row = byId('copy-source-row');
    expect(row.contains(byId('connector-ms'))).toBe(true);
    expect(row.contains(button)).toBe(true);
    click('connector-ms');
    expect(disabled('copy-actions')).toBe(false);
    click('copy-actions');
    const menu = menuNamed(START_MENU)!;
    expect(within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('data-testid'))).toEqual(['copy-start']);
    expect(byId('copy-start').textContent).toBe('Start copy');
    expect(itemOff('copy-start')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // Focus moves to the item.
    expect(active()).toBe(byId('copy-start'));
  });

  it('names the item Continue copy when a copy exists and is not live', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-actions');
    expect(byId('copy-start').textContent).toBe('Continue copy');
  });

  it('is off while the copy shown is live, and its menu is never drawn', async () => {
    setup({ list: async () => [copy()], status: async () => copy() });
    await openCopy();
    expect(disabled('copy-actions')).toBe(true);
    expect(menuNamed(START_MENU)).toBeNull();
    // jsdom delivers a click to a disabled button and a real browser does not. So this checks the
    // button's own guard: the list is not drawn even for a moment.
    const seen = new MutationObserver(() => {});
    seen.observe(screen.getByTestId('copy-panel'), { childList: true, subtree: true });
    click('copy-actions');
    const added = seen.takeRecords().flatMap((r) => [...r.addedNodes]);
    seen.disconnect();
    expect(added.some((n) => n instanceof Element && (n.matches('[role="menu"]') || n.querySelector('[role="menu"]') !== null))).toBe(false);
    expect(byId('copy-actions').getAttribute('aria-expanded')).toBe('false');
  });

  it('R3: an open menu closes, and its button is off, once the item cannot be used', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-actions');
    expect(menuNamed(START_MENU)).toBeTruthy();
    expect(active()).toBe(byId('copy-start'));
    // A form that is not right: Start cannot be used now.
    type('opt-tz', 'not an offset');
    await waitFor(() => expect(menuNamed(START_MENU)).toBeNull());
    expect(byId('copy-actions').getAttribute('aria-expanded')).toBe('false');
    expect(disabled('copy-actions')).toBe(true);
    // Focus was in the menu, which is gone, so it goes to the status line.
    expect(active()).toBe(byId('copy-status'));
  });

  it('R3: when focus is in a field as the menu closes, it stays in the field', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-actions');
    const tz = byId('opt-tz');
    tz.focus();
    type('opt-tz', 'not an offset');
    await waitFor(() => expect(menuNamed(START_MENU)).toBeNull());
    expect(active()).toBe(tz);
  });

  it('choosing the item calls start with the form, closes the menu and gives focus to its button', async () => {
    const stopped = copy({ status: 'stopped' });
    const start = vi.fn(async () => { throw new Error('no room on the disk'); });
    setup({ list: async () => [stopped], status: async () => stopped, start });
    await openCopy();
    const focus = vi.spyOn(byId('copy-actions'), 'focus');
    chooseStart();
    expect(menuNamed(START_MENU)).toBeNull();
    expect(byId('copy-actions').getAttribute('aria-expanded')).toBe('false');
    expect(focus).toHaveBeenCalled();
    // Not asserted: whether focus stays on the button while the call makes it disabled. jsdom keeps it; a real browser may not.
    await pane().findByTestId('copy-start-error');
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ connectorId: 'ms', options: { tz: '+02:00' } });
  });

  it('says Starting… in a status line while the start call is out, and nothing once it settles', async () => {
    const stopped = copy({ status: 'stopped' });
    // Each call waits until the test answers it.
    type Answer = { run?: PluginCopyRun; changedSets?: string[] };
    let settle = { resolve: (_v: Answer) => {}, reject: (_e: unknown) => {} };
    const start = vi.fn(() => new Promise<Answer>((resolve, reject) => { settle = { resolve, reject }; }));
    setup({ list: async () => [stopped], status: async () => stopped, start });
    await openCopy();
    const line = () => byId('copy-starting');
    expect(line().getAttribute('role')).toBe('status');
    expect(line().textContent).toBe('');
    // A call that fails.
    chooseStart();
    expect(line().textContent).toBe('Starting…');
    settle.reject(new Error('no room on the disk'));
    await pane().findByTestId('copy-start-error');
    expect(line().textContent).toBe('');
    // A call that works.
    chooseStart();
    expect(line().textContent).toBe('Starting…');
    settle.resolve({ run: copy({ status: 'queued' }) });
    await waitFor(() => expect(line().textContent).toBe(''));
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('Tab closes an open Start menu', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-actions');
    expect(active()).toBe(byId('copy-start'));
    // Not asserted: where Tab then moves focus. jsdom has no Tab default action; the browser moves it.
    key('Tab');
    expect(menuNamed(START_MENU)).toBeNull();
    expect(byId('copy-actions').getAttribute('aria-expanded')).toBe('false');
    click('copy-actions');
    key('Tab', true);
    expect(menuNamed(START_MENU)).toBeNull();
  });

  it('Tab closes an open card menu', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-menu');
    expect(menuNamed(CARD_MENU)).toBeTruthy();
    key('Tab');
    expect(menuNamed(CARD_MENU)).toBeNull();
    expect(byId('copy-menu').getAttribute('aria-expanded')).toBe('false');
  });

  it('an open menu does not take the arrow keys or Escape from a field', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-actions');
    const from = byId('opt-from');
    from.focus();
    // fireEvent returns false when a listener called preventDefault.
    expect(fireEvent.keyDown(from, { key: 'ArrowDown' })).toBe(true);
    expect(active()).toBe(from);
    expect(fireEvent.keyDown(from, { key: 'ArrowUp' })).toBe(true);
    expect(active()).toBe(from);
    expect(fireEvent.keyDown(from, { key: 'Escape' })).toBe(true);
    expect(active()).toBe(from);
  });

  it('Escape closes the menu and gives focus back to its button; the arrow keys stay on the one item', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-actions');
    expect(active()).toBe(byId('copy-start'));
    key('ArrowDown');
    expect(active()).toBe(byId('copy-start'));
    key('ArrowUp');
    expect(active()).toBe(byId('copy-start'));
    key('Escape');
    expect(menuNamed(START_MENU)).toBeNull();
    expect(active()).toBe(byId('copy-actions'));
  });

  it('a click outside closes the menu', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-actions');
    expect(menuNamed(START_MENU)).toBeTruthy();
    click('copy-status');
    expect(menuNamed(START_MENU)).toBeNull();
  });

  it('never has both menus open: opening one closes the other', async () => {
    const stopped = copy({ status: 'stopped' });
    setup({ list: async () => [stopped], status: async () => stopped });
    await openCopy();
    click('copy-menu');
    expect(menuNamed(CARD_MENU)).toBeTruthy();
    click('copy-actions');
    expect(menuNamed(CARD_MENU)).toBeNull();
    expect(byId('copy-menu').getAttribute('aria-expanded')).toBe('false');
    expect(menuNamed(START_MENU)).toBeTruthy();
    click('copy-menu');
    expect(menuNamed(START_MENU)).toBeNull();
    expect(byId('copy-actions').getAttribute('aria-expanded')).toBe('false');
    expect(menuNamed(CARD_MENU)).toBeTruthy();
    // The card menu still holds Stop and Delete, and nothing else.
    expect(within(menuNamed(CARD_MENU)!).getAllByRole('menuitem').map((i) => i.getAttribute('data-testid'))).toEqual(['copy-stop', 'copy-delete']);
  });
});
