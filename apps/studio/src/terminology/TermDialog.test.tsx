import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { TermDialog } from './TermDialog';
import * as api from '../api';

const system: api.CodingSystem = {
  id: 'sys1',
  systemCode: 'LOINC',
  systemName: 'LOINC',
  url: 'http://loinc.org',
  systemVersion: null,
  description: null,
  active: true,
  publisherId: 'p',
  seeded: true, source: 'core', sourceRef: null,
};

describe('TermDialog', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('creates a term from the Details tab', async () => {
    const created: api.Term = {
      system: 'http://loinc.org',
      code: 'X',
      display: 'X term',
      status: 'ACTIVE',
      shortName: null,
      class: null,
      unit: null,
      replacedBy: null,
      metadata: null,
      mappingCount: 0,
    };
    vi.spyOn(api, 'createTerm').mockResolvedValue(created);
    const onSaved = vi.fn();

    render(
      <TermDialog
        open
        system={system}
        term={null}
        onOpenChange={() => {}}
        onSaved={onSaved}
        onDeleted={() => {}}
      />,
    );

    // Code input — label is "Code"
    fireEvent.change(screen.getByLabelText(/^code$/i), { target: { value: 'X' } });
    // Display name input — label is "Display name"
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'X term' } });

    // Open the ⋯ actions menu — Radix opens on pointerdown under jsdom
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /create/i })) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }

    // Click the Create menuitem
    const createItem = await screen.findByRole('menuitem', { name: /create/i });
    fireEvent.pointerMove(createItem);
    fireEvent.click(createItem);

    await waitFor(() =>
      expect(api.createTerm).toHaveBeenCalledWith(
        'sys1',
        expect.objectContaining({ code: 'X', display: 'X term' }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('disables the Mappings tab when creating (term=null)', () => {
    render(
      <TermDialog
        open
        system={system}
        term={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /mappings/i })).toBeDisabled();
  });

  it('blocks save when metadata is invalid JSON', async () => {
    vi.spyOn(api, 'createTerm').mockResolvedValue({} as never);
    render(<TermDialog open system={system as never} term={null} onOpenChange={() => {}} onSaved={() => {}} onDeleted={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^code$/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'X term' } });
    fireEvent.change(screen.getByLabelText(/metadata/i), { target: { value: '{bad json' } });
    const actionsBtn2 = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn2, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /create/i })) {
      fireEvent.keyDown(actionsBtn2, { key: 'Enter' });
    }
    const createItem2 = await screen.findByRole('menuitem', { name: /create/i });
    fireEvent.pointerMove(createItem2);
    fireEvent.click(createItem2);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/invalid json/i)));
    expect(screen.queryByText(/invalid json/i)).not.toBeInTheDocument();
    expect(api.createTerm).not.toHaveBeenCalled();
  });

  it('a failed save shows a toast and keeps the sheet open with the input', async () => {
    vi.spyOn(api, 'createTerm').mockRejectedValue(new Error('create term failed: code exists'));
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<TermDialog open system={system} term={null} onOpenChange={onOpenChange} onSaved={onSaved} onDeleted={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^code$/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'X term' } });
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /create/i })) fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    const createItem = await screen.findByRole('menuitem', { name: /create/i });
    fireEvent.pointerMove(createItem);
    fireEvent.click(createItem);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('create term failed: code exists'));
    expect(screen.queryByText('create term failed: code exists')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toHaveValue('X term');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('a failed mappings load shows one toast and the could-not-load text, not "no mappings"', async () => {
    vi.spyOn(api, 'listTermMappings').mockRejectedValue(new Error('list mappings failed: 503'));
    const term: api.Term = {
      system: 'http://loinc.org', code: 'X', display: 'X term', status: 'ACTIVE', shortName: null,
      class: null, unit: null, replacedBy: null, metadata: null, mappingCount: 0,
    };
    render(<TermDialog open system={system} term={term} onOpenChange={() => {}} onSaved={() => {}} onDeleted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /mappings/i }));

    expect(await screen.findByText('Could not load this list. Reload the page to try again.')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('list mappings failed: 503');
    expect(screen.queryByText('list mappings failed: 503')).not.toBeInTheDocument();
  });
});
