import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lookupFhirPath } from '@openldr/fhir/paths';
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
});
