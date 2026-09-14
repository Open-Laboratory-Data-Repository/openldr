import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormSection } from '@openldr/forms/pure';
import { SectionsManager } from './SectionsManager';

const MAIN: FormSection = { id: 'main', label: 'Main', order: 0 };

function renderManager(
  sections: FormSection[] = [MAIN],
  onChange = vi.fn(),
  onFieldsClearSection = vi.fn(),
) {
  const utils = render(
    <SectionsManager
      sections={sections}
      onChange={onChange}
      onFieldsClearSection={onFieldsClearSection}
    />,
  );
  return { ...utils, onChange, onFieldsClearSection };
}

function openRowMenu(label: string) {
  const trigger = screen.getByRole('button', { name: `Actions for section ${label}` });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('SectionsManager', () => {
  it('renders the section label in an editable input', () => {
    renderManager();
    const input = screen.getByDisplayValue('Main');
    expect(input).toBeTruthy();
  });

  it('calls onChange with the updated label when the input is edited', () => {
    const { onChange } = renderManager();
    const input = screen.getByDisplayValue('Main');
    fireEvent.change(input, { target: { value: 'Demographics' } });
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ id: 'main', label: 'Demographics', order: 0 });
  });

  it('Add button is disabled when the Section name input is empty', () => {
    renderManager();
    const addBtn = screen.getByRole('button', { name: /^add$/i });
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('appends a new section when a name is typed and "Add" is clicked', () => {
    const { onChange } = renderManager();
    const nameInput = screen.getByLabelText('Section name');
    fireEvent.change(nameInput, { target: { value: 'Demographics' } });
    const addBtn = screen.getByRole('button', { name: /^add$/i });
    expect((addBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(addBtn);
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ id: 'main', order: 0 });
    expect(sections[1].label).toBe('Demographics');
    expect(sections[1].id).toBeTruthy();
    expect(sections[1].id).not.toBe('main');
    expect(sections[1].order).toBe(1);
  });

  it('clears the input after a successful Add', () => {
    renderManager();
    const nameInput = screen.getByLabelText('Section name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Demographics' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(nameInput.value).toBe('');
  });

  it('appends when Enter is pressed in the Section name input', () => {
    const { onChange } = renderManager();
    const nameInput = screen.getByLabelText('Section name');
    fireEvent.change(nameInput, { target: { value: 'Vitals' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections[1].label).toBe('Vitals');
  });

  it('deletes the section from its ⋯ menu and clears it from the fields', () => {
    const { onChange, onFieldsClearSection } = renderManager();
    openRowMenu('Main');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(0);
    expect(onFieldsClearSection).toHaveBeenCalledWith('main');
  });

  it('moves a section down from its ⋯ menu', () => {
    const second: FormSection = { id: 'extra', label: 'Extra', order: 1 };
    const { onChange } = renderManager([MAIN, second]);
    openRowMenu('Main');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections.map((s) => [s.id, s.order])).toEqual([['extra', 0], ['main', 1]]);
  });

  it('moves a section up from its ⋯ menu', () => {
    const second: FormSection = { id: 'extra', label: 'Extra', order: 1 };
    const { onChange } = renderManager([MAIN, second]);
    openRowMenu('Extra');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections.find((s) => s.id === 'extra')!.order).toBe(0);
  });

  it('disables Move up on the first section and Move down on the last', () => {
    renderManager([MAIN, { id: 'extra', label: 'Extra', order: 1 }]);
    openRowMenu('Main');
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('data-disabled');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    openRowMenu('Extra');
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveAttribute('data-disabled');
  });

  it('hands Edit visibility back with the section id', () => {
    const onEditVisibility = vi.fn();
    render(<SectionsManager sections={[MAIN]} onChange={vi.fn()} onFieldsClearSection={vi.fn()} onEditVisibility={onEditVisibility} />);
    openRowMenu('Main');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit visibility' }));
    expect(onEditVisibility).toHaveBeenCalledWith('main');
  });

  it('marks a section that has a rule', () => {
    renderManager([{ ...MAIN, visibility: { combinator: 'all', conditions: [{ fieldId: 'x', operator: 'isNotEmpty' }] } }]);
    expect(screen.getByRole('img', { name: 'Conditional' })).toBeTruthy();
  });
});
