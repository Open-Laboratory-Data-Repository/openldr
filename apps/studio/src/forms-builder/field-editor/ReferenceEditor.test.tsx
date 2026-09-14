import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField } from '@openldr/forms/pure';

vi.mock('../../api', () => ({
  listCodingSystems: vi.fn(async () => [
    { id: 'cs-1', systemCode: 'LOINC', systemName: 'LOINC', url: 'http://loinc.org', systemVersion: null, description: null, active: true, publisherId: null, seeded: true },
    { id: 'cs-2', systemCode: 'OLD', systemName: 'Old', url: 'urn:old', systemVersion: null, description: null, active: false, publisherId: null, seeded: true },
    { id: 'cs-3', systemCode: 'NOURL', systemName: 'No URL', url: null, systemVersion: null, description: null, active: true, publisherId: null, seeded: false },
  ]),
  listValueSets: vi.fn(async () => [{
    id: 'vs-country', url: 'urn:openldr:valueset:country', name: 'country', title: 'Country', version: null,
    status: 'active', immutable: false, publisherId: 'pub-system', category: null, codeCount: 250, primarySystem: null,
  }]),
}));

import { ReferenceEditor } from './ReferenceEditor';

const REF: FormField = {
  id: 'tests', displayLabel: 'Tests', fieldType: 'reference', required: false, enabled: true,
  fhirPath: null, order: 0, cardinality: { min: 0, max: '1' }, description: null,
};
const OTHER: FormField = { ...REF, id: 'patient', displayLabel: 'Patient', order: 1 };

function Harness({ field, onUpdate }: { field: FormField; onUpdate: (p: Partial<FormField>) => void }) {
  const [current, setCurrent] = useState(field);
  return (
    <ReferenceEditor
      field={current}
      allFields={[current, OTHER]}
      onUpdate={(patch) => { onUpdate(patch); setCurrent((f) => ({ ...f, ...patch })); }}
    />
  );
}

function renderRef(overrides: Partial<FormField> = {}) {
  const onUpdate = vi.fn();
  render(<Harness field={{ ...REF, ...overrides }} onUpdate={onUpdate} />);
  return { onUpdate };
}

describe('ReferenceEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers Patient and active code systems that have a URL, and nothing else', async () => {
    renderRef();
    fireEvent.click(screen.getByRole('combobox', { name: 'Target' }));
    expect(await screen.findByRole('option', { name: 'LOINC · http://loinc.org' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Patient' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /urn:old/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /No URL/ })).toBeNull();
  });

  it('keeps a stored target the list does not know, so opening the field never blanks it', async () => {
    renderRef({ referenceTarget: 'urn:custom:system' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Target' }));
    expect(await screen.findByRole('option', { name: 'urn:custom:system' })).toBeTruthy();
  });

  it('writes the picked target', async () => {
    const { onUpdate } = renderRef();
    fireEvent.click(screen.getByRole('combobox', { name: 'Target' }));
    fireEvent.click(await screen.findByRole('option', { name: 'LOINC · http://loinc.org' }));
    expect(onUpdate).toHaveBeenCalledWith({ referenceTarget: 'http://loinc.org' });
  });

  it('offers every other field for Depends On, and None clears it', () => {
    const { onUpdate } = renderRef({ referenceDependsOn: 'patient' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Depends On' }));
    expect(screen.queryByRole('option', { name: 'Tests (tests)' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    expect(onUpdate).toHaveBeenCalledWith({ referenceDependsOn: undefined });
  });

  it('shows Searchable ticked when it was never set, as corlix does', () => {
    renderRef();
    expect(screen.getByRole('checkbox', { name: 'Searchable' }).getAttribute('data-state')).toBe('checked');
  });

  it('edits the display and value fields', () => {
    const { onUpdate } = renderRef();
    fireEvent.change(screen.getByRole('textbox', { name: 'Display Field' }), { target: { value: 'name' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Value Field' }), { target: { value: 'id' } });
    expect(onUpdate).toHaveBeenCalledWith({ referenceDisplayField: 'name' });
    expect(onUpdate).toHaveBeenCalledWith({ referenceValueField: 'id' });
  });

  it('binds a ValueSet picked from the list, copying no codes', async () => {
    const { onUpdate } = renderRef();
    fireEvent.focus(screen.getByLabelText('Search a ValueSet…'));
    fireEvent.click((await screen.findByText('Country')).closest('button')!);
    expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: 'urn:openldr:valueset:country' });
  });

  it('shows the bound set and unbinds it from its row menu', async () => {
    const { onUpdate } = renderRef({ valueSetUrl: 'urn:openldr:valueset:country' });
    expect(await screen.findByText('Country')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'Value Set actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unbind' }));
    expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: undefined });
  });
});
