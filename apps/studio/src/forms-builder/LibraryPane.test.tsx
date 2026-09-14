import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lookupFhirPath } from '@openldr/fhir/paths';
import type { StarterPackEntry } from '@openldr/forms/pure';
import { LibraryPane } from './LibraryPane';

const els = ['Location.name', 'Location.address.city', 'Location.status'].map((p) => lookupFhirPath(p)!);

describe('LibraryPane', () => {
  it('lists each element by name and path under "All Location elements"', () => {
    render(<LibraryPane resourceType="Location" elements={els} onAddElement={vi.fn()} />);
    expect(screen.getByText('All Location elements')).toBeTruthy();
    expect(screen.getByText('Location.address.city')).toBeTruthy();
    expect(screen.getByText('City')).toBeTruthy();
  });

  it('filters by name and by path', () => {
    render(<LibraryPane resourceType="Location" elements={els} onAddElement={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the library' }), { target: { value: 'status' } });
    expect(screen.queryByText('Location.name')).toBeNull();
    expect(screen.getByText('Location.status')).toBeTruthy();
  });

  it('says so when a search matches nothing', () => {
    render(<LibraryPane resourceType="Location" elements={els} onAddElement={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the library' }), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing in the library matches "zzz".')).toBeTruthy();
  });

  it('hands a clicked element back', () => {
    const onAddElement = vi.fn();
    render(<LibraryPane resourceType="Location" elements={els} onAddElement={onAddElement} />);
    fireEvent.click(screen.getByRole('button', { name: /Location\.status/ }));
    expect(onAddElement).toHaveBeenCalledWith(els[2]);
  });

  it('says every element is on the form when none is left', () => {
    render(<LibraryPane resourceType="Location" elements={[]} onAddElement={vi.fn()} />);
    expect(screen.getByText('Every element is on the form.')).toBeTruthy();
  });

  it('says there is no element list for a type the table does not cover', () => {
    render(<LibraryPane resourceType="Encounter2" elements={[]} onAddElement={vi.fn()} />);
    expect(screen.getByText('The library has no element list for Encounter2.')).toBeTruthy();
  });

  it('asks for a resource type when there is none', () => {
    render(<LibraryPane resourceType={null} elements={[]} onAddElement={vi.fn()} />);
    expect(screen.getByText('Pick a resource type and the library will list what this form could hold.')).toBeTruthy();
  });

  const packEntry = (ord: number, label: string, extra: Partial<StarterPackEntry> = {}): StarterPackEntry => ({
    ord, fhirPath: `Location.${label.toLowerCase()}`, label, apiProperty: null, fieldType: 'text', fhirValueField: null,
    required: false, locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
    rationale: 'r', ...extra,
  });

  it('lists what the form lacks from the pack first, with the discriminator line', () => {
    const left = [packEntry(1, 'Code', { fhirPath: 'Location.identifier.value', discriminator: { system: 'urn:national' } })];
    render(<LibraryPane resourceType="Location" elements={els} packName="Facility" packLeft={left} onAddElement={vi.fn()} onAddPackEntry={vi.fn()} />);
    expect(screen.getByText('Left out of the pack')).toBeTruthy();
    expect(screen.getByText('These are in the Facility pack and not on the form. Click one to put it back.')).toBeTruthy();
    expect(screen.getByText('system = urn:national')).toBeTruthy();
  });

  it('hands a clicked pack entry back', () => {
    const onAddPackEntry = vi.fn();
    const left = [packEntry(0, 'Alias')];
    render(<LibraryPane resourceType="Location" elements={[]} packName="Facility" packLeft={left} onAddElement={vi.fn()} onAddPackEntry={onAddPackEntry} />);
    fireEvent.click(screen.getByRole('button', { name: /Alias/ }));
    expect(onAddPackEntry).toHaveBeenCalledWith(left[0]);
  });

  it('says so when every pack entry is on the form', () => {
    render(<LibraryPane resourceType="Location" elements={els} packName="Facility" packLeft={[]} onAddElement={vi.fn()} />);
    expect(screen.getByText('Every entry in the Facility pack is on the form.')).toBeTruthy();
  });

  it('shows a spinner while the pack loads, and no pack group without a pack', () => {
    const { rerender } = render(<LibraryPane resourceType="Location" elements={els} packLoading onAddElement={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    rerender(<LibraryPane resourceType="Location" elements={els} onAddElement={vi.fn()} />);
    expect(screen.queryByText('Left out of the pack')).toBeNull();
  });

  it('search filters the pack group too', () => {
    const left = [packEntry(0, 'Alias'), packEntry(1, 'Description')];
    render(<LibraryPane resourceType="Location" elements={[]} packName="Facility" packLeft={left} onAddElement={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the library' }), { target: { value: 'desc' } });
    expect(screen.queryByText('Alias')).toBeNull();
    expect(screen.getByText('Description')).toBeTruthy();
  });
});
