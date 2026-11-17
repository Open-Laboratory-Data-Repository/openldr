import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TestResults } from './TestResults';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const commandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (commandDescriptor) Object.defineProperty(document, 'execCommand', commandDescriptor);
  else Reflect.deleteProperty(document, 'execCommand');
});

function menu(label: string, item: string) {
  const trigger = screen.getByRole('button', { name: label });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: item })) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

function previewOne() {
  render(<TestResults drafts={[]} state={{ kind: 'done', results: [
    { ok: true, kind: 'mapped', resourceTypes: ['Observation'], resources: [{ resourceType: 'Observation', id: 'result-1', valueQuantity: { value: 14.9 } }] },
  ] }} />);
  menu('Row actions: Row 1', 'View generated FHIR');
}

describe('TestResults output preview', () => {
  it('copies the whole generated JSON when the HTTP page has no clipboard API', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    let copied = '';
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => {
      const field = document.activeElement as HTMLTextAreaElement;
      copied = field.value.slice(field.selectionStart, field.selectionEnd);
      return true;
    } });
    previewOne();
    await screen.findByRole('dialog', { name: 'Generated FHIR' });

    menu('Generated record actions', 'Copy JSON');

    expect(await screen.findByRole('status')).toHaveTextContent('JSON copied.');
    expect(JSON.parse(copied)).toEqual([{ resourceType: 'Observation', id: 'result-1', valueQuantity: { value: 14.9 } }]);
  });

  it('keeps the JSON selected and explains how to copy when browser copy is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    previewOne();
    const sheet = await screen.findByRole('dialog', { name: 'Generated FHIR' });

    menu('Generated record actions', 'Copy JSON');

    expect(await screen.findByRole('status')).toHaveTextContent('Copy is unavailable. Select the JSON and copy it manually.');
    const field = within(sheet).getByRole('textbox', { name: 'Generated JSON' }) as HTMLTextAreaElement;
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('shows the selected row\'s generated resources with numeric values and references intact', async () => {
    render(<TestResults drafts={[]} state={{ kind: 'done', results: [
      { ok: true, kind: 'mapped', resourceTypes: ['Patient'], resources: [{ resourceType: 'Patient', id: 'other-row' }] },
      { ok: true, kind: 'mapped', resourceTypes: ['Observation'], resources: [
        { resourceType: 'Observation', id: 'result-2', subject: { reference: 'Patient/p2' }, valueQuantity: { value: 14.9, unit: 'test-unit' } },
      ] },
    ] }} />);

    const actions = screen.getByRole('button', { name: 'Row actions: Row 2' });
    fireEvent.pointerDown(actions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'View generated FHIR' })) fireEvent.keyDown(actions, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'View generated FHIR' }));

    const sheet = await screen.findByRole('dialog', { name: 'Generated FHIR' });
    const text = (within(sheet).getByRole('textbox', { name: 'Generated JSON' }) as HTMLTextAreaElement).value;
    expect(JSON.parse(text)).toEqual([
      { resourceType: 'Observation', id: 'result-2', subject: { reference: 'Patient/p2' }, valueQuantity: { value: 14.9, unit: 'test-unit' } },
    ]);
    expect(within(sheet).getByText('Row 2. Test does not save these records.')).toBeInTheDocument();
    expect(text).not.toContain('other-row');
  });

  it('offers no generated output action for rejected rows or rows without records', () => {
    render(<TestResults drafts={[]} state={{ kind: 'done', results: [
      { ok: false, reason: 'Missing required field', field: 'Patient.identifier.value' },
      { ok: true, kind: 'mapped', resourceTypes: [], resources: [] },
    ] }} />);
    expect(screen.queryByRole('button', { name: /Row actions:/ })).not.toBeInTheDocument();
  });
});
