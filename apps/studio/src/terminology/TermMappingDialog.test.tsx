import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TermMappingDialog } from './TermMappingDialog';
import * as api from '../api';

vi.mock('./ontology/OntologyPickerDialog', () => ({
  OntologyPickerDialog: ({
    open,
    onPick,
  }: {
    open: boolean;
    onPick: (node: { code: string; display: string }) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onPick({ code: '718-7', display: 'Hemoglobin' })}>
        Pick ontology target
      </button>
    ) : null,
}));

const system: api.CodingSystem = {
  id: 'sys1',
  systemCode: 'LOINC',
  systemName: 'LOINC',
  url: 'http://loinc.org',
  systemVersion: null,
  description: null,
  active: true,
  publisherId: 'p',
  seeded: true,
};

const secondSystem: api.CodingSystem = {
  id: 'sys2',
  systemCode: 'ICD10',
  systemName: 'ICD-10',
  url: 'http://icd10.org',
  systemVersion: null,
  description: null,
  active: true,
  publisherId: 'p',
  seeded: true,
};

const registrySystem: api.CodingSystem = {
  id: 'sys-reg',
  systemCode: 'FACILITY-REGISTRY',
  systemName: 'OpenLDR facility registry',
  url: 'urn:openldr:cs:facility-registry',
  systemVersion: null,
  description: null,
  active: true,
  publisherId: 'pub-system',
  seeded: false,
};

const fromTerm = {
  system: 'http://x',
  code: 'AMP',
  display: 'Ampicillin',
  systemCode: 'WHONET',
};

const stubMapping: api.TermMapping = {
  id: 'm1',
  fromSystem: 'http://x',
  fromCode: 'AMP',
  toSystem: 'http://loinc.org',
  toCode: '1',
  toDisplay: 'L',
  mapType: 'SAME-AS',
  relationship: null,
  owner: null,
  isActive: true,
};

describe('TermMappingDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders the sheet header in create mode', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('New mapping')).toBeTruthy();
    // from-term shown in description
    expect(screen.getByText(/WHONET.*AMP/)).toBeTruthy();
  });

  it('renders the sheet header in edit mode', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={stubMapping}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('Edit mapping')).toBeTruthy();
  });

  it('creates a manual mapping and reports draftCreated=true', async () => {
    vi.spyOn(api, 'createTermMapping').mockResolvedValue({
      mapping: stubMapping,
      draftCreated: true,
    });
    const onSaved = vi.fn();
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );

    // Switch to manual mode
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));

    // Fill manual code (the system Select is pre-seeded to the first active system)
    const codeInput = screen.getByPlaceholderText('441407007');
    fireEvent.change(codeInput, { target: { value: '1' } });

    // Open the ⋯ dropdown (Radix opens on pointerDown in jsdom)
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Create')) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }
    const createItem = await screen.findByText('Create');
    fireEvent.pointerMove(createItem);
    fireEvent.click(createItem);

    await waitFor(() => {
      expect(api.createTermMapping).toHaveBeenCalledWith(
        'http://x',
        'AMP',
        expect.objectContaining({ toCode: '1', mapType: 'SAME-AS', isActive: true }),
      );
      expect(onSaved).toHaveBeenCalledWith(stubMapping, true);
    });
  });

  it('updates an existing mapping and reports draftCreated=false', async () => {
    const updated = { ...stubMapping, toCode: '2' };
    vi.spyOn(api, 'updateTermMapping').mockResolvedValue(updated);
    const onSaved = vi.fn();
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={stubMapping}
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );

    // In edit mode the dialog opens in manual mode, code field pre-filled
    const codeInput = screen.getByPlaceholderText('441407007');
    expect((codeInput as HTMLInputElement).value).toBe('1');

    // Change the code
    fireEvent.change(codeInput, { target: { value: '2' } });

    // Open the ⋯ dropdown (Radix opens on pointerDown in jsdom)
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Save')) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }
    const saveItem = await screen.findByText('Save');
    fireEvent.pointerMove(saveItem);
    fireEvent.click(saveItem);

    await waitFor(() => {
      expect(api.updateTermMapping).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ fromSystem: 'http://x', fromCode: 'AMP', toCode: '2' }),
      );
      expect(onSaved).toHaveBeenCalledWith(updated, false);
    });
  });

  it('uses Browse ontology to fill a ready manual target', async () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        distributions={{
          sys1: {
            codingSystemId: 'sys1',
            ontologyType: 'loinc',
            sourcePath: 'D:\\terminology\\loinc',
            indexStatus: 'ready',
            indexError: null,
            nodeCount: 10,
            edgeCount: 9,
            builtAt: '2026-06-16T00:00:00.000Z',
            updatedAt: '2026-06-16T00:00:00.000Z',
            stale: false,
          },
        }}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    // Switch to manual mode
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));

    const browseBtn = screen.getByRole('button', { name: /browse loinc/i });
    expect(browseBtn).toBeEnabled();
    fireEvent.click(browseBtn);
    fireEvent.click(await screen.findByText('Pick ontology target'));

    expect(screen.getByPlaceholderText('441407007')).toHaveValue('718-7');
    expect(screen.getByPlaceholderText('Human-readable label')).toHaveValue('Hemoglobin');
  });

  // Fix 3 (mapping-ux report): a target system whose ontology distribution EXISTS but isn't ready
  // yet (still building, or errored) really is "coming soon" — the existing tooltip wording is
  // accurate for this case and must be UNCHANGED.
  it('a target system with a distribution that is still building shows "not built yet", and Browse stays disabled', async () => {
    const user = userEvent.setup();
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        distributions={{
          sys1: {
            codingSystemId: 'sys1', ontologyType: 'loinc', sourcePath: 'D:\\terminology\\loinc',
            indexStatus: 'building', indexError: null, nodeCount: null, edgeCount: null,
            builtAt: null, updatedAt: '2026-08-05T00:00:00.000Z', stale: false,
          },
        }}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));
    const browseBtn = screen.getByRole('button', { name: /browse loinc/i });
    expect(browseBtn).toBeDisabled();

    await user.hover(browseBtn.closest('span') ?? browseBtn);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toMatch(/ontology index is built/i);
  }, 15000);

  // ⛔ THE bug report's Fix 3 scenario: `ObservedTab.tsx` (the operator's actual path — registering
  // a facility, then Map on an Observed row) never passes `distributions` at all, so it defaults to
  // `{}` — meaning `FACILITY-REGISTRY` (and any other local, never-ontology-backed system) NEVER has
  // a distribution entry. The old single tooltip wording ("Available once the target system's
  // ontology index is built") falsely implies this is merely pending, when for a system like this it
  // can never happen. The disabled affordance must say so and point at Search instead.
  it('a target system with NO ontology distribution at all (distributions omitted, mirroring ObservedTab) shows a "never browsable — use Search" hint, not "not built yet"', async () => {
    const user = userEvent.setup();
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        // `distributions` deliberately omitted — this is exactly how ObservedTab.tsx renders this
        // dialog today (it never passes the prop), so this reproduces the operator's real path.
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));
    const browseBtn = screen.getByRole('button', { name: /browse loinc/i });
    expect(browseBtn).toBeDisabled();

    await user.hover(browseBtn.closest('span') ?? browseBtn);
    // Scoped to the tooltip content itself (role="tooltip") — the mode-toggle button also reads
    // "Search terms" once in manual mode, which would false-positive a bare page-wide text query.
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toMatch(/search/i);
    expect(tooltip.textContent).not.toMatch(/ontology index is built/i);
  }, 15000);

  it('shows general section fields: map-type select, relationship, owner', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Map type')).toBeTruthy();
    expect(screen.getByText('Relationship')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('disables Create until a manual target code is entered', async () => {
    vi.spyOn(api, 'createTermMapping').mockResolvedValue({
      mapping: stubMapping,
      draftCreated: false,
    });
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system as never]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    // Switch to manual mode (code field is empty → canSave=false)
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));

    // Open the Actions dropdown (same technique as the create/update tests above)
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Create')) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }

    // Find the Create menu item — Radix sets data-disabled on a disabled DropdownMenuItem
    const createItem = await screen.findByText('Create');
    const menuItem = createItem.closest('[role="menuitem"]') ?? createItem;
    expect(menuItem).toHaveAttribute('data-disabled');

    // Clicking it must NOT invoke the API
    fireEvent.click(createItem);
    expect(api.createTermMapping).not.toHaveBeenCalled();
  });

  // Regression guard for the Observed tab's `lockedTargetSystem` prop (facility-mapping-targets
  // slice): `/terminology`'s own `TermDialog` caller never passes it, and must keep offering the
  // FULL multi-system picker exactly as before — this is the caller most at risk of an accidental
  // behaviour change from a prop that defaults to "off" everywhere else. Asserts on what actually
  // renders, not merely that `lockedTargetSystem` was omitted.
  it("/terminology's caller (no lockedTargetSystem) still shows the full system selector, in both search and manual mode", () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system, secondSystem]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    // Search mode (default on create): 2+ active systems renders the "System" Select — a SECOND
    // combobox alongside "Map type".
    expect(screen.getAllByRole('combobox')).toHaveLength(2);

    // Manual mode: same Select, unconditionally rendered, offering both systems.
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes).toHaveLength(2);
    fireEvent.click(comboboxes[comboboxes.length - 1]);
    expect(screen.getByRole('option', { name: 'LOINC' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ICD10' })).toBeInTheDocument();
  });

  // Code-review finding (Fix 1, facility-mapping-targets round 1): under `lockedTargetSystem`, the
  // System control used to be replaced with a bare `<div>` — no role, no tabIndex, no accessible
  // name, no id/label pairing. A sighted user reads "System: FACILITY-REGISTRY" by visual
  // proximity; a screen-reader user tabbing the form got nothing at all. These pin that the field is
  // now reachable by an ACCESSIBLE query (not merely visible text) and exposes the locked system's
  // value, in both target modes.
  it('exposes the locked target system as an accessible, labelled field in search mode', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        lockedTargetSystem={registrySystem}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    // Create mode defaults to search mode — the locked field renders without switching.
    const field = screen.getByLabelText('System') as HTMLInputElement;
    expect(field.value).toBe('FACILITY-REGISTRY');
  });

  it('exposes the locked target system as an accessible, labelled field in manual mode', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        lockedTargetSystem={registrySystem}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));
    const field = screen.getByLabelText('System') as HTMLInputElement;
    expect(field.value).toBe('FACILITY-REGISTRY');
  });

  // Fix 3 (mapping-targets report, "Locked target system" section): editing an existing mapping
  // under lock jumps the manual System field to the LOCKED system regardless of the mapping's own
  // `toSystem` — this is the operator's live scenario (their stale `BALAB -> DEFAULT_FAC|BALAB`
  // self-mapping, opened from the Observed tab). Pins the DOCUMENTED current behaviour; the stale
  // code is left untouched, so nothing auto-saves a retarget without the operator also fixing Code.
  it('editing a non-facility mapping under lock pre-fills System to the locked system, not the mapping\'s own toSystem', () => {
    const selfMapping: api.TermMapping = {
      id: 'm-self',
      fromSystem: 'urn:openldr:default_fac',
      fromCode: 'BALAB',
      toSystem: 'urn:openldr:default_fac',
      toCode: 'BALAB',
      toDisplay: null,
      mapType: 'SAME-AS',
      relationship: null,
      owner: null,
      isActive: true,
    };
    render(
      <TermMappingDialog
        open
        fromTerm={{ system: 'urn:openldr:default_fac', code: 'BALAB', display: null, systemCode: 'DEFAULT_FAC' }}
        systems={[system]}
        lockedTargetSystem={registrySystem}
        mapping={selfMapping}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    // Edit mode always opens in manual mode.
    const field = screen.getByLabelText('System') as HTMLInputElement;
    expect(field.value).toBe('FACILITY-REGISTRY');
    // The stale code is NOT auto-corrected — the operator still has to retype/repick it themselves.
    expect(screen.getByPlaceholderText('441407007')).toHaveValue('BALAB');
  });

  it('shows the status section with is-active checkbox checked by default', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('Status')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeTruthy();
    // Default isActive=true
    expect((checkbox as HTMLInputElement).getAttribute('data-state')).toBe('checked');
  });
});
