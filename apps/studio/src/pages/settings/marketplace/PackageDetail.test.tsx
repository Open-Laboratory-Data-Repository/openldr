import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getAvailableArtifact: vi.fn() };
});
import * as api from '@/api';
import { PackageDetail } from './PackageDetail';
import type { CardEntry } from './util';

const entry: CardEntry = {
  ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin',
  publisher: { id: 'p', name: 'OpenLDR Reference' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }], valid: true,
};

beforeEach(() => { vi.clearAllMocks(); });

function mockDetail(over: Partial<api.AvailableArtifactDetail> = {}) {
  (api.getAvailableArtifact as any).mockResolvedValue({
    ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin',
    description: 'Converts WHONET SQLite to FHIR.', license: 'Apache-2.0',
    publisher: { id: 'p', name: 'OpenLDR Reference' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0',
    payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } },
    valid: true, ...over,
  });
}

/** Open the detail pane's ⋯ menu. AGENTS.md section 5 moved Install and Publish into it on
 *  2026-08-21, so every action there is now reached this way. Radix opens on pointerDown in jsdom,
 *  with a keyboard fallback, matching the pattern already used further down this file. */
async function openDetailMenu(): Promise<void> {
  const trigger = await screen.findByTestId('detail-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByTestId('detail-install') && !screen.queryByTestId('detail-publish')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

describe('PackageDetail', () => {
  it('fetches and renders description, permissions and requirements', async () => {
    mockDetail();
    render(<PackageDetail entry={entry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(await screen.findByText(/Converts WHONET SQLite/)).toBeTruthy();
    expect(screen.getByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByText(/Compatible with CE/)).toBeTruthy();
  });

  it('Install calls onInstall with the fetched capabilities', async () => {
    mockDetail();
    const onInstall = vi.fn();
    render(<PackageDetail entry={entry} onBack={() => {}} onInstall={onInstall} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-install'));
    await waitFor(() => expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'whonet-narrow' }),
      [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    ));
  });

  it('acknowledges the DETAIL capabilities even when the list entry carries none', async () => {
    // Regression: the registry LIST endpoint omits capabilities, so a real Browse entry
    // arrives with capabilities: []. Install must wait for the signed DETAIL and acknowledge
    // its real capability set — otherwise the server rejects (acknowledged != requested).
    mockDetail({ capabilities: [
      { kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation', 'DiagnosticReport', 'ServiceRequest'] },
      { kind: 'net-egress', allowedHosts: [] },
    ] });
    const listEntry: CardEntry = { ...entry, capabilities: [] };
    const onInstall = vi.fn();
    render(<PackageDetail entry={listEntry} onBack={() => {}} onInstall={onInstall} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    // The consent trigger surfaces the REAL capabilities, not "none".
    await openDetailMenu();
    const btn = await screen.findByTestId('detail-install');
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(screen.getByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByText(/net-egress/)).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'whonet-narrow' }),
      [
        { kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation', 'DiagnosticReport', 'ServiceRequest'] },
        { kind: 'net-egress', allowedHosts: [] },
      ],
    ));
  });

  // ⛔ Back moved INTO the ⋯ menu on 2026-08-21 to reclaim the row it had to itself — a button,
  // a divider and their padding, about 50px, at the top of every phone screen. So it must be
  // reached the way every other action here is: open the menu first.
  it('Back calls onBack, from inside the menu', async () => {
    mockDetail();
    const onBack = vi.fn();
    render(<PackageDetail entry={entry} onBack={onBack} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(screen.queryByTestId('detail-back'), 'no standalone Back button outside the menu').toBeNull();
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders the readme docs section when present', async () => {
    mockDetail({ readme: '# Setup\n\nstep one' });
    render(<PackageDetail entry={entry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(await screen.findByText('Setup')).toBeTruthy();
  });

  it('switches version and installs the selected ref', async () => {
    (api.getAvailableArtifact as any).mockImplementation((ref: string) =>
      Promise.resolve({ ref, id: 'whonet-sqlite', version: ref === 'whonet-narrow' ? '1.0.0' : '1.1.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [], compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0', payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } }, valid: true }));
    const onInstall = vi.fn();
    const versioned = { ref: 'whonet-wide', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [], valid: true, installed: false, versions: [{ version: '1.1.0', ref: 'whonet-wide' }, { version: '1.0.0', ref: 'whonet-narrow' }] };
    render(<PackageDetail entry={versioned as any} onBack={vi.fn()} onInstall={onInstall} onToggleEnabled={vi.fn()} onRollback={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('version-select'));
    fireEvent.click(await screen.findByRole('option', { name: '1.0.0' }));
    await waitFor(() => expect(api.getAvailableArtifact).toHaveBeenCalledWith('whonet-narrow'));
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-install'));
    expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ ref: 'whonet-narrow' }), expect.anything());
  });

  it('installed item shows the actions menu instead of Install', async () => {
    const installedEntry: CardEntry = { ...entry, ref: undefined, installed: true, active: true, enabled: true };
    render(<PackageDetail entry={installedEntry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(await screen.findByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByTestId('detail-menu')).toBeTruthy();
    // ⛔ Absent from the OPEN menu, not merely absent from the page. Since the actions moved into
    // the ⋯ menu, a closed menu renders no items at all, so asserting on the closed page would
    // pass even if Install were still offered for an installed package.
    await openDetailMenu();
    expect(screen.queryByTestId('detail-install')).toBeNull();
  });

  // ⛔ REGRESSION, reported 2026-08-21 from a phone: the detail body was unreadable, wrapping one
  // or two words a line ("DHIS2 / aggregate + / tracker sink / (mapping, / metadata, / push)").
  //
  // The body was a hardcoded two-column grid set through an INLINE STYLE,
  // `gridTemplateColumns: 'minmax(0,1fr) 244px'`. An inline style cannot carry a media query, so
  // the 244px sidebar held its width on every screen: on a 360px phone that left the main column
  // about 90px once the gap and padding were paid. The columns are Tailwind classes now, so the
  // body is a single column below `md`.
  //
  // The sidebar comes FIRST when stacked. It is short and factual (publisher, version, license,
  // permissions) where the readme above it can run for screens, and on a phone anything after a
  // long readme is effectively gone.
  //
  // ⚠ HONEST NON-PROOF: jsdom applies no media queries. This pins the classes and the absence of
  // the inline style, not the rendered column count.
  // ⛔ The studio ships Tailwind WITHOUT global preflight, on purpose, to protect the older
  // token-CSS pages (see tokens.css). So a bare <h1> KEEPS its user-agent `margin: 0.67em 0`, which
  // at `text-xl` is 13.4px of space nobody asked for. Stacked on the wrapper's `p-4` and the title
  // row's own padding, the detail view opened with 45px of dead band above the title on a phone.
  //
  // ⚠ This is not local tidying. Any heading added anywhere in this app carries the same stray
  // margin, and there is no preflight coming to remove it.
  it('zeroes the title margin, because this app has no preflight to do it', async () => {
    mockDetail();
    const { container } = render(<PackageDetail entry={entry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    await screen.findByText(/Converts WHONET SQLite/);
    expect(container.querySelector('h1')?.className, 'a UA margin no preflight will strip').toMatch(/(^|\s)m-0(\s|$)/);
  });

  describe('mobile layout', () => {
    it('stacks the body into one column below md, instead of holding a 244px sidebar', async () => {
      mockDetail();
      const { container } = render(<PackageDetail entry={entry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
      await screen.findByText(/Converts WHONET SQLite/);
      const grid = container.querySelector('[data-testid="detail-body"]');
      expect(grid, 'the body grid must be findable').toBeTruthy();
      expect(grid?.getAttribute('style') ?? '', 'an inline style cannot carry a media query').not.toMatch(/gridTemplateColumns|grid-template-columns/);
      expect(grid?.className, 'two columns only from md up').toMatch(/md:grid-cols-/);
    });

    it('puts the details sidebar above the readme when stacked', async () => {
      mockDetail();
      const { container } = render(<PackageDetail entry={entry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
      await screen.findByText(/Converts WHONET SQLite/);
      const side = container.querySelector('[data-testid="detail-side"]');
      expect(side?.className, 'first on a phone').toMatch(/order-first/);
      expect(side?.className, 'back in place on desktop').toMatch(/md:order-none/);
    });
  });
});
