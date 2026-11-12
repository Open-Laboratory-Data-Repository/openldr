import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import i18n from '@/i18n';
import { CAPABILITY_GROUPS } from '@openldr/rbac';
import { en } from '@/i18n/en';
import { fr } from '@/i18n/fr';
import { pt } from '@/i18n/pt';
import type { CapabilityGroup } from '@/api';
import { CapabilityGrid } from './CapabilityGrid';

const groups: CapabilityGroup[] = [
  {
    key: 'users', label: 'Users',
    capabilities: [
      { key: 'users.view', group: 'users', label: 'View users', description: 'See the user list' },
    ],
  },
];

describe('CapabilityGrid (render smoke tests — selection logic itself is covered by capabilityGrid.model.test.ts)', () => {
  afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

  it.each([['en', en], ['fr', fr], ['pt', pt]] as const)(
    'renders the shared Data Exposure policy description in %s', async (language, messages) => {
      await act(async () => { await i18n.changeLanguage(language); });
      render(<CapabilityGrid groups={CAPABILITY_GROUPS} selected={new Set()} onChange={vi.fn()} />);
      const group = screen.getByTestId('capability-group-data_exposure');
      expect(within(group).getByText(messages.settings.dataExposure.description)).toBeTruthy();
      const metadata = CAPABILITY_GROUPS.flatMap((entry) => entry.capabilities)
        .find((capability) => capability.key === 'data_exposure.manage');
      expect(metadata?.description).toBe(en.settings.dataExposure.description);
      expect(within(group).getByTestId('capability-data_exposure.manage')).not.toBeChecked();
    },
  );

  it('renders group cards and the selected/total counter', () => {
    render(<CapabilityGrid groups={groups} selected={new Set()} onChange={vi.fn()} />);
    expect(screen.getByText('Users')).toBeTruthy();
    expect(screen.getByText('View users')).toBeTruthy();
    expect(screen.getByTestId('capability-count').textContent).toMatch(/0 of 1 selected/);
  });

  it('does not render a per-group selected count, only the global counter', () => {
    render(<CapabilityGrid groups={groups} selected={new Set(['users.view'])} onChange={vi.fn()} />);
    const group = screen.getByTestId('capability-group-users');
    // The group card shows its label but no "x/y" style per-group count.
    expect(within(group).queryByText(/^\d+\/\d+$/)).toBeNull();
    expect(screen.getByTestId('capability-count').textContent).toMatch(/1 of 1 selected/);
  });

  it('renders a full-width divider between the group title and its capability rows', () => {
    render(<CapabilityGrid groups={groups} selected={new Set()} onChange={vi.fn()} />);
    const group = screen.getByTestId('capability-group-users');
    const divider = group.querySelector('.border-t.border-border');
    expect(divider).toBeTruthy();
    // Bleeds past the card's own padding (-mx-3) so it spans the full card width.
    expect(divider).toHaveClass('-mx-3');
  });

  it('there is no select-all control, global or per-group', () => {
    render(<CapabilityGrid groups={groups} selected={new Set()} onChange={vi.fn()} />);
    expect(screen.queryByTestId('capability-select-all')).toBeNull();
    expect(screen.queryByText(/select all/i)).toBeNull();
  });

  it('clicking a capability switch calls onChange with the toggled set', () => {
    const onChange = vi.fn();
    render(<CapabilityGrid groups={groups} selected={new Set()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('capability-users.view'));
    expect(onChange).toHaveBeenCalledWith(new Set(['users.view']));
  });

  it('renders a checked switch for a selected capability', () => {
    render(<CapabilityGrid groups={groups} selected={new Set(['users.view'])} onChange={vi.fn()} />);
    expect(screen.getByTestId('capability-users.view')).toHaveAttribute('aria-checked', 'true');
  });

  it('readOnly disables every switch', () => {
    render(<CapabilityGrid groups={groups} selected={new Set(['users.view'])} onChange={vi.fn()} readOnly />);
    const group = screen.getByTestId('capability-group-users');
    expect(within(group).getByTestId('capability-users.view')).toBeDisabled();
  });

  it('renders a "no capabilities" message for an empty catalog', () => {
    render(<CapabilityGrid groups={[]} selected={new Set()} onChange={vi.fn()} />);
    expect(screen.getByText(/no capabilities available/i)).toBeTruthy();
  });
});
