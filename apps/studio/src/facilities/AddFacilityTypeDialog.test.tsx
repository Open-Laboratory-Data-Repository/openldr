import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    addFacilityType: vi.fn(),
  };
});

import * as api from '@/api';
import { AddFacilityTypeDialog } from './AddFacilityTypeDialog';

const mocked = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

/** ⛔ Actions live in a ⋯ `DropdownMenu` (AGENTS.md section 5, `RegisterSourceDialog.tsx`'s own
 *  shape), never a footer with Add/Cancel buttons. Same open idiom as
 *  `RegisterSourceDialog.test.tsx`'s own `openDialogMenu`: `userEvent.click` does not reliably
 *  open a Radix dropdown under jsdom, so this fires the pointer event Radix itself listens for,
 *  with a keyboard fallback. */
function openDialogMenu() {
  const trigger = screen.getByRole('button', { name: /actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

describe('AddFacilityTypeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the derived code and does not let it be edited', async () => {
    render(<AddFacilityTypeDialog open nationalSystem="urn:zm:mfl" registerName="Zambia MFL"
      rawValue="First-aid stations" onOpenChange={vi.fn()} onAdded={vi.fn()} />);

    expect(screen.getByLabelText('Name')).toHaveValue('First-aid stations');
    expect(screen.getByText('first-aid-stations')).toBeInTheDocument();
    expect(screen.queryByLabelText('Code')).not.toHaveAttribute('type', 'text');
  });

  it('re-derives the code as the name is edited', async () => {
    render(<AddFacilityTypeDialog open nationalSystem="urn:zm:mfl" registerName="Zambia MFL"
      rawValue="Optic Clinics" onOpenChange={vi.fn()} onAdded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Optic Clinic' } });

    expect(screen.getByText('optic-clinic')).toBeInTheDocument();
  });

  // ⛔ Deviation from the brief's literal snippet: the brief's own "Add type" click skipped opening
  // the ⋯ menu. That only works if "Add type" is a standalone button, exactly what AGENTS.md
  // section 5 and this dialog's own doc comment forbid. `RegisterSourceDialog.test.tsx`'s equivalent
  // error-path test (`shows the server error…`) opens its menu first for the same reason; this does
  // the same.
  it('reports a collision with the concept it hit, rather than adding a second one', async () => {
    mocked(api.addFacilityType).mockRejectedValue(
      Object.assign(new Error('conflict'), { collidesWith: { code: 'health-center', display: 'Health Center' } }),
    );
    const onAdded = vi.fn();
    render(<AddFacilityTypeDialog open nationalSystem="urn:zm:mfl" registerName="Zambia MFL"
      rawValue="Health Centre" onOpenChange={vi.fn()} onAdded={onAdded} />);

    openDialogMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add type' }));

    expect(await screen.findByText(/Health Center.*already in this list/i)).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
  });

  // ⛔ AGENTS.md section 5. Its own actions are a ⋯ menu in a header row, never a footer pair.
  it('puts its own actions in a dots menu, not a footer', () => {
    render(<AddFacilityTypeDialog open nationalSystem="urn:zm:mfl" registerName="Zambia MFL"
      rawValue="First-aid stations" onOpenChange={vi.fn()} onAdded={vi.fn()} />);

    expect(screen.getByRole('button', { name: /actions/i })).toBeInTheDocument();
  });
});
