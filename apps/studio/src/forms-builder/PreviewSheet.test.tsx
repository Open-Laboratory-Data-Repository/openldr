import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FormSchema } from '@/forms-runtime/types';
import { PreviewSheet } from './PreviewSheet';

const schema: FormSchema = {
  id: 'preview-test',
  name: 'Preview Test Form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'patient-name',
      fhirPath: null,
      displayLabel: 'Patient name',
      description: null,
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 1, max: '1' },
    },
    {
      id: 'sex',
      fhirPath: null,
      displayLabel: 'Sex',
      description: null,
      fieldType: 'select',
      required: false,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
      // No valueSetOptions — lintFormSchema will flag this as 'choice-missing-options' with severity 'error'
    },
  ],
  sections: [],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderOpen() {
  return render(<PreviewSheet schema={schema} open onOpenChange={() => {}} />);
}

function clickMenu(item: string) {
  const trigger = screen.getByLabelText('Preview actions');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText(item)) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByText(item));
}

describe('PreviewSheet', () => {
  it('is titled Preview', () => {
    renderOpen();
    expect(screen.getByRole('dialog', { name: 'Preview' })).toBeTruthy();
  });

  it('renders the Patient name field label', () => {
    renderOpen();
    expect(screen.getByText('Patient name')).toBeTruthy();
  });

  it('Fill example in the menu populates the Patient name input', () => {
    renderOpen();
    clickMenu('Fill example');
    expect((screen.getByLabelText('Patient name') as HTMLInputElement).value).toBe('Example');
  });

  it('Reset in the menu clears it', () => {
    renderOpen();
    clickMenu('Fill example');
    clickMenu('Reset');
    expect((screen.getByLabelText('Patient name') as HTMLInputElement).value).toBe('');
  });

  it('shows the Required marker for the required field', () => {
    renderOpen();
    expect(screen.getByLabelText('Required').textContent).toBe('!');
  });

  it('renders nothing when closed', () => {
    render(<PreviewSheet schema={schema} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText('Patient name')).toBeNull();
  });
});
