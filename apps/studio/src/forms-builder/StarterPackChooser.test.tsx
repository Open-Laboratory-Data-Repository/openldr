import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, StarterPackEntry, StarterPackWithEntries } from '@openldr/forms/pure';
import { StarterPackChooser } from './StarterPackChooser';

const entry = (ord: number, label: string, extra: Partial<StarterPackEntry> = {}): StarterPackEntry => ({
  ord, fhirPath: `Location.${label.toLowerCase()}`, label, apiProperty: null, fieldType: 'text', fhirValueField: null,
  required: false, locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
  rationale: `Why ${label}.`, ...extra,
});

const PACK: StarterPackWithEntries = {
  id: 'pack-location', resourceType: 'Location', name: 'Facility', version: '1', seeded: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  entries: [
    entry(0, 'Name', { required: true, locked: true }),
    entry(1, 'Code', { fhirPath: 'Location.identifier.value', discriminator: { system: 'urn:national' } }),
    entry(2, 'Alias'),
  ],
};

const onForm = (fhirPath: string): FormField => ({
  id: 'x', displayLabel: 'x', fieldType: 'text', required: false, enabled: true, fhirPath,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});

function renderChooser(props: Partial<Parameters<typeof StarterPackChooser>[0]> = {}) {
  const onAdd = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <StarterPackChooser
      open pack={PACK} loading={false} fields={[]} resourceType="Location"
      onAdd={onAdd} onOpenChange={onOpenChange} {...props}
    />,
  );
  return { onAdd, onOpenChange };
}

function clickMenu(item: string) {
  const trigger = screen.getByRole('button', { name: 'Pack actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('StarterPackChooser', () => {
  it('is a sheet titled with the pack, one row per entry with its reason', () => {
    renderChooser();
    const sheet = screen.getByRole('dialog', { name: 'Facility pack' });
    expect(sheet).toHaveTextContent('Why Alias.');
    expect(sheet).toHaveTextContent('system = urn:national');
    expect(screen.getByText('Required')).toBeTruthy();
  });

  it('keeps a locked entry checked and unchangeable', () => {
    renderChooser();
    const name = screen.getByRole('checkbox', { name: 'Include Name' });
    expect(name).toHaveAttribute('aria-checked', 'true');
    expect(name).toBeDisabled();
  });

  it('adds what is checked, and nothing unchecked', () => {
    const { onAdd, onOpenChange } = renderChooser();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Alias' }));
    clickMenu('Add 2 fields');
    expect(onAdd.mock.calls[0][0].map((e: StarterPackEntry) => e.label)).toEqual(['Name', 'Code']);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves out entries already on the form', () => {
    renderChooser({ fields: [onForm('Location.alias')] });
    expect(screen.queryByRole('checkbox', { name: 'Include Alias' })).toBeNull();
  });

  it('says so when the whole pack is on the form', () => {
    renderChooser({ fields: PACK.entries.map((e) => ({ ...onForm(e.fhirPath!), fhirDiscriminator: e.discriminator })) });
    expect(screen.getByText('Every entry in this pack is on the form.')).toBeTruthy();
  });

  it('Cancel closes it', () => {
    const { onOpenChange, onAdd } = renderChooser();
    clickMenu('Cancel');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('shows a spinner while the pack loads', () => {
    renderChooser({ pack: null, loading: true });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });
});
