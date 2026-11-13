import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    fetchLabIdentity: vi.fn(),
    saveLabIdentity: vi.fn(),
    fetchSampleDataAllowed: vi.fn(),
    loadSampleData: vi.fn(),
    runSetupChecks: vi.fn(),
  };
});
import * as api from '@/api';
import { FirstRunPage } from './FirstRunPage';
import { timeZoneOptions } from './LabStep';

// Layer proven here: the three steps, with the API mocked. The routes have their own tests.

const identity = (values: Record<string, string>) => ({
  fields: [], values, logo: { maxBytes: 1, mimeTypes: [] },
});

const checks = {
  ok: false,
  checks: [
    { id: 'adapters', status: 'pass' },
    { id: 'labName', status: 'warn', hint: 'labNameDefault', fix: '/settings/laboratory' },
    { id: 'connectors', status: 'fail', hint: 'connectorFailed', fix: '/settings/connectors' },
    { id: 'sync', status: 'skip' },
  ],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const page = (onDone = vi.fn()) => {
  render(<MemoryRouter><FirstRunPage onDone={onDone} /></MemoryRouter>);
  return onDone;
};

const button = (name: string) => screen.getByRole('button', { name });

/** Waits for step 1 to finish loading, then presses its Skip. */
async function skipLab() {
  await screen.findByLabelText('Name');
  fireEvent.click(button('Skip'));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchLabIdentity).mockResolvedValue(identity({ 'lab.name': 'Central Lab', 'lab.timezone': 'Africa/Maputo' }) as never);
  vi.mocked(api.saveLabIdentity).mockResolvedValue({});
  vi.mocked(api.fetchSampleDataAllowed).mockResolvedValue(true);
  vi.mocked(api.loadSampleData).mockResolvedValue(undefined);
  vi.mocked(api.runSetupChecks).mockResolvedValue(checks as never);
});

describe('FirstRunPage, step 1', () => {
  let zoneSpy: ReturnType<typeof vi.spyOn> | null = null;
  const browserZone = (zone: string) => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    zoneSpy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: zone };
    });
  };
  afterEach(() => { zoneSpy?.mockRestore(); zoneSpy = null; });

  it('shows the stored name; Save sends both keys once, then step 2 shows', async () => {
    page();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Central Lab');
    expect(button('Africa/Maputo')).toBeInTheDocument();
    fireEvent.change(name, { target: { value: 'Mbeya Lab' } });
    fireEvent.click(button('Save'));
    expect(await screen.findByRole('heading', { name: 'Sample data' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(api.saveLabIdentity).toHaveBeenCalledTimes(1);
    expect(api.saveLabIdentity).toHaveBeenCalledWith({ 'lab.name': 'Mbeya Lab', 'lab.timezone': 'Africa/Maputo' });
  });

  it('offers the browser zone first, and starts there when no zone is stored', async () => {
    browserZone('Pacific/Fiji');
    vi.mocked(api.fetchLabIdentity).mockResolvedValue(identity({ 'lab.name': 'Central Lab', 'lab.timezone': '' }) as never);
    page();
    await screen.findByLabelText('Name');
    fireEvent.click(button('Pacific/Fiji'));
    const list = within(await screen.findByRole('dialog'));
    const options = list.getAllByRole('button');
    expect(options[0]).toHaveTextContent('Pacific/Fiji');
    // The real list, from Intl.supportedValuesOf, with the browser zone only once.
    expect(options.length).toBeGreaterThan(300);
    expect(options.filter((o) => o.textContent === 'Pacific/Fiji')).toHaveLength(1);
  });

  it('falls back to the browser zone and UTC where Intl.supportedValuesOf is missing', () => {
    browserZone('Pacific/Fiji');
    const real = Intl.supportedValuesOf;
    // @ts-expect-error -- removed on purpose for this one test, restored below
    delete Intl.supportedValuesOf;
    try {
      expect(timeZoneOptions('').map((o) => o.value)).toEqual(['Pacific/Fiji', 'UTC']);
    } finally {
      Intl.supportedValuesOf = real;
    }
  });

  it('offers UTC once, after the browser zone, though Intl.supportedValuesOf does not list it', () => {
    browserZone('Pacific/Fiji');
    const values = timeZoneOptions('').map((o) => o.value);
    expect(values[0]).toBe('Pacific/Fiji');
    expect(values.filter((v) => v === 'UTC')).toHaveLength(1);
    expect(values.indexOf('UTC')).toBe(1);
  });

  it('offers UTC only once when it is the browser zone', () => {
    browserZone('UTC');
    const values = timeZoneOptions('UTC').map((o) => o.value);
    expect(values[0]).toBe('UTC');
    expect(values.filter((v) => v === 'UTC')).toHaveLength(1);
  });

  it('a failed load leaves the stored name alone: Save without typing sends no name', async () => {
    vi.mocked(api.fetchLabIdentity).mockRejectedValue(new Error('load lab identity failed: 500'));
    page();
    await screen.findByLabelText('Name');
    fireEvent.click(button('Save'));
    await screen.findByRole('heading', { name: 'Sample data' });
    expect(api.saveLabIdentity).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(api.saveLabIdentity).mock.calls[0]![0] as Record<string, string>;
    expect(Object.keys(sent)).toEqual(['lab.timezone']);
  });

  it('a failed load still sends a name the person typed', async () => {
    vi.mocked(api.fetchLabIdentity).mockRejectedValue(new Error('load lab identity failed: 500'));
    page();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '  Mbeya Lab ' } });
    fireEvent.click(button('Save'));
    await screen.findByRole('heading', { name: 'Sample data' });
    const sent = vi.mocked(api.saveLabIdentity).mock.calls[0]![0] as Record<string, string>;
    expect(sent['lab.name']).toBe('Mbeya Lab');
    expect(Object.keys(sent).sort()).toEqual(['lab.name', 'lab.timezone']);
  });

  it('keeps a stored zone the list does not hold', () => {
    browserZone('Pacific/Fiji');
    const values = timeZoneOptions('Old/Zone').map((o) => o.value);
    expect(values.slice(0, 2)).toEqual(['Pacific/Fiji', 'Old/Zone']);
  });

  it('a failed save shows the error and stays on step 1', async () => {
    vi.mocked(api.saveLabIdentity).mockRejectedValue(new Error('save lab identity failed: invalid lab identity'));
    page();
    await screen.findByLabelText('Name');
    fireEvent.click(button('Save'));
    expect((await screen.findByRole('alert')).textContent).toContain('invalid lab identity');
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(button('Save')).toBeEnabled();
  });
});

describe('FirstRunPage, skipping', () => {
  it('Skip, Skip, then Open OpenLDR ends the flow and sends nothing', async () => {
    const onDone = page();
    await skipLab();
    await screen.findByRole('heading', { name: 'Sample data' });
    fireEvent.click(button('Skip'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open OpenLDR' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(api.saveLabIdentity).not.toHaveBeenCalled();
    expect(api.loadSampleData).not.toHaveBeenCalled();
  });

  it('goes from step 1 straight to step 3 when sample data is not allowed', async () => {
    vi.mocked(api.fetchSampleDataAllowed).mockResolvedValue(false);
    page();
    await skipLab();
    expect(await screen.findByRole('heading', { name: 'You are ready' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sample data' })).toBeNull();
  });

  it('shows Skip under the spinner while the question has no answer, and Skip goes to step 3', async () => {
    vi.mocked(api.fetchSampleDataAllowed).mockReturnValue(new Promise<boolean>(() => {}));
    page();
    await skipLab();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(button('Skip'));
    expect(await screen.findByRole('heading', { name: 'You are ready' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(api.loadSampleData).not.toHaveBeenCalled();
  });

  it('goes from step 1 straight to step 3 when the question fails', async () => {
    vi.mocked(api.fetchSampleDataAllowed).mockRejectedValue(new Error('check sample data failed: 403'));
    page();
    await skipLab();
    expect(await screen.findByRole('heading', { name: 'You are ready' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sample data' })).toBeNull();
  });
});

describe('FirstRunPage, step 2', () => {
  it('Load calls loadSampleData once, holds both buttons while it runs, then shows step 3', async () => {
    const load = deferred<void>();
    vi.mocked(api.loadSampleData).mockReturnValue(load.promise);
    page();
    await skipLab();
    await screen.findByRole('heading', { name: 'Sample data' });
    fireEvent.click(button('Load sample data'));
    expect(api.loadSampleData).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Loading sample data…')).toBeInTheDocument();
    expect(button('Load sample data')).toBeDisabled();
    expect(button('Skip')).toBeDisabled();
    await act(async () => { load.resolve(); });
    expect(await screen.findByRole('heading', { name: 'You are ready' })).toBeInTheDocument();
    expect(api.loadSampleData).toHaveBeenCalledTimes(1);
  });

  it('a rejected load shows its message and Skip still works', async () => {
    vi.mocked(api.loadSampleData).mockRejectedValue(new Error('load sample data failed: This install already holds lab data · has_lab_data'));
    page();
    await skipLab();
    await screen.findByRole('heading', { name: 'Sample data' });
    fireEvent.click(button('Load sample data'));
    expect((await screen.findByRole('alert')).textContent).toContain('already holds lab data');
    expect(button('Skip')).toBeEnabled();
    fireEvent.click(button('Skip'));
    expect(await screen.findByRole('heading', { name: 'You are ready' })).toBeInTheDocument();
  });
});

describe('FirstRunPage, step 3', () => {
  async function toStep3() {
    vi.mocked(api.fetchSampleDataAllowed).mockResolvedValue(false);
    const onDone = page();
    await skipLab();
    await screen.findByRole('heading', { name: 'You are ready' });
    return onDone;
  }

  it('lists the warn and fail checks, not the pass or skip ones', async () => {
    await toStep3();
    expect((await screen.findByTestId('setup-check-labName')).getAttribute('data-status')).toBe('warn');
    expect(screen.getByTestId('setup-check-connectors').getAttribute('data-status')).toBe('fail');
    expect(screen.queryByTestId('setup-check-adapters')).toBeNull();
    expect(screen.queryByTestId('setup-check-sync')).toBeNull();
    expect(screen.queryByText(/Nothing needs you now/)).toBeNull();
  });

  it('says nothing needs the person when every check passed', async () => {
    vi.mocked(api.runSetupChecks).mockResolvedValue({ ok: true, checks: [{ id: 'adapters', status: 'pass' }] } as never);
    await toStep3();
    expect(await screen.findByText(/Nothing needs you now/)).toBeInTheDocument();
    expect(screen.queryByTestId('setup-check-adapters')).toBeNull();
  });

  it('shows the error when the checks cannot run, and still lets the person in', async () => {
    vi.mocked(api.runSetupChecks).mockRejectedValue(new Error('run setup checks failed: 500'));
    const onDone = await toStep3();
    expect((await screen.findByRole('alert')).textContent).toContain('500');
    fireEvent.click(button('Open OpenLDR'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Open OpenLDR calls onDone', async () => {
    const onDone = await toStep3();
    await screen.findByTestId('setup-check-labName');
    fireEvent.click(button('Open OpenLDR'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("following a row's fix link calls onDone too", async () => {
    const onDone = await toStep3();
    const link = await screen.findByTestId('setup-fix-labName');
    expect(link.getAttribute('href')).toBe('/settings/laboratory');
    fireEvent.click(link);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
