import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ⛔ Deviation from the brief's literal test snippet, same reasoning Task 7's ColumnMapStep.test.tsx
// already recorded for its own "Keep as extra" case: the brief's Step 1 snippet never mocks '@/api'
// and its "save" test queries `getByRole('button', { name: /save mappings/i })` directly. Neither
// survives contact with this repo. `ValueMapPanel` genuinely calls `suggestValueMappings`/
// `writeFacilityValueMappings` itself (the brief's own `Produces` line lists no `suggestions` prop,
// unlike `ColumnMapStep` — this panel fetches its own), and there is no global `fetch` stub in
// `setupTests.ts`, so an unmocked call would hit whatever `fetch` Node's own runtime provides and
// reject on a relative URL — the panel must be exercised against a real, controllable mock, the same
// idiom `ImportFacilitiesSheet.test.tsx` already uses for every other `@/api` call. And "Save
// mappings" is a panel-level action, so AGENTS.md §5 puts it in the panel's own `⋯` `DropdownMenu`
// ("Page-header, sheet, and per-row actions all go in a MoreHorizontal DropdownMenu... Never a
// standalone Create/New button"), never a bare `<button>` — `DropdownMenuItem` only mounts once the
// menu is open (Radix Portal + conditional render), so `getByRole('button', ...)` could only ever
// match a plain button this convention forbids. The *intent* of every brief test (every unmapped
// value gets a ranked pick-list; Save writes the chosen mappings and reports how many; an unmapped
// value never blocks) is preserved exactly — see ColumnMapStep.test.tsx's own "Deviation" note for
// the same call made on the sibling panel Task 7 shipped.
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    suggestValueMappings: vi.fn(),
    writeFacilityValueMappings: vi.fn(),
  };
});

import * as api from '@/api';
import { ValueMapPanel } from './ValueMapPanel';

const mocked = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

/** Opens the panel's own `⋯` menu — same idiom as ColumnMapStep.test.tsx's `openRowMenu` and
 *  ImportFacilitiesSheet.test.tsx's `openMenu`: `userEvent.click` does not reliably open a Radix
 *  dropdown under jsdom, so this fires the pointer event Radix itself listens for, with a keyboard
 *  fallback. */
function openMenu() {
  const trigger = screen.getByRole('button', { name: /value mapping actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

function clickSave() {
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: /save mappings/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked(api.suggestValueMappings).mockResolvedValue({ values: [], notValidated: false });
  mocked(api.writeFacilityValueMappings).mockResolvedValue({ written: 0, superseded: [] });
});

describe('ValueMapPanel', () => {
  it('lists every unmapped value with a ranked pick-list, pre-selecting only a confident match', async () => {
    mocked(api.suggestValueMappings).mockImplementation(async (_field: string, values: string[]) => ({
      values: values.map((value) => ({
        value,
        candidates: value === 'Health Centre'
          ? [{ target: 'health-center', display: 'Health Center', score: 1, confidence: 'exact' as const }]
          : [],
      })),
      notValidated: false,
    }));
    render(<ValueMapPanel nationalSystem="urn:zm:mfl"
      unmapped={{ level: ['Health Centre', '1st Level Hospital'], status: [], country: [] }}
      onSaved={() => {}} />);

    expect(await screen.findByLabelText('Health Centre')).toHaveTextContent('Health Center');
    expect(screen.getByLabelText('1st Level Hospital')).toHaveTextContent('Not mapped');
  });

  it('groups rows by field, under that field\'s own label', async () => {
    render(<ValueMapPanel nationalSystem="urn:zm:mfl"
      unmapped={{ level: ['Health Centre'], status: ['Operating'], country: [] }}
      onSaved={() => {}} />);

    expect(await screen.findByLabelText('Health Centre')).toBeInTheDocument();
    expect(screen.getByLabelText('Operating')).toBeInTheDocument();
    expect(screen.getByText('Level')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    // country has nothing unmapped, so it gets no heading and no row.
    expect(screen.queryByText('Country')).not.toBeInTheDocument();
  });

  it('saves the chosen mappings and reports how many were written, then re-runs the preview', async () => {
    mocked(api.suggestValueMappings).mockResolvedValue({
      values: [{
        value: 'Health Centre',
        candidates: [{ target: 'health-center', display: null, score: 1, confidence: 'exact' }],
      }],
      notValidated: false,
    });
    mocked(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });
    const onSaved = vi.fn();
    render(<ValueMapPanel nationalSystem="urn:zm:mfl"
      unmapped={{ level: ['Health Centre'], status: [], country: [] }} onSaved={onSaved} />);

    // Wait for the exact suggestion to land (and pre-select itself) before saving — otherwise the
    // save would race the fetch and might send nothing.
    await waitFor(() => expect(screen.getByLabelText('Health Centre')).toHaveTextContent('health-center'));
    clickSave();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.writeFacilityValueMappings).toHaveBeenCalledWith(
      'urn:zm:mfl', [{ field: 'level', rawValue: 'Health Centre', toCode: 'health-center' }],
    );
    expect(await screen.findByText(/1 mapping\(s\) written/i)).toBeInTheDocument();
  });

  it('leaves an unmapped value alone rather than blocking the import — never renders a wall', async () => {
    render(<ValueMapPanel nationalSystem="urn:zm:mfl"
      unmapped={{ level: ['Hospice'], status: [], country: [] }} onSaved={() => {}} />);

    expect(await screen.findByLabelText('Hospice')).toHaveTextContent('Not mapped');
    expect(screen.queryByText(/cannot continue/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /save mappings/i })).not.toBeInTheDocument();
    // Saving with nothing chosen still completes (writes nothing) rather than being disabled/blocked.
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /save mappings/i }));
    await waitFor(() => expect(api.writeFacilityValueMappings).not.toHaveBeenCalled());
  });

  it('an operator can override a pre-selected suggestion by hand', async () => {
    mocked(api.suggestValueMappings).mockResolvedValue({
      values: [{
        value: 'Health Centre',
        candidates: [
          { target: 'health-center', display: 'Health Center', score: 1, confidence: 'exact' },
          { target: 'health-post', display: 'Health Post', score: 0.7, confidence: 'likely' },
        ],
      }],
      notValidated: false,
    });
    render(<ValueMapPanel nationalSystem="urn:zm:mfl"
      unmapped={{ level: ['Health Centre'], status: [], country: [] }} onSaved={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText('Health Centre')).toHaveTextContent('Health Center'));

    fireEvent.click(screen.getByLabelText('Health Centre'));
    fireEvent.click(await screen.findByRole('option', { name: 'Health Post' }));
    expect(screen.getByLabelText('Health Centre')).toHaveTextContent('Health Post');

    mocked(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });
    clickSave();
    await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalledWith(
      'urn:zm:mfl', [{ field: 'level', rawValue: 'Health Centre', toCode: 'health-post' }],
    ));
  });

  // ── The dead end an operator hit on the real Zambia export. Reported as "what do i do with
  // level/status warning ... I dont see any options". ──────────────────────────────────────────────

  it('⛔ offers the whole value set, so a value the ranker cannot place is still mappable', async () => {
    // `Functional` resembles none of active/suspended/inactive, so the ranker honestly returns no
    // candidates. The panel used to render ONLY candidates, so the single most obvious mapping in
    // the file could not be expressed at all.
    mocked(api.suggestValueMappings).mockResolvedValue({
      values: [{ value: 'Functional', candidates: [] }],
      options: [
        { code: 'active', display: 'Active' },
        { code: 'suspended', display: 'Suspended' },
        { code: 'inactive', display: 'Inactive' },
      ],
      notValidated: false,
    });
    render(<ValueMapPanel nationalSystem="urn:zm:mfl"
      unmapped={{ level: [], status: ['Functional'], country: [] }} onSaved={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText('Functional')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Functional'));
    fireEvent.click(await screen.findByRole('option', { name: 'Active' }));
    expect(screen.getByLabelText('Functional')).toHaveTextContent('Active');
  });

  it('⛔ says the request failed instead of looking like there is nothing to pick', async () => {
    // `.catch(() => null)` made a failed fetch indistinguishable from "no options": the operator
    // saw twenty-three pickers offering only "Not mapped" and no explanation anywhere.
    mocked(api.suggestValueMappings).mockRejectedValue(new Error('network down'));
    render(<ValueMapPanel nationalSystem="urn:zm:mfl"
      unmapped={{ level: ['Health Centre'], status: [], country: [] }} onSaved={() => {}} />);

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it('⛔ says so when the field has no value set at all', async () => {
    // A different cause with an identical symptom before this: nothing to map ONTO, rather than
    // nothing that matched. The route already reported it; the panel ignored it.
    mocked(api.suggestValueMappings).mockResolvedValue({
      values: [{ value: 'Health Centre', candidates: [] }],
      options: [],
      notValidated: true,
    });
    render(<ValueMapPanel nationalSystem="urn:zm:mfl"
      unmapped={{ level: ['Health Centre'], status: [], country: [] }} onSaved={() => {}} />);

    expect(await screen.findByText(/no value set/i)).toBeInTheDocument();
  });
});
