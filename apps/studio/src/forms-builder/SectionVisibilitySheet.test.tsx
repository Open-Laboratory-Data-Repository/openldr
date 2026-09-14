import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, FormSection } from '@openldr/forms/pure';
import { SectionVisibilitySheet } from './SectionVisibilitySheet';

const field = (id: string, displayLabel: string, enabled = true): FormField => ({
  id, displayLabel, fieldType: 'text', required: false, enabled, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});
const VITALS: FormSection = { id: 'vitals', label: 'Vitals', order: 0 };

describe('SectionVisibilitySheet', () => {
  it('is titled Visibility and names the section', () => {
    render(<SectionVisibilitySheet section={VITALS} fields={[]} onChange={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Visibility' })).toHaveTextContent('Show Vitals only when');
  });

  it('builds the rule from enabled fields only', () => {
    const onChange = vi.fn();
    render(
      <SectionVisibilitySheet
        section={VITALS}
        fields={[field('notes', 'Notes', false), field('fever', 'Fever')]}
        onChange={onChange}
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith('vitals', { combinator: 'all', conditions: [{ fieldId: 'fever', operator: 'isNotEmpty' }] });
  });

  it('renders nothing with no section', () => {
    render(<SectionVisibilitySheet section={null} fields={[]} onChange={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
