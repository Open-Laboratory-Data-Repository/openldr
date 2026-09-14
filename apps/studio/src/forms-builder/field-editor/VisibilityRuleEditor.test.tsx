import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, VisibilityRule } from '@openldr/forms/pure';
import { VisibilityRuleEditor } from './VisibilityRuleEditor';

const field = (id: string, displayLabel: string): FormField => ({
  id, displayLabel, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});
const SEX = field('sex', 'Sex');
const DOB = field('dob', 'Date of Birth');

function renderEditor(rule?: VisibilityRule, candidateFields: FormField[] = [SEX, DOB]) {
  const onChange = vi.fn();
  render(<VisibilityRuleEditor rule={rule} candidateFields={candidateFields} onChange={onChange} />);
  return { onChange };
}

const IS_SET: VisibilityRule = { combinator: 'all', conditions: [{ fieldId: 'sex', operator: 'isNotEmpty' }] };
const EQUALS: VisibilityRule = { combinator: 'all', conditions: [{ fieldId: 'sex', operator: 'equals', value: '' }] };

describe('VisibilityRuleEditor', () => {
  it('offers all and any', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('combobox', { name: /combinator/i }));
    expect(screen.getAllByText('all').length).toBeGreaterThan(0);
    expect(screen.getAllByText('any').length).toBeGreaterThan(0);
  });

  it('Add condition starts a rule on the first candidate', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith({ combinator: 'all', conditions: [{ fieldId: 'sex', operator: 'isNotEmpty' }] });
  });

  it('offers only the candidate fields', () => {
    renderEditor(IS_SET, [SEX]);
    fireEvent.click(screen.getByRole('combobox', { name: /controlling field/i }));
    expect(screen.queryAllByRole('option', { name: 'Date of Birth' })).toHaveLength(0);
  });

  it('changes the controlling field', () => {
    const { onChange } = renderEditor(IS_SET);
    fireEvent.click(screen.getByRole('combobox', { name: /controlling field/i }));
    fireEvent.click(screen.getByText('Date of Birth'));
    expect((onChange.mock.calls[0][0] as VisibilityRule).conditions[0].fieldId).toBe('dob');
  });

  it('changes the operator', () => {
    const { onChange } = renderEditor(IS_SET);
    fireEvent.click(screen.getByRole('combobox', { name: /operator/i }));
    fireEvent.click(screen.getByText('equals'));
    expect((onChange.mock.calls[0][0] as VisibilityRule).conditions[0].operator).toBe('equals');
  });

  it('hides the value box for isEmpty and isNotEmpty', () => {
    renderEditor(IS_SET);
    expect(screen.queryByRole('textbox', { name: /value/i })).toBeNull();
  });

  it('changes the value', () => {
    const { onChange } = renderEditor(EQUALS);
    fireEvent.change(screen.getByRole('textbox', { name: /value/i }), { target: { value: 'male' } });
    expect((onChange.mock.calls[0][0] as VisibilityRule).conditions[0].value).toBe('male');
  });

  it('removing the last condition clears the rule', () => {
    const { onChange } = renderEditor(IS_SET);
    fireEvent.click(screen.getByRole('button', { name: /remove condition/i }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
